from __future__ import annotations

import warnings
from enum import Enum
from typing import List, Optional, Tuple, Union

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

"""
The `composite()` function — saliency-driven image compositor.
 
PASTE YOUR composite() IMPLEMENTATION INTO THIS FILE.
 
Required signature:
 
    composite(
        original:   ImgIn,                  # PIL.Image or np.ndarray
        saliency:   np.ndarray,             # float [H, W] in [0, 1]
        overlays:   List[ImgIn],            # 1-3 rep-max PIL Images
        modes:      List[str],              # blend modes per overlay
        *,
        mask_sigma: float = 10.0,
        mask_gamma: float = 2.0,
        mask_lo:    float = 0.1,
        mask_hi:    float = 0.4,
    ) -> np.ndarray                          # float32 [H, W, 4] RGBA
 
The blending route reads `[..., :3]` of the return value (alpha channel
just stores the saliency mask and is ignored for display).
 
The route invokes composite() with modes = ["normal", "hard_light", "overlay"]
by default — tweak in app/pipeline/blending.py if needed.
 
While you don't have a real composite() yet, you can use a temporary
stub that returns a tinted version of the original — useful for
verifying end-to-end wiring with fake data:
 
    def composite(original, saliency, overlays, modes, **kwargs):
        src = np.asarray(original.convert("RGB"), dtype=np.float32) / 255.0
        H, W = src.shape[:2]
        if saliency.shape != (H, W):
            from PIL import Image as _I
            saliency = np.asarray(
                _I.fromarray((saliency * 255).astype(np.uint8)).resize((W, H)),
                dtype=np.float32,
            ) / 255.0
        tint = np.array([0.2, 0.6, 0.4], dtype=np.float32)
        mask = saliency[..., None]
        rgba = np.concatenate([src * mask + tint * (1 - mask), mask], axis=-1)
        return rgba.astype(np.float32)
 
Delete the stub once your real composite() is plugged in.
"""


# def composite(
#     original: ImgIn,
#     saliency: np.ndarray,
#     overlays: List[ImgIn],
#     modes: List[str],
#     *,
#     mask_sigma: float = 10.0,
#     mask_gamma: float = 2.0,
#     mask_lo: float = 0.1,
#     mask_hi: float = 0.4,
# ) -> np.ndarray:
#     raise NotImplementedError(
#         "Paste your composite() implementation into "
#         "backend/app/pipeline/composite.py"
#     )

"""
saliency_blend.py
─────────────────
Saliency-driven compositor: keeps the original image where saliency is HIGH
and blends in up to 3 replacement images where saliency is LOW.

Output is RGBA — alpha channel = saliency mask, so low-saliency regions of
the original are fully transparent and only the overlay blend shows through.

Usage
-----
    from saliency_blend import composite, show_composite, BlendMode

    result_rgba = composite(
        original   = Image.open("dog.jpg"),
        saliency   = saliency_np,           # [H, W] float32 in [0, 1]
        overlays   = [img_a, img_b, img_c], # PIL Images or np arrays
        modes      = ["screen", "overlay", "multiply"],
        mask_sigma = 10,                    # saliency mask blur (px)
        mask_gamma = 2.0,                   # sharpens the saliency boundary
        mask_lo    = 0.1,                   # transition zone start (lower = more original)
        mask_hi    = 0.4,                   # transition zone end
    )
    show_composite(Image.open("dog.jpg"), saliency_np, result_rgba,
                   overlays=[img_a, img_b, img_c], modes=["screen", "overlay", "multiply"])

Blend modes
-----------
  normal    – straight alpha composite (baseline)
  screen    – 1-(1-A)(1-B)          classic double-exposure brightening
  multiply  – A*B                   darkens, painterly shadow overlap
  overlay   – Overlay(A,B)          punchy contrast, good for edges
  hard_light– Overlay with A/B swapped (B drives the curve)
  soft_light– Pegtop soft light     subtle, keeps luminance
  luminosity– transfer luma of B into hue/sat of A (HSL)
  difference– |A-B|                 psychedelic / edge-reveal
"""



# ─── types ────────────────────────────────────────────────────────────────────

Arr   = np.ndarray
ImgIn = Union[Image.Image, np.ndarray, str]


class BlendMode(str, Enum):
    NORMAL     = "normal"
    SCREEN     = "screen"
    MULTIPLY   = "multiply"
    OVERLAY    = "overlay"
    HARD_LIGHT = "hard_light"
    SOFT_LIGHT = "soft_light"
    LUMINOSITY = "luminosity"
    DIFFERENCE = "difference"


# ─── helpers ──────────────────────────────────────────────────────────────────

def _to_f32(img: ImgIn, target_hw: Optional[Tuple[int, int]] = None) -> Arr:
    """Load any image-like input → float32 [H, W, 3] in [0, 1]."""
    if isinstance(img, str):
        img = Image.open(img)
    if isinstance(img, Image.Image):
        img = img.convert("RGB")
        if target_hw is not None:
            H, W = target_hw
            img = img.resize((W, H), Image.LANCZOS)
        return np.array(img, dtype=np.float32) / 255.0
    arr = np.asarray(img, dtype=np.float32)
    if arr.max() > 1.0:
        arr = arr / 255.0
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    if arr.shape[2] == 4:
        arr = arr[..., :3]
    if target_hw is not None and arr.shape[:2] != target_hw:
        pil = Image.fromarray((arr * 255).clip(0, 255).astype(np.uint8))
        H, W = target_hw
        pil = pil.resize((W, H), Image.LANCZOS)
        arr = np.array(pil, dtype=np.float32) / 255.0
    return arr


def _checkerboard(H: int, W: int, tile: int = 16) -> Arr:
    """Grey checkerboard [H, W, 3] for visualizing transparency."""
    xs      = np.arange(W) // tile
    ys      = np.arange(H) // tile
    checker = ((xs[np.newaxis, :] + ys[:, np.newaxis]) % 2).astype(np.float32)
    return np.where(checker[..., np.newaxis], 0.85, 0.65).astype(np.float32)


def _composite_on_bg(rgba: Arr, bg: Arr) -> Arr:
    """Alpha-composite RGBA [H, W, 4] onto RGB background [H, W, 3]."""
    rgb = rgba[..., :3]
    a   = rgba[..., 3:4]
    return (rgb * a + bg * (1.0 - a)).clip(0, 1)


def _rgb_to_hsl(rgb: Arr) -> Arr:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cmax  = np.maximum(np.maximum(r, g), b)
    cmin  = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin + 1e-9
    L = (cmax + cmin) / 2.0
    S = np.where(L < 0.5,
                 delta / (cmax + cmin + 1e-9),
                 delta / (2.0 - cmax - cmin + 1e-9))
    S = np.where(delta < 1e-8, 0.0, S)
    H = np.where(cmax == r, (g - b) / delta % 6,
        np.where(cmax == g, (b - r) / delta + 2,
                             (r - g) / delta + 4)) / 6.0
    H = np.where(delta < 1e-8, 0.0, H) % 1.0
    return np.stack([H, S, L], axis=-1)


def _hsl_to_rgb(hsl: Arr) -> Arr:
    H, S, L = hsl[..., 0], hsl[..., 1], hsl[..., 2]
    C  = (1.0 - np.abs(2 * L - 1)) * S
    X  = C * (1.0 - np.abs((H * 6) % 2 - 1))
    m  = L - C / 2.0
    hi = (H * 6).astype(int) % 6
    R  = np.select([hi==0, hi==1, hi==2, hi==3, hi==4, hi==5], [C, X, 0, 0, X, C]) + m
    G  = np.select([hi==0, hi==1, hi==2, hi==3, hi==4, hi==5], [X, C, C, X, 0, 0]) + m
    B  = np.select([hi==0, hi==1, hi==2, hi==3, hi==4, hi==5], [0, 0, X, C, C, X]) + m
    return np.stack([R, G, B], axis=-1).clip(0, 1)


# ─── blend modes ──────────────────────────────────────────────────────────────

def _blend(base: Arr, layer: Arr, mode: str) -> Arr:
    mode = mode.lower().replace("-", "_")
    if mode == "normal":
        return layer
    elif mode == "screen":
        return 1.0 - (1.0 - base) * (1.0 - layer)
    elif mode == "multiply":
        return base * layer
    elif mode == "overlay":
        return np.where(base < 0.5,
                        2.0 * base * layer,
                        1.0 - 2.0 * (1.0 - base) * (1.0 - layer))
    elif mode == "hard_light":
        return np.where(layer < 0.5,
                        2.0 * base * layer,
                        1.0 - 2.0 * (1.0 - base) * (1.0 - layer))
    elif mode == "soft_light":
        return (1.0 - 2.0 * layer) * base ** 2 + 2.0 * layer * base
    elif mode == "luminosity":
        hsl_out         = _rgb_to_hsl(base).copy()
        hsl_out[..., 2] = _rgb_to_hsl(layer)[..., 2]
        return _hsl_to_rgb(hsl_out)
    elif mode == "difference":
        return np.abs(base - layer)
    else:
        warnings.warn(f"Unknown blend mode '{mode}' — falling back to 'screen'.")
        return 1.0 - (1.0 - base) * (1.0 - layer)


# ─── saliency mask ────────────────────────────────────────────────────────────

def _build_mask(
    saliency: np.ndarray,
    sigma:    float,
    gamma:    float,
    lo:       float,
    hi:       float,
) -> np.ndarray:
    """
    Raw saliency [H, W] → spatial weight [H, W, 1] in [0, 1].

    weight = 1  →  keep original (high saliency, fully opaque)
    weight = 0  →  show blend   (low saliency, fully transparent original)

    Pipeline:
      1. Normalise to [0, 1]
      2. Gaussian blur — softens hard patch-grid edges from ViT saliency
         Re-normalises after blur so the full [0,1] range is preserved.
      3. Gamma  — > 1 tightens the protected region (more pixels fall to 0)
                  < 1 expands  it (fewer pixels fall to 0)
      4. Smoothstep [lo, hi] → [0, 1]
           lo  : below this, pixel is fully blended (original transparent)
           hi  : above this, pixel is fully original (original opaque)
           Narrower gap → sharper boundary
    """
    sal = saliency.astype(np.float32)
    sal = (sal - sal.min()) / (sal.max() - sal.min() + 1e-8)

    if sigma > 0:
        sal = gaussian_filter(sal, sigma=sigma)
        sal = (sal - sal.min()) / (sal.max() - sal.min() + 1e-8)

    sal  = np.power(sal, gamma)
    t    = np.clip((sal - lo) / (hi - lo + 1e-8), 0.0, 1.0)
    mask = t * t * (3.0 - 2.0 * t)           # S-curve

    return mask[..., np.newaxis]              # [H, W, 1]


def _blend_overlays_only(
    base:     Arr,
    overlays: List[ImgIn],
    modes:    List[str],
    H:        int,
    W:        int,
) -> Arr:
    """
    Composite all overlays together with NO saliency masking and NO original.
    Starts from the first overlay, then blends each subsequent one on top.
    Used for the 'Blend Only' preview panel in show_composite.
    """
    loaded = [_to_f32(ov, target_hw=(H, W)) for ov in overlays]
    result = loaded[0].copy()
    for i, (ov, mode) in enumerate(zip(loaded[1:], modes[1:]), start=1):
        blended = _blend(result, ov, mode)
        weight  = 1.0 / (i + 1)          # equal running average
        result  = result * (1.0 - weight) + blended * weight
    return result.clip(0, 1)



def composite(
    original:   ImgIn,
    saliency:   np.ndarray,
    overlays:   List[ImgIn],
    modes:      List[str],
    *,
    mask_sigma: float = 10.0,
    mask_gamma: float = 2.0,
    mask_lo:    float = 0.1,
    mask_hi:    float = 0.4,
) -> np.ndarray:
    """
    Saliency-driven compositor.  Returns RGBA [H, W, 4].

    Parameters
    ----------
    original    : Subject image (any size).
    saliency    : Float [H, W] in [0, 1].  High = keep original.
    overlays    : 1–3 images blended into low-saliency regions.
    modes       : Blend mode per overlay.
                  Options: normal | screen | multiply | overlay |
                           hard_light | soft_light | luminosity | difference
    mask_sigma  : Blur radius on saliency (px). Larger → softer boundary.
    mask_gamma  : > 1 (default 2.0) tightens protected region; < 1 expands it.
    mask_lo     : Smoothstep lower bound — below this saliency = fully blended.
    mask_hi     : Smoothstep upper bound — above this saliency = fully original.
                  Decrease both lo and hi to protect more pixels as original.

    Returns
    -------
    rgba : float32 [H, W, 4]
           RGB  = original in high-saliency areas, overlay blend elsewhere
           Alpha = saliency mask (0 = transparent original, 1 = opaque original)
    """
    if len(overlays) != len(modes):
        raise ValueError(f"overlays ({len(overlays)}) and modes ({len(modes)}) must match.")
    if len(overlays) == 0:
        raise ValueError("Provide at least one overlay image.")
    if len(overlays) > 3:
        warnings.warn("More than 3 overlays — only the first 3 will be used.")
        overlays, modes = list(overlays[:3]), list(modes[:3])

    base = _to_f32(original)
    H, W = base.shape[:2]

    if saliency.shape[:2] != (H, W):
        sal_pil  = Image.fromarray((saliency * 255).clip(0, 255).astype(np.uint8))
        saliency = np.array(sal_pil.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0

    # mask: 1 = keep original,  0 = show blend
    mask = _build_mask(saliency, mask_sigma, mask_gamma, mask_lo, mask_hi)

    # Build the overlay blend (saliency-weighted contribution per overlay)
    blend_result = base.copy()
    n = len(overlays)
    for ov_raw, mode in zip(overlays, modes):
        ov       = _to_f32(ov_raw, target_hw=(H, W))
        blended  = _blend(blend_result, ov, mode)
        # Each overlay takes 1/n of the available (1-mask) budget
        alpha_ov     = (1.0 - mask) / n
        blend_result = blend_result * (1.0 - alpha_ov) + blended * alpha_ov

    # RGB: lerp between blend and original based on mask
    rgb  = base * mask + blend_result * (1.0 - mask)
    # Alpha: the mask itself — low saliency = transparent original
    rgba = np.concatenate([rgb, mask], axis=-1)
    return rgba.clip(0.0, 1.0).astype(np.float32)