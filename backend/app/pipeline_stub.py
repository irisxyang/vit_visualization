"""
STUB pipeline — no real ML. Generates plausible-looking dummy outputs
with realistic latency so the frontend can be developed end-to-end
before the real model is wired in.

Replace with real implementation by:
  1. Renaming this file to `pipeline_real.py` (keep `pipeline_stub.py`
     around as a fallback).
  2. Implementing `process(image_hash, row, col) -> ResultMessage`
     that runs your attention concentration + saliency + merge.
  3. Updating the import in routes/morph_ws.py and precompute.py.

The function signature and return type are the contract; nothing else
should need to change.
"""

from __future__ import annotations

import asyncio
import hashlib
import random

from PIL import Image, ImageDraw, ImageFilter

from . import storage
from .schemas import Patch, ResultMessage

# fake imagenet labels — enough variety that the panel reads as real
_FAKE_CLASSES: list[tuple[int, str]] = [
    (10, "brambling, Fringilla montifringilla"),
    (18, "magpie"),
    (207, "golden retriever"),
    (281, "tabby cat"),
    (340, "zebra"),
    (388, "panda"),
    (417, "balloon"),
    (574, "golf ball"),
    (817, "sports car"),
    (970, "alp"),
]


def _seed(image_hash: str, row: int, col: int) -> random.Random:
    """Deterministic RNG per (image, patch). Repeat hovers stay consistent."""
    seed = hashlib.sha256(f"{image_hash}:{row}:{col}".encode()).digest()[:8]
    return random.Random(int.from_bytes(seed, "big"))


def _process_sync(image_hash: str, row: int, col: int) -> ResultMessage:
    """Generate fake outputs synchronously. CPU-bound bits stay here."""
    rng = _seed(image_hash, row, col)
    cls_id, cls_name = rng.choice(_FAKE_CLASSES)
    channel_ids = sorted(rng.sample(range(192), 3))  # DeiT-Tiny block 11 has 192 channels

    original = storage.load_original(image_hash)
    side = original.width

    storage.patch_dir(image_hash, row, col).mkdir(parents=True, exist_ok=True)

    # ----- fake saliency map: gaussian blob centered on the patch -----
    cx = (col + 0.5) * (side / 14)
    cy = (row + 0.5) * (side / 14)
    saliency = Image.new("RGB", (side, side), (0, 0, 0))
    draw = ImageDraw.Draw(saliency)
    blob_radius = side * 0.15
    for r in range(int(blob_radius), 0, -2):
        alpha = int(255 * (1 - r / blob_radius))
        draw.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            fill=(alpha, max(0, alpha - 80), 0),
        )
    saliency = saliency.filter(ImageFilter.GaussianBlur(radius=side * 0.02))
    saliency.save(storage.saliency_path(image_hash, row, col), format="PNG")

    # ----- fake "merged" image: tinted + saliency overlay on original -----
    # gives a visibly different image so the morph is obvious in dev
    tint = (rng.randint(0, 80), rng.randint(0, 80), rng.randint(0, 80))
    tinted = Image.new("RGB", (side, side), tint)
    merged = Image.blend(original, tinted, alpha=0.25)
    merged = Image.blend(merged, saliency, alpha=0.35)
    merged.save(storage.merged_path(image_hash, row, col), format="PNG")

    return ResultMessage(
        request_id="",  # filled in by the route, since cache is request-agnostic
        image_hash=image_hash,
        patch=Patch(row=row, col=col),
        new_class_id=cls_id,
        new_class_name=cls_name,
        top_3_channel_ids=channel_ids,
        saliency_url=storage.saliency_url(image_hash, row, col),
        merged_image_url=storage.merged_url(image_hash, row, col),
    )


async def process(image_hash: str, row: int, col: int) -> ResultMessage:
    """
    Async wrapper around the sync work. Adds a small simulated latency
    so frontend cancellation / morph behavior can be exercised. Real
    pipeline should run torch inference inside `asyncio.to_thread`.
    """
    rng = _seed(image_hash, row, col)
    fake_latency = 0.6 + rng.random() * 0.9  # 0.6 – 1.5s
    await asyncio.sleep(fake_latency)
    return await asyncio.to_thread(_process_sync, image_hash, row, col)