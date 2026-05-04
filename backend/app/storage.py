"""
Disk storage for uploaded images and generated artifacts.

Layout under `backend/tmp/`:

    tmp/
    └── <image_hash>/
        ├── original.png
        └── <row>_<col>/
            ├── saliency.png
            └── merged.png

`image_hash` is a truncated SHA-256 of the cropped PNG bytes of the
upload. Content-addressable: re-uploading the same image produces the
same hash, so cached results are reused across sessions.
"""

from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

from PIL import Image


# repo_root/backend/tmp
TMP_ROOT = Path(__file__).resolve().parent.parent / "tmp"


def ensure_tmp_root() -> None:
    TMP_ROOT.mkdir(parents=True, exist_ok=True)


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def image_dir(image_hash: str) -> Path:
    return TMP_ROOT / image_hash


def patch_dir(image_hash: str, row: int, col: int) -> Path:
    return image_dir(image_hash) / f"{row}_{col}"


def original_path(image_hash: str) -> Path:
    return image_dir(image_hash) / "original.png"


def saliency_path(image_hash: str, row: int, col: int) -> Path:
    return patch_dir(image_hash, row, col) / "saliency.png"


def merged_path(image_hash: str, row: int, col: int) -> Path:
    return patch_dir(image_hash, row, col) / "merged.png"


# ---------- URL helpers ----------
#
# The frontend's vite proxy maps /api/* → backend /*. The backend
# mounts static files at /tmp, and we hand out URLs prefixed with /api
# so the browser hits the proxy correctly.


URL_PREFIX = "/api"


def saliency_url(image_hash: str, row: int, col: int) -> str:
    return f"{URL_PREFIX}/tmp/{image_hash}/{row}_{col}/saliency.png"


def merged_url(image_hash: str, row: int, col: int) -> str:
    return f"{URL_PREFIX}/tmp/{image_hash}/{row}_{col}/merged.png"


# ---------- image upload helpers ----------


def center_crop_to_square(img: Image.Image) -> Image.Image:
    side = min(img.size)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    return img.crop((left, top, left + side, top + side))


def save_uploaded_image(raw_bytes: bytes) -> tuple[str, int]:
    """
    Center-crop the uploaded image, save as PNG, return (hash, size).

    Hash is computed from the cropped PNG bytes so the same logical
    image always hits the same cache entry.
    """
    ensure_tmp_root()
    img = Image.open(BytesIO(raw_bytes)).convert("RGB")
    cropped = center_crop_to_square(img)

    buf = BytesIO()
    cropped.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    image_hash = hash_bytes(png_bytes)
    image_dir(image_hash).mkdir(parents=True, exist_ok=True)
    out = original_path(image_hash)
    if not out.exists():
        out.write_bytes(png_bytes)

    return image_hash, cropped.width


def load_original(image_hash: str) -> Image.Image:
    return Image.open(original_path(image_hash)).convert("RGB")


def wipe_others(active_hash: str) -> int:
    """
    Delete every directory under TMP_ROOT whose name is not active_hash.
    Returns the count removed. Caller is responsible for first cancelling
    any in-flight precompute that might be writing into one of these
    directories.
    """
    import shutil

    if not TMP_ROOT.exists():
        return 0
    removed = 0
    for entry in TMP_ROOT.iterdir():
        if entry.is_dir() and entry.name != active_hash:
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return removed