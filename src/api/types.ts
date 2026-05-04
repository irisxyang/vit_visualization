/**
 * Wire types mirroring backend/app/schemas.py.
 *
 * Keep these in sync manually. If the schemas grow, consider
 * generating from openapi.json instead.
 */

import type { Patch } from '../input/types'
export type { Patch }

// ---------- HTTP /upload ----------

export interface UploadResponse {
  image_hash: string
  size: number
}

// ---------- WS /morph: client → server ----------

export interface RequestMessage {
  type: 'request'
  request_id: string
  image_hash: string
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
  image_hash: string
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

export interface PrecomputeProgressMessage {
  type: 'precompute_progress'
  image_hash: string
  done: number
  total: number
}

export type ServerMessage =
  | ResultMessage
  | ErrorMessage
  | PrecomputeProgressMessage