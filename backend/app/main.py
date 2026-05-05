"""
FastAPI application entry point.

Run from `backend/`:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import class_labels, precomputed_loader, storage
from .routes.manifest import router as manifest_router
from .routes.morph_ws import router as morph_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # one-time: load labels first (the precomputed loader uses them to
    # resolve class_ids → class_names), then load precomputed JSONs.
    # both fail loudly if anything is missing or malformed.
    class_labels.load()
    precomputed_loader.load_all()

    # # IF RELOADING DATA: wipe runtime cache on every restart so stale renderings can't survive
    # import shutil
    # shutil.rmtree(storage.TMP_ROOT, ignore_errors=True)
    # storage.ensure_tmp_root()
    
    yield


app = FastAPI(title="attention-morph backend", lifespan=lifespan)

# during dev the frontend runs on a separate port and uses Vite's
# proxy. CORS is permissive for safety in case anyone bypasses it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# tmp/ may not exist on first launch; create it before StaticFiles
# validates the mount path. data/ is expected to already exist —
# StaticFiles will raise loudly if not, which is the desired behavior.
storage.ensure_tmp_root()

# static mounts. all read-only except /tmp.
app.mount("/images", StaticFiles(directory=str(storage.DATA_ROOT / "images")), name="images")
app.mount("/channels", StaticFiles(directory=str(storage.DATA_ROOT / "channels")), name="channels")
app.mount("/precomputed", StaticFiles(directory=str(storage.DATA_ROOT / "precomputed")), name="precomputed")
app.mount("/tmp", StaticFiles(directory=str(storage.TMP_ROOT)), name="tmp")

app.include_router(manifest_router)
app.include_router(morph_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "attention-morph backend", "status": "ok"}