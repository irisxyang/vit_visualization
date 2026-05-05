"""
Runtime saliency display rendering.

Loads a raw grayscale saliency PNG, applies a perceptual colormap
(inferno), and blends the result onto the source image to produce
the version shown in the right panel's saliency tile.

Cached on disk under tmp/saliency_display/<image_id>/<key>.png so
repeat requests are static file reads.

A "key" is either:
  - "original"   for the baseline (no-concentration) saliency
  - "<row>_<col>" for a patch saliency
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from matplotlib import colormaps
from PIL import Image

from .. import storage

# perceptual colormap; inferno reads well on the dark UI background.
# alternatives: "magma", "plasma", "hot". change here if you want.
COLORMAP_NAME = "inferno"

# how much the heatmap dominates vs. the source image.
# 0.0 = source only, 1.0 = colormap only.
OVERLAY_ALPHA = 0.6

# pre-build the [256, 3] lookup table once at import time.
# matplotlib returns RGBA float in [0, 1]; we drop alpha and quantize to uint8.
_lut: np.ndarray = (colormaps[COLORMAP_NAME](np.arange(256))[:, :3] * 255).astype(np.uint8)


def display_path(image_id: str, key: str) -> Path:
    return storage.TMP_ROOT / "saliency_display" / image_id / f"{key}.png"


def display_url(image_id: str, key: str) -> str:
    return f"{storage.URL_PREFIX}/tmp/saliency_display/{image_id}/{key}.png"


def render(image_id: str, key: str, raw_path: Path) -> Path:
    """
    Render and cache the colormapped+blended display PNG. Idempotent:
    if the file already exists, returns its path without redoing the work.

    Args:
        image_id: which default image this saliency belongs to
        key:      "original" or "<row>_<col>"
        raw_path: absolute path to the raw grayscale PNG on disk

    Returns the path to the rendered display PNG.
    """
    out_path = display_path(image_id, key)
    if out_path.exists():
        return out_path

    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not raw_path.exists():
        raise FileNotFoundError(f"raw saliency missing: {raw_path}")

    # load source image (for the blend underlay)
    src = Image.open(storage.source_image_path(image_id)).convert("RGB")
    W, H = src.size

    # load raw grayscale, resize to source dims if needed
    raw = Image.open(raw_path).convert("L")
    if raw.size != (W, H):
        raw = raw.resize((W, H), Image.BILINEAR)

    # apply colormap via the LUT
    raw_arr = np.asarray(raw, dtype=np.uint8)            # [H, W]
    colored = _lut[raw_arr]                              # [H, W, 3] uint8
    colored_img = Image.fromarray(colored, mode="RGB")

    # blend over source: result = (1-α)·src + α·colored
    blended = Image.blend(src, colored_img, alpha=OVERLAY_ALPHA)
    blended.save(out_path, format="PNG")

    return out_path