/**
 * Wire types mirroring backend/app/schemas.py.
 *
 * Keep these in sync manually.
 */

import type { Patch } from '../input/types'
export type { Patch }

// ---------- HTTP /manifest ----------

export interface ManifestImageView {
  image_id: string
  image_url: string
  original_class_id: number
  original_class_name: string
  original_top_3_channel_ids: number[]
  original_saliency_url: string
}

export interface ManifestResponse {
  images: ManifestImageView[]
}

// ---------- WS /morph: client → server ----------

export interface RequestMessage {
  type: 'request'
  request_id: string
  image_id: string
  patch: Patch
}

export interface CancelMessage {
  type: 'cancel'
  request_id: string
}

export type ClientMessage = RequestMessage | CancelMessage

// ---------- WS /morph: server → client ----------

export interface ResultMessage {
  type: 'result'
  request_id: string
  image_id: string
  patch: Patch
  new_class_id: number
  new_class_name: string
  top_3_channel_ids: number[]
  saliency_url: string
  merged_image_url: string
}

export interface ErrorMessage {
  type: 'error'
  request_id: string | null
  message: string
}

export type ServerMessage = ResultMessage | ErrorMessage