"""
WS /morph — bidirectional protocol for patch processing requests.

On a request:
  1. Look up the patch's precomputed metadata in memory (O(1)).
  2. Render the merged image via the runtime blending function.
     Idempotent and disk-cached, so repeat hovers are near-instant.
  3. Send back a ResultMessage referencing both the precomputed display
     saliency and the freshly-rendered merged image.

Per-request asyncio.Tasks are still used so cancellation works cleanly
when the user moves to a new patch mid-blend. The blend itself runs in
asyncio.to_thread so it doesn't block the event loop.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

from .. import precomputed_loader, storage
from ..pipeline.blending import render_merged
from ..pipeline import saliency_display
from ..schemas import (
    CancelMessage,
    ClientMessage,
    ErrorMessage,
    Patch,
    RequestMessage,
    ResultMessage,
)

router = APIRouter()

_client_msg = TypeAdapter(ClientMessage)


@router.websocket("/morph")
async def morph(ws: WebSocket) -> None:
    await ws.accept()

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


async def _handle_request(
    ws: WebSocket,
    msg: RequestMessage,
    in_flight: dict[str, asyncio.Task],
) -> None:
    # validate the patch is in our precomputed dataset
    patch_data = precomputed_loader.get_patch(msg.image_id, msg.patch.row, msg.patch.col)
    if patch_data is None:
        await ws.send_json(
            ErrorMessage(
                request_id=msg.request_id,
                message=f"unknown image_id {msg.image_id!r} or patch ({msg.patch.row}, {msg.patch.col})",
            ).model_dump()
        )
        return

    async def worker() -> None:
        try:
            # both render fns are CPU-bound and disk-cached; off the event loop
            await asyncio.to_thread(
                render_merged,
                msg.image_id,
                msg.patch.row,
                msg.patch.col,
                patch_data,
            )
            sal_key = f"{msg.patch.row}_{msg.patch.col}"
            sal_raw_path = storage.resolve_precomputed_url(patch_data.saliency_url)
            await asyncio.to_thread(
                saliency_display.render,
                msg.image_id,
                sal_key,
                sal_raw_path,
            )

            result = ResultMessage(
                request_id=msg.request_id,
                image_id=msg.image_id,
                patch=Patch(row=msg.patch.row, col=msg.patch.col),
                new_class_id=patch_data.class_id,
                new_class_name=patch_data.class_name,
                top_3_channel_ids=list(patch_data.top_3_channel_ids),
                saliency_url=saliency_display.display_url(msg.image_id, sal_key),
                merged_image_url=storage.merged_url(msg.image_id, msg.patch.row, msg.patch.col),
            )
            await ws.send_json(result.model_dump())
        except asyncio.CancelledError:
            raise  # normal: user moved to another patch
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