"""
Precomputed data loader.

At application startup, this module reads:
  - data/manifest.json: ordered list of default image ids
  - data/precomputed/<image_id>.json (one per image): baseline + 196 patches

Class names are NOT stored in the JSON files. They are looked up via
class_labels.get(class_id) at load time and stored on the dataclass.
This means class_labels.load() must run first.

It exposes O(1) lookup of patch metadata + baseline metadata by id.
The data is immutable after load — no writes, no eviction, no cache
invalidation.

Schema validation is strict: missing files, missing patches, malformed
JSON, unknown class_ids all raise at startup, BEFORE the server starts
handling requests. This is by design — silent degradation hides bugs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional

from . import class_labels, storage

GRID = 14


@dataclass(frozen=True)
class PatchData:
    class_id: int
    class_name: str
    top_3_channel_ids: tuple[int, int, int]
    saliency_url: str  # raw grayscale PNG


@dataclass(frozen=True)
class OriginalData:
    class_id: int
    class_name: str
    top_3_channel_ids: tuple[int, int, int]
    saliency_url: str  # raw grayscale PNG


@dataclass(frozen=True)
class ImageData:
    image_id: str
    image_url: str
    original: OriginalData
    patches: dict[tuple[int, int], PatchData]  # keyed by (row, col)


# module-level state, populated by load_all()
_images: dict[str, ImageData] = {}
_order: list[str] = []


def load_all() -> None:
    """Load manifest + all precomputed JSONs from disk into memory.

    Called once at application startup via the FastAPI lifespan handler.
    """
    global _images, _order

    manifest_p = storage.manifest_path()
    if not manifest_p.exists():
        raise RuntimeError(f"missing manifest: {manifest_p}")

    with manifest_p.open() as f:
        manifest = json.load(f)

    ids = manifest.get("default_image_ids")
    if not isinstance(ids, list) or not ids:
        raise RuntimeError(f"manifest missing or empty 'default_image_ids': {manifest}")

    images: dict[str, ImageData] = {}
    for image_id in ids:
        images[image_id] = _load_one(image_id)

    _images = images
    _order = list(ids)
    print(f"[precomputed] loaded {len(_images)} images: {_order}")


def _load_one(image_id: str) -> ImageData:
    json_p = storage.precomputed_json_path(image_id)
    if not json_p.exists():
        raise RuntimeError(f"missing precomputed json for {image_id!r}: {json_p}")

    with json_p.open() as f:
        raw = json.load(f)

    for key in ("image_id", "image_url", "original", "patches"):
        if key not in raw:
            raise RuntimeError(f"{json_p}: missing top-level field {key!r}")

    if raw["image_id"] != image_id:
        raise RuntimeError(
            f"{json_p}: image_id mismatch (file says {raw['image_id']!r}, "
            f"expected {image_id!r})"
        )

    src = storage.source_image_path(image_id)
    if not src.exists():
        raise RuntimeError(f"source image missing: {src}")

    original = _parse_original(raw["original"], where=f"{json_p}:original")

    patches_raw = raw["patches"]
    if not isinstance(patches_raw, dict):
        raise RuntimeError(f"{json_p}: 'patches' must be an object")

    patches: dict[tuple[int, int], PatchData] = {}
    for r in range(GRID):
        for c in range(GRID):
            key = f"{r}_{c}"
            if key not in patches_raw:
                raise RuntimeError(f"{json_p}: missing patch entry {key!r}")
            patches[(r, c)] = _parse_patch(patches_raw[key], where=f"{json_p}:patches.{key}")

    extra = set(patches_raw.keys()) - {f"{r}_{c}" for r in range(GRID) for c in range(GRID)}
    if extra:
        raise RuntimeError(f"{json_p}: unexpected patch keys: {sorted(extra)}")

    return ImageData(
        image_id=image_id,
        image_url=raw["image_url"],
        original=original,
        patches=patches,
    )


def _parse_original(d: dict, *, where: str) -> OriginalData:
    _require(d, ("class_id", "top_3_channel_ids", "saliency_url"), where)
    chans = d["top_3_channel_ids"]
    if not (isinstance(chans, list) and len(chans) == 3 and all(isinstance(x, int) for x in chans)):
        raise RuntimeError(f"{where}: top_3_channel_ids must be a list of 3 ints, got {chans!r}")
    class_id = int(d["class_id"])
    try:
        class_name = class_labels.get(class_id)
    except KeyError as exc:
        raise RuntimeError(f"{where}: {exc}") from exc
    return OriginalData(
        class_id=class_id,
        class_name=class_name,
        top_3_channel_ids=tuple(chans),  # type: ignore[arg-type]
        saliency_url=str(d["saliency_url"]),
    )


def _parse_patch(d: dict, *, where: str) -> PatchData:
    _require(d, ("class_id", "top_3_channel_ids", "saliency_url"), where)
    chans = d["top_3_channel_ids"]
    if not (isinstance(chans, list) and len(chans) == 3 and all(isinstance(x, int) for x in chans)):
        raise RuntimeError(f"{where}: top_3_channel_ids must be a list of 3 ints, got {chans!r}")
    class_id = int(d["class_id"])
    try:
        class_name = class_labels.get(class_id)
    except KeyError as exc:
        raise RuntimeError(f"{where}: {exc}") from exc
    return PatchData(
        class_id=class_id,
        class_name=class_name,
        top_3_channel_ids=tuple(chans),  # type: ignore[arg-type]
        saliency_url=str(d["saliency_url"]),
    )


def _require(d: dict, fields: tuple[str, ...], where: str) -> None:
    for f in fields:
        if f not in d:
            raise RuntimeError(f"{where}: missing field {f!r}")


# ---------- accessors used by routes ----------

def order() -> list[str]:
    """Image ids in display order (the order from manifest.json)."""
    return list(_order)


def get_image(image_id: str) -> Optional[ImageData]:
    return _images.get(image_id)


def get_patch(image_id: str, row: int, col: int) -> Optional[PatchData]:
    img = _images.get(image_id)
    if img is None:
        return None
    return img.patches.get((row, col))