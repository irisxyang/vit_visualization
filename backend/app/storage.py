"""
Filesystem path helpers.

Layout under `backend/`:

    backend/
    ├── data/                       # READ-ONLY at runtime, populated by precompute
    │   ├── manifest.json
    │   ├── images/
    │   │   ├── dog.png
    │   │   ├── hotdog.png
    │   │   ├── cat.png
    │   │   └── coffee.png
    │   ├── channels/
    │   │   ├── 0.png ... 191.png   # rep-max images for DeiT-Tiny block 11
    │   └── precomputed/
    │       ├── dog.json
    │       ├── dog/
    │       │   ├── original_saliency_display.png
    │       │   ├── original_saliency_raw.png
    │       │   ├── 0_0_saliency_display.png
    │       │   ├── 0_0_saliency_raw.png
    │       │   └── ...
    │       └── ...
    └── tmp/                        # RUNTIME-WRITTEN: merged images cached here
        └── <image_id>/
            └── <row>_<col>/
                └── merged.png
"""

from __future__ import annotations

from pathlib import Path

# repo_root/backend
BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = BACKEND_ROOT / "data"
TMP_ROOT = BACKEND_ROOT / "tmp"


# ---------- read-only data paths ----------

def manifest_path() -> Path:
    return DATA_ROOT / "manifest.json"


def precomputed_json_path(image_id: str) -> Path:
    return DATA_ROOT / "precomputed" / f"{image_id}.json"


def source_image_path(image_id: str) -> Path:
    return DATA_ROOT / "images" / f"{image_id}.png"


def saliency_raw_path(image_id: str, row: int, col: int) -> Path:
    return DATA_ROOT / "precomputed" / image_id / f"{row}_{col}_saliency_raw.png"


def channel_image_path(channel_id: int) -> Path:
    return DATA_ROOT / "channels" / f"{channel_id}.png"


# ---------- runtime tmp paths ----------

def ensure_tmp_root() -> None:
    TMP_ROOT.mkdir(parents=True, exist_ok=True)


def merged_path(image_id: str, row: int, col: int) -> Path:
    return TMP_ROOT / image_id / f"{row}_{col}" / "merged.png"


# ---------- URL helpers ----------
#
# The frontend's vite proxy maps /api/* → backend /*.

URL_PREFIX = "/api"


def merged_url(image_id: str, row: int, col: int) -> str:
    return f"{URL_PREFIX}/tmp/{image_id}/{row}_{col}/merged.png"


def source_image_url(image_id: str) -> str:
    return f"{URL_PREFIX}/images/{image_id}.png"