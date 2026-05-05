import type { MorphCanvas } from '../canvas/MorphCanvas'
import type { RightPanel, ClassificationView } from '../panel/RightPanel'
import type { BackendClient } from '../api/BackendClient'
import type { ManifestImageView, ResultMessage } from '../api/types'
import type { GazeStatus, Patch } from '../input/types'
import type { DwellDetector } from '../input/DwellDetector'

/**
 * AppState
 * --------
 * Single source of truth orchestrating the dwell→request→morph loop.
 *
 *   image selected
 *     → fetch source bitmap, snap canvas (no morph)
 *     → reset panel; populate "original" classification + saliency
 *       from the manifest entry
 *     → record imageId; future requests reference it
 *
 *   dwell fires
 *     → mint requestId, send to backend, store as pendingRequestId
 *     → cancel any in-flight requests (cleanliness; we'd drop their
 *       results anyway via the ID check)
 *
 *   result arrives
 *     → ignore unless requestId === pendingRequestId AND image_id matches
 *     → fetch+decode merged image
 *     → call setTarget on canvas, update "new" panel slots
 *
 *   off-canvas revert:
 *     when gazeStatus becomes off_canvas, start a 500ms timer. if the
 *     cursor returns before it fires, cancel. if it fires, swap the
 *     morph target back to the original bitmap.
 */

const REVERT_DELAY_MS = 500

export class AppState {
  private canvas: MorphCanvas
  private panel: RightPanel
  private backend: BackendClient
  private dwellDetector: DwellDetector

  /** Source bitmap of the currently selected image, used for revert. */
  private originalBitmap: ImageBitmap | null = null
  private imageId: string | null = null

  /** Last successful result we've actually applied (or are applying). */
  private currentResult: ResultMessage | null = null

  /** request_id we're waiting on. results with other ids are dropped. */
  private pendingRequestId: string | null = null

  /** for cancellation when a new request preempts an old one */
  private inFlightRequestIds: Set<string> = new Set()

  private revertTimer: number | null = null
  private gazeStatus: GazeStatus = { kind: 'off_canvas' }

  constructor(
    canvas: MorphCanvas,
    panel: RightPanel,
    backend: BackendClient,
    dwellDetector: DwellDetector,
  ) {
    this.canvas = canvas
    this.panel = panel
    this.backend = backend
    this.dwellDetector = dwellDetector
  }

  // =========== image selection ===========

  /**
   * Switch to a default image. Snaps the canvas (no morph), resets
   * panel, populates the "original" panel section from the manifest.
   */
  async selectImage(entry: ManifestImageView): Promise<void> {
    if (this.imageId === entry.image_id) return  // no-op

    // ---- tear down state from previous image ----
    this.cancelAllInFlight()
    this.currentResult = null
    this.pendingRequestId = null
    this.clearRevertTimer()
    // also reset any in-progress dwell timer on the old image
    this.dwellDetector.handle({ kind: 'leave' })
    this.backend.clearBitmapCache()

    // ---- fetch new image bitmap ----
    let bitmap: ImageBitmap
    try {
      bitmap = await this.backend.fetchBitmap(entry.image_url)
    } catch (err) {
      console.error('[AppState] failed to fetch source image:', err)
      return
    }

    this.imageId = entry.image_id
    this.originalBitmap = bitmap
    // setImage takes our local UploadedImage-like shape; canvas
    // accepts a bare ImageBitmap as well (see MorphCanvas.setImage).
    this.canvas.setImage(bitmap)
    this.panel.setHeaderThumb(bitmap)

    // ---- populate panel: original section from manifest ----
    const original: ClassificationView = {
      classId: entry.original_class_id,
      className: entry.original_class_name,
      channelIds: entry.original_top_3_channel_ids as [number, number, number],
    }
    this.panel.setOriginalClassification(original)
    this.panel.setOriginalSaliencyUrl(entry.original_saliency_display_url)

    // ---- clear "new" section; will fill in once user dwells ----
    this.panel.setNewClassification(null)
    this.panel.setModifiedSaliencyUrl(null)
    this.panel.setAttendingPatch(null, false)

    console.log('[AppState] selected', entry.image_id)
  }

  // =========== gaze pipeline ===========

  setGazeStatus(status: GazeStatus): void {
    this.gazeStatus = status

    if (status.kind === 'off_canvas') {
      this.panel.setAttendingPatch(null, false)
      this.scheduleRevert()
    } else {
      this.panel.setAttendingPatch(status.patch, status.kind === 'dwelling')
      this.clearRevertTimer()
    }
  }

  /** Called by DwellDetector when a patch crosses the threshold. */
  onDwellFired(patch: Patch): void {
    if (!this.imageId) {
      console.warn('[AppState] dwell fired with no image_id; ignoring')
      return
    }
    this.cancelAllInFlight()
    const requestId = `req-${performance.now().toFixed(0)}-${Math.random().toString(36).slice(2, 8)}`
    this.pendingRequestId = requestId
    this.inFlightRequestIds.add(requestId)
    this.backend.request(requestId, this.imageId, patch)
    console.log('[AppState] sent request', requestId, 'patch', patch)
  }

  /** Called by BackendClient when a result arrives. */
  async onResult(msg: ResultMessage): Promise<void> {
    this.inFlightRequestIds.delete(msg.request_id)

    if (msg.request_id !== this.pendingRequestId) {
      console.log('[AppState] dropping stale result', msg.request_id)
      return
    }
    if (msg.image_id !== this.imageId) {
      console.log('[AppState] dropping result for old image', msg.image_id)
      return
    }

    this.currentResult = msg
    await this.applyResult(msg)
  }

  // =========== internals ===========

  private async applyResult(msg: ResultMessage): Promise<void> {
    const newView: ClassificationView = {
      classId: msg.new_class_id,
      className: msg.new_class_name,
      channelIds: msg.top_3_channel_ids as [number, number, number],
    }
    this.panel.setNewClassification(newView)
    this.panel.setModifiedSaliencyUrl(msg.saliency_url)

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
      if (this.originalBitmap && this.gazeStatus.kind === 'off_canvas') {
        this.canvas.setTarget(this.originalBitmap)
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