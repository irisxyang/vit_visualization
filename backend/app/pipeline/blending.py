"""
Runtime blending: turns precomputed metadata + a source image into a
merged RGB PNG saved under tmp/.

This is the only meaningful per-request work the runtime backend does.
Everything else is dict lookups and static file serving.

The actual blend math lives in `composite.py` — this module just handles
the I/O, dimension sanity, and saving.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .. import storage
from ..precomputed_loader import PatchData
from .composite import composite

# the three blend modes used for the three rep-max overlays. order
# matches the ranked channels (most-activated channel uses the first
# mode). swap freely.
DEFAULT_BLEND_MODES = ["hard_light", "hard_light", "hard_light"]


def render_merged(
    image_id: str,
    row: int,
    col: int,
    patch: PatchData,
) -> Path:
    """
    Compute and save the merged image for (image_id, row, col).

    Idempotent: if the merged PNG already exists on disk, returns its
    path without recomputing. Caller is responsible for deciding when
    to invalidate (currently we never do — outputs are deterministic
    in (image_id, patch)).

    Returns the absolute path to the saved PNG.
    """
    out_path = storage.merged_path(image_id, row, col)
    if out_path.exists():
        return out_path

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # ---- load inputs ----
    src_path = storage.source_image_path(image_id)
    sal_abs = storage.resolve_precomputed_url(patch.saliency_url)

    if not src_path.exists():
        raise FileNotFoundError(f"source image missing: {src_path}")
    if not sal_abs.exists():
        raise FileNotFoundError(f"saliency missing: {sal_abs}")

    source = Image.open(src_path).convert("RGB")

    # raw saliency PNG is single-channel grayscale; convert to float [0, 1]
    sal_img = Image.open(sal_abs).convert("L")
    saliency = np.asarray(sal_img, dtype=np.float32) / 255.0

    # rep-max overlays: composite() handles internal resizing to source dims
    overlays = []
    for ch_id in patch.top_3_channel_ids:
        ch_path = storage.channel_image_path(ch_id)
        if not ch_path.exists():
            raise FileNotFoundError(f"channel image missing: {ch_path}")
        overlays.append(Image.open(ch_path).convert("RGB"))

    # ---- blend ----
    rgba = composite(source, saliency, overlays, modes=DEFAULT_BLEND_MODES)
    if rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError(f"composite() returned shape {rgba.shape}, expected [H, W, 4]")

    # alpha just carries the mask; we ignore it for display
    rgb = np.clip(rgba[..., :3], 0.0, 1.0)
    rgb_u8 = (rgb * 255).astype(np.uint8)
    Image.fromarray(rgb_u8, mode="RGB").save(out_path, format="PNG")

    return out_path