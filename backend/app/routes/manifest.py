"""GET /manifest — returns the list of default images in display order.

The frontend fetches this once at boot to populate its image picker
and to learn baseline (no-concentration) classifications.

Baseline saliency display PNGs are rendered (colormap + blend) on
demand by saliency_display.render(). Cached on disk so subsequent
manifest requests are essentially free.
"""

from fastapi import APIRouter, HTTPException

from .. import precomputed_loader, storage
from ..pipeline import saliency_display
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

        # render the baseline saliency display PNG (idempotent — disk-cached)
        raw_path = storage.resolve_precomputed_url(img.original.saliency_url)
        saliency_display.render(image_id, "original", raw_path)
        display_url = saliency_display.display_url(image_id, "original")

        images.append(
            ManifestImageView(
                image_id=img.image_id,
                image_url=img.image_url,
                original_class_id=img.original.class_id,
                original_class_name=img.original.class_name,
                original_top_3_channel_ids=list(img.original.top_3_channel_ids),
                original_saliency_url=display_url,
            )
        )
    return ManifestResponse(images=images)