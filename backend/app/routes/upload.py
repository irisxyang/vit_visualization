"""POST /upload — accepts an image, returns its hash, kicks off precompute.

We hash the upload first to determine whether this is a new image. If
the hash matches what we currently have in cache (i.e. precompute is
already running or done for this exact image), we short-circuit and
return the hash without disturbing the running precompute.

Otherwise we:
  1. Cancel the in-flight precompute task (if any). This stops new
     PNGs from being written under the old hash's directory while we
     are about to delete it.
  2. Save the new original.
  3. Delete every directory under tmp/ whose name isn't the new hash.
  4. Drop in-memory cache entries that belong to other hashes.
  5. Kick off a fresh precompute for the new hash.
"""

from fastapi import APIRouter, HTTPException, UploadFile

from .. import cache, precompute, storage
from ..schemas import UploadResponse

router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload(file: UploadFile) -> UploadResponse:
    if file.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=415, detail=f"unsupported content type: {file.content_type}")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        image_hash, size = storage.save_uploaded_image(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"could not decode image: {exc}") from exc

    # if this exact image's precompute is already running/done, leave it alone
    if precompute.is_active_for(image_hash):
        return UploadResponse(image_hash=image_hash, size=size)

    # otherwise: this is a different image (or first upload). cancel any
    # other precompute, wipe stale state, kick off fresh.
    await precompute.cancel_active()

    removed_dirs = storage.wipe_others(image_hash)
    dropped_entries = cache.drop_others(image_hash)
    if removed_dirs or dropped_entries:
        print(f"[upload] cleared {removed_dirs} dirs and {dropped_entries} cache entries")

    await precompute.kick_off(image_hash)

    return UploadResponse(image_hash=image_hash, size=size)