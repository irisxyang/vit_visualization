"""
Wire schemas shared by HTTP and WebSocket routes.

The WS protocol uses a discriminated union on the `type` field. Both
client and server are expected to send only the message types defined
here; anything else is treated as a protocol error and the connection
is closed.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# =====================================================================
# common
# =====================================================================


class Patch(BaseModel):
    """Patch coordinate in the 14×14 grid (origin top-left)."""

    row: int = Field(ge=0, le=13)
    col: int = Field(ge=0, le=13)


# =====================================================================
# HTTP /manifest
# =====================================================================


class ManifestImageView(BaseModel):
    """One entry per default image, returned in display order."""

    image_id: str
    image_url: str
    original_class_id: int
    original_class_name: str
    original_top_3_channel_ids: list[int]
    original_saliency_display_url: str


class ManifestResponse(BaseModel):
    images: list[ManifestImageView]


# =====================================================================
# WS /morph — client → server
# =====================================================================


class RequestMessage(BaseModel):
    type: Literal["request"] = "request"
    request_id: str
    image_id: str
    patch: Patch


class CancelMessage(BaseModel):
    type: Literal["cancel"] = "cancel"
    request_id: str


ClientMessage = Annotated[
    Union[RequestMessage, CancelMessage],
    Field(discriminator="type"),
]


# =====================================================================
# WS /morph — server → client
# =====================================================================


class ResultMessage(BaseModel):
    type: Literal["result"] = "result"
    request_id: str
    image_id: str
    patch: Patch
    new_class_id: int
    new_class_name: str
    top_3_channel_ids: list[int]  # length 3
    saliency_url: str  # served via /api/precomputed/...
    merged_image_url: str  # served via /api/tmp/...


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    request_id: str | None
    message: str


ServerMessage = Annotated[
    Union[ResultMessage, ErrorMessage],
    Field(discriminator="type"),
]