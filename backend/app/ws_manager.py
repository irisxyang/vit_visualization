"""
Simple WebSocket connection manager.

Tracks which active connections are "interested" in a given image_hash
so the precompute task can broadcast progress updates. A connection
registers interest when it first sends a request for that hash.
"""

from __future__ import annotations

import asyncio

from fastapi import WebSocket

from .schemas import ServerMessage


class WSManager:
    def __init__(self) -> None:
        # connection -> set of image_hashes it has shown interest in
        self._interests: dict[WebSocket, set[str]] = {}
        self._lock = asyncio.Lock()

    async def attach(self, ws: WebSocket) -> None:
        async with self._lock:
            self._interests[ws] = set()

    async def detach(self, ws: WebSocket) -> None:
        async with self._lock:
            self._interests.pop(ws, None)

    async def register_interest(self, ws: WebSocket, image_hash: str) -> None:
        async with self._lock:
            if ws in self._interests:
                self._interests[ws].add(image_hash)

    async def connections_for(self, image_hash: str) -> list[WebSocket]:
        async with self._lock:
            return [ws for ws, hashes in self._interests.items() if image_hash in hashes]

    async def broadcast(self, image_hash: str, message: ServerMessage) -> None:
        targets = await self.connections_for(image_hash)
        payload = message.model_dump()
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                # connection probably dropped — let detach() clean it up later
                pass


# singleton
manager = WSManager()