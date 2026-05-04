"""
WS /morph — bidirectional protocol for patch processing requests.

Concurrency model:
  - one connection can have multiple requests in flight
  - each request runs in its own asyncio.Task
  - a cancel message cancels the matching task by request_id
  - cache hits are returned synchronously without spawning a task
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

from .. import cache, pipeline_stub
from ..schemas import (
    CancelMessage,
    ClientMessage,
    ErrorMessage,
    RequestMessage,
)
from ..ws_manager import manager

router = APIRouter()

_client_msg = TypeAdapter(ClientMessage)


@router.websocket("/morph")
async def morph(ws: WebSocket) -> None:
    await ws.accept()
    await manager.attach(ws)

    # request_id -> task for in-flight pipeline runs
    in_flight: dict[str, asyncio.Task] = {}

    try:
        while True:
            raw = await ws.receive_json()
            try:
                msg = _client_msg.validate_python(raw)
            except ValidationError as exc:
                await ws.send_json(
                    ErrorMessage(request_id=None, message=f"invalid message: {exc}").model_dump()
                )
                continue

            if isinstance(msg, RequestMessage):
                await _handle_request(ws, msg, in_flight)
            elif isinstance(msg, CancelMessage):
                _handle_cancel(msg, in_flight)
    except WebSocketDisconnect:
        pass
    finally:
        for task in in_flight.values():
            task.cancel()
        await manager.detach(ws)


async def _handle_request(
    ws: WebSocket,
    msg: RequestMessage,
    in_flight: dict[str, asyncio.Task],
) -> None:
    await manager.register_interest(ws, msg.image_hash)

    # cache hit: return immediately, no task needed
    cached = cache.get(msg.image_hash, msg.patch.row, msg.patch.col)
    if cached is not None:
        result = cached.model_copy(update={"request_id": msg.request_id})
        await ws.send_json(result.model_dump())
        return

    # otherwise spawn a worker task
    async def worker() -> None:
        try:
            result = await pipeline_stub.process(msg.image_hash, msg.patch.row, msg.patch.col)
            cache.put(msg.image_hash, msg.patch.row, msg.patch.col, result)
            stamped = result.model_copy(update={"request_id": msg.request_id})
            await ws.send_json(stamped.model_dump())
        except asyncio.CancelledError:
            # cancellation is normal when the user moves to another patch
            raise
        except Exception as exc:  # noqa: BLE001
            await ws.send_json(
                ErrorMessage(request_id=msg.request_id, message=str(exc)).model_dump()
            )
        finally:
            in_flight.pop(msg.request_id, None)

    in_flight[msg.request_id] = asyncio.create_task(worker())


def _handle_cancel(msg: CancelMessage, in_flight: dict[str, asyncio.Task]) -> None:
    task = in_flight.get(msg.request_id)
    if task is not None and not task.done():
        task.cancel()