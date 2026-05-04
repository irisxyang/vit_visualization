"""
In-memory cache of pipeline results keyed by (image_hash, row, col).

Holds just the metadata; the saliency + merged PNGs live on disk under
backend/tmp/. Process-local; if you scale to multiple workers later,
swap this for redis or similar.

The active image is whichever one was last uploaded — there is at
most one image's results in the cache at a time. Calling
`drop_others(image_hash)` clears everything that doesn't belong to
the named hash; this is invoked on every new upload.
"""

from __future__ import annotations

from threading import Lock
from typing import Optional

from .schemas import ResultMessage

_cache: dict[tuple[str, int, int], ResultMessage] = {}
_lock = Lock()


def get(image_hash: str, row: int, col: int) -> Optional[ResultMessage]:
    with _lock:
        return _cache.get((image_hash, row, col))


def put(image_hash: str, row: int, col: int, result: ResultMessage) -> None:
    with _lock:
        _cache[(image_hash, row, col)] = result


def has(image_hash: str, row: int, col: int) -> bool:
    with _lock:
        return (image_hash, row, col) in _cache


def drop_others(active_hash: str) -> int:
    """Remove cache entries whose image_hash != active_hash. Returns count dropped."""
    with _lock:
        stale = [k for k in _cache.keys() if k[0] != active_hash]
        for k in stale:
            del _cache[k]
        return len(stale)


def stats(image_hash: str) -> tuple[int, int]:
    """Return (cached, total) for a given image. Total is fixed at 14*14=196."""
    with _lock:
        cached = sum(1 for (h, _, _) in _cache.keys() if h == image_hash)
    return cached, 14 * 14