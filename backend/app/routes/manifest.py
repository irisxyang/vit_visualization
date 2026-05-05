"""GET /manifest — returns the list of default images in display order.

The frontend fetches this once at boot to populate its image picker
and to learn baseline (no-concentration) classifications.
"""

from fastapi import APIRouter, HTTPException

from .. import precomputed_loader
from ..schemas import ManifestImageView, ManifestResponse

router = APIRouter()


@router.get("/manifest", response_model=ManifestResponse)
async def manifest() -> ManifestResponse:
    image_ids = precomputed_loader.order()
    images = []
    for image_id in image_ids:
        img = precomputed_loader.get_image(image_id)
        if img is None:
            # shouldn't happen; load_all() fails fast if anything is missing
            raise HTTPException(status_code=500, detail=f"image {image_id} missing from cache")
        images.append(
            ManifestImageView(
                image_id=img.image_id,
                image_url=img.image_url,
                original_class_id=img.original.class_id,
                original_class_name=img.original.class_name,
                original_top_3_channel_ids=list(img.original.top_3_channel_ids),
                original_saliency_display_url=img.original.saliency_display_url,
            )
        )
    return ManifestResponse(images=images)