import type { MorphCanvas } from '../canvas/MorphCanvas'
import type { RightPanel, ClassificationView } from '../panel/RightPanel'
import type { BackendClient } from '../api/BackendClient'
import type { ResultMessage } from '../api/types'
import type { GazeStatus, Patch } from '../input/types'
import type { UploadedImage } from '../upload/ImageUploader'

/**
 * AppState
 * --------
 * Single source of truth orchestrating the dwell→request→morph loop.
 *
 *   dwell fires
 *     → mint requestId, send to backend, store as pendingRequestId
 *     → other in-flight requests are cancelled (for cleanliness; we'd
 *       drop their results anyway via the ID check)
 *   result arrives
 *     → ignore unless requestId === pendingRequestId
 *     → fetch+decode merged image
 *     → call setTarget on canvas, update panel
 *
 * Off-canvas revert:
 *   when gazeStatus becomes off_canvas, start a 500ms timer. if the
 *   cursor returns before it fires, cancel. if it fires, swap the
 *   morph target back to the original bitmap.
 *
 * Image switch:
 *   on new upload, clear current state, reset panel, snap canvas to
 *   the new image (no morph), update imageHash so subsequent dwells
 *   reference the new image.
 */

const REVERT_DELAY_MS = 500

export class AppState {
  private canvas: MorphCanvas
  private panel: RightPanel
  private backend: BackendClient

  private originalImage: UploadedImage | null = null
  private imageHash: string | null = null

  /** Last successful result we've actually applied (or are applying). */
  private currentResult: ResultMessage | null = null

  /** request_id we're waiting on. results with other ids are dropped. */
  private pendingRequestId: string | null = null

  /** for cancellation when a new request preempts an old one */
  private inFlightRequestIds: Set<string> = new Set()

  private revertTimer: number | null = null
  private gazeStatus: GazeStatus = { kind: 'off_canvas' }

  constructor(canvas: MorphCanvas, panel: RightPanel, backend: BackendClient) {
    this.canvas = canvas
    this.panel = panel
    this.backend = backend
  }

  // =========== uploads ===========

  /**
   * Apply a freshly-uploaded image. Snaps the canvas (no morph), resets
   * panel state, uploads to backend, records the new hash.
   */
  async loadImage(img: UploadedImage): Promise<void> {
    this.originalImage = img
    this.canvas.setImage(img)
    this.panel.setHeaderThumb(img)

    // reset all derived state — no carryover from previous image
    this.cancelAllInFlight()
    this.currentResult = null
    this.pendingRequestId = null
    this.clearRevertTimer()
    this.panel.setOriginalClassification(null)
    this.panel.setNewClassification(null)
    this.panel.setOriginalSaliencyUrl(null)
    this.panel.setModifiedSaliencyUrl(null)
    this.panel.setAttendingPatch(null, false)
    this.backend.clearBitmapCache()

    // upload to backend; if it fails we keep displaying the image but
    // dwell-fires won't do anything useful until the user retries
    try {
      const resp = await this.backend.upload(img.blob, img.name)
      this.imageHash = resp.image_hash
      console.log('[AppState] image hash:', resp.image_hash)
    } catch (err) {
      console.error('[AppState] upload failed:', err)
      this.imageHash = null
    }
  }

  // =========== gaze pipeline ===========

  setGazeStatus(status: GazeStatus): void {
    this.gazeStatus = status

    // panel patch indicator
    if (status.kind === 'off_canvas') {
      this.panel.setAttendingPatch(null, false)
    } else {
      this.panel.setAttendingPatch(status.patch, status.kind === 'dwelling')
    }

    // off-canvas revert timer management
    if (status.kind === 'off_canvas') {
      this.scheduleRevert()
    } else {
      this.clearRevertTimer()
    }
  }

  /** Called by DwellDetector when a patch crosses the threshold. */
  onDwellFired(patch: Patch): void {
    if (!this.imageHash) {
      console.warn('[AppState] dwell fired with no image_hash; ignoring')
      return
    }
    this.cancelAllInFlight()
    const requestId = `req-${performance.now().toFixed(0)}-${Math.random().toString(36).slice(2, 8)}`
    this.pendingRequestId = requestId
    this.inFlightRequestIds.add(requestId)
    this.backend.request(requestId, this.imageHash, patch)
    console.log('[AppState] sent request', requestId, 'patch', patch)
  }

  /** Called by BackendClient when a result arrives. */
  async onResult(msg: ResultMessage): Promise<void> {
    this.inFlightRequestIds.delete(msg.request_id)

    // stale? drop.
    if (msg.request_id !== this.pendingRequestId) {
      console.log('[AppState] dropping stale result', msg.request_id)
      return
    }
    // image switched between request and result?
    if (msg.image_hash !== this.imageHash) {
      console.log('[AppState] dropping result for old image', msg.image_hash)
      return
    }

    this.currentResult = msg
    this.applyResult(msg)
  }

  // =========== internals ===========

  private async applyResult(msg: ResultMessage): Promise<void> {
    // panel updates first — they're cheap and look responsive
    const newView: ClassificationView = {
      classId: msg.new_class_id,
      className: msg.new_class_name,
      channelIds: msg.top_3_channel_ids as [number, number, number],
    }
    this.panel.setNewClassification(newView)
    this.panel.setModifiedSaliencyUrl(msg.saliency_url)

    // fetch the merged image and morph to it
    try {
      const bitmap = await this.backend.fetchBitmap(msg.merged_image_url)
      // double-check we still want this — image might have switched mid-fetch
      if (this.currentResult?.request_id !== msg.request_id) return
      this.canvas.setTarget(bitmap)
    } catch (err) {
      console.error('[AppState] failed to fetch merged image:', err)
    }
  }

  private scheduleRevert(): void {
    this.clearRevertTimer()
    this.revertTimer = window.setTimeout(() => {
      this.revertTimer = null
      if (this.originalImage && this.gazeStatus.kind === 'off_canvas') {
        this.canvas.setTarget(this.originalImage)
        // keep panel state — user might still be reading it. it'll be
        // overwritten on the next dwell.
      }
    }, REVERT_DELAY_MS)
  }

  private clearRevertTimer(): void {
    if (this.revertTimer !== null) {
      window.clearTimeout(this.revertTimer)
      this.revertTimer = null
    }
  }

  private cancelAllInFlight(): void {
    for (const id of this.inFlightRequestIds) {
      this.backend.cancel(id)
    }
    this.inFlightRequestIds.clear()
  }
}