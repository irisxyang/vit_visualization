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
# HTTP /upload
# =====================================================================


class UploadResponse(BaseModel):
    image_hash: str
    size: int  # side length in pixels of the (cropped, square) image


# =====================================================================
# WS /morph — client → server
# =====================================================================


class RequestMessage(BaseModel):
    type: Literal["request"] = "request"
    request_id: str
    image_hash: str
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
    image_hash: str
    patch: Patch
    new_class_id: int
    new_class_name: str
    top_3_channel_ids: list[int]  # length 3
    saliency_url: str  # served via /api/tmp/...
    merged_image_url: str


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    request_id: str | None
    message: str


class PrecomputeProgressMessage(BaseModel):
    type: Literal["precompute_progress"] = "precompute_progress"
    image_hash: str
    done: int
    total: int


ServerMessage = Annotated[
    Union[ResultMessage, ErrorMessage, PrecomputeProgressMessage],
    Field(discriminator="type"),
]