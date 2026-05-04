"""
FastAPI application entry point.

Run from `backend/`:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import storage
from .routes.morph_ws import router as morph_router
from .routes.upload import router as upload_router

app = FastAPI(title="attention-morph backend")

# during dev the frontend runs on a separate port and uses Vite's
# proxy. CORS is permissive for safety in case anyone bypasses it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

storage.ensure_tmp_root()
app.mount("/tmp", StaticFiles(directory=str(storage.TMP_ROOT)), name="tmp")

app.include_router(upload_router)
app.include_router(morph_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "attention-morph backend", "status": "ok"}