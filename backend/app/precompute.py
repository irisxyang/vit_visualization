"""
Background precompute: runs the pipeline for all 196 patches of a
freshly-uploaded image. Fills the cache so subsequent dwell hovers
hit instantly.

Concurrency-capped via a semaphore so we don't blow up CPU. Progress
is broadcast over WS to any connection that has registered interest
in this image_hash.

Only one precompute task runs at a time — if a new upload arrives
while a precompute is in progress for a different hash, the old task
is cancelled before the new one starts.
"""

from __future__ import annotations

import asyncio

from . import cache, pipeline_stub
from .schemas import PrecomputeProgressMessage
from .ws_manager import manager

GRID = 14
TOTAL = GRID * GRID
CONCURRENCY = 4
PROGRESS_EVERY = 10  # broadcast progress every N completions

# the single in-flight precompute, if any. (image_hash, task)
_active: tuple[str, asyncio.Task] | None = None
_lock = asyncio.Lock()


async def cancel_active() -> None:
    """Cancel the currently running precompute, if any. Awaits its exit."""
    global _active
    async with _lock:
        if _active is None:
            return
        _, task = _active
        _active = None
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass


def is_active_for(image_hash: str) -> bool:
    """True if a precompute task is currently running for this hash."""
    return _active is not None and _active[0] == image_hash and not _active[1].done()


async def kick_off(image_hash: str) -> None:
    """
    Cancel any existing precompute for a different hash, then start a
    fresh one. Re-kicking the same hash while it's running is a no-op.
    """
    global _active
    async with _lock:
        if _active is not None and _active[0] == image_hash:
            return  # already running for this hash; do not cancel/restart

    # different hash (or none); cancel & replace
    await cancel_active()

    async with _lock:
        task = asyncio.create_task(_run(image_hash))
        _active = (image_hash, task)


async def _run(image_hash: str) -> None:
    global _active
    try:
        sem = asyncio.Semaphore(CONCURRENCY)
        done = 0
        done_lock = asyncio.Lock()

        async def one(row: int, col: int) -> None:
            nonlocal done
            if cache.has(image_hash, row, col):
                async with done_lock:
                    done += 1
                return
            async with sem:
                try:
                    result = await pipeline_stub.process(image_hash, row, col)
                    cache.put(image_hash, row, col, result)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    print(f"[precompute] failed ({row},{col}): {exc}")
            async with done_lock:
                done += 1
                d = done
            if d % PROGRESS_EVERY == 0 or d == TOTAL:
                await manager.broadcast(
                    image_hash,
                    PrecomputeProgressMessage(image_hash=image_hash, done=d, total=TOTAL),
                )

        tasks = [one(r, c) for r in range(GRID) for c in range(GRID)]
        await asyncio.gather(*tasks)
        print(f"[precompute] done for {image_hash}")
    except asyncio.CancelledError:
        print(f"[precompute] cancelled for {image_hash}")
        raise
    finally:
        async with _lock:
            if _active is not None and _active[0] == image_hash:
                _active = None