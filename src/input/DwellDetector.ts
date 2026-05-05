import type { Patch, PatchEvent, GazeStatus } from './types'

/**
 * DwellDetector
 * -------------
 * Consumes PatchEvents from MouseToPatch and tracks dwell state.
 *
 * State machine:
 *   off_canvas
 *     ─(enter P)─→ scanning(P)
 *
 *   scanning(P)
 *     ─(enter P)──── (no-op, same patch — timer keeps running)
 *     ─(enter Q)─→ scanning(Q) (timer reset)
 *     ─(leave)──→ off_canvas (timer cancelled)
 *     ─(timer fires)─→ dwelling(P) + onDwellFired(P)
 *
 *   dwelling(P)  [LATCH]
 *     ─(enter P)──── (no-op — already locked on)
 *     ─(enter Q)─→ scanning(Q) (timer reset; Q can dwell after threshold)
 *     ─(leave)──→ off_canvas
 *
 * Latch behavior: once a patch dwells, we don't re-fire while the
 * cursor stays on it. Moving away and back DOES rearm — that's a new
 * "look" and should re-trigger the pipeline.
 */

export interface DwellDetectorOptions {
  /** Dwell threshold in ms. Default 3000. */
  dwellMs?: number
  /** Fired once when a patch crosses the dwell threshold. */
  onDwellFired: (patch: Patch) => void
  /** Fired on every status transition. Useful for UI updates. */
  onStatusChange?: (status: GazeStatus) => void
}

export class DwellDetector {
  private dwellMs: number
  private onDwellFired: (patch: Patch) => void
  private onStatusChange?: (status: GazeStatus) => void
  private status: GazeStatus = { kind: 'off_canvas' }
  private timerId: number | null = null

  constructor(opts: DwellDetectorOptions) {
    this.dwellMs = opts.dwellMs ?? 3000
    this.onDwellFired = opts.onDwellFired
    this.onStatusChange = opts.onStatusChange
  }

  /** Feed in a PatchEvent (typically from MouseToPatch). */
  handle(event: PatchEvent): void {
    if (event.kind === 'leave') {
      this.transitionToOffCanvas()
    } else {
      this.handleEnter(event.patch)
    }
  }

  getStatus(): GazeStatus {
    return this.status
  }

  /**
   * Update the dwell threshold. Affects subsequent patch entries.
   * If a patch is currently being scanned, its in-flight timer is
   * NOT updated — the next `enter` event picks up the new value.
   */
  setDwellMs(ms: number): void {
    this.dwellMs = Math.max(50, ms)
  }

  destroy(): void {
    this.cancelTimer()
  }

  private handleEnter(patch: Patch): void {
    // already on this patch (scanning or latched-dwelling)? no state change.
    if (
      (this.status.kind === 'scanning' || this.status.kind === 'dwelling') &&
      samePatch(this.status.patch, patch)
    ) {
      return
    }
    // new patch (or first one after off_canvas). arm a fresh timer.
    this.cancelTimer()
    this.status = { kind: 'scanning', patch, enteredAt: performance.now() }
    this.notify()

    this.timerId = window.setTimeout(() => {
      this.timerId = null
      // the cursor may have moved during the wait — only fire if we're
      // still on the same patch in scanning state.
      if (this.status.kind === 'scanning' && samePatch(this.status.patch, patch)) {
        this.status = { kind: 'dwelling', patch, firedAt: performance.now() }
        this.notify()
        this.onDwellFired(patch)
      }
    }, this.dwellMs)
  }

  private transitionToOffCanvas(): void {
    if (this.status.kind === 'off_canvas') return
    this.cancelTimer()
    this.status = { kind: 'off_canvas' }
    this.notify()
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  private notify(): void {
    this.onStatusChange?.(this.status)
  }
}

function samePatch(a: Patch, b: Patch): boolean {
  return a.row === b.row && a.col === b.col
}