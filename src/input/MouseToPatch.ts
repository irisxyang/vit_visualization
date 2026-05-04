import type { Patch, PatchEvent } from '../api/types'

/**
 * MouseToPatch
 * ------------
 * Translates raw mouse motion into discrete patch events.
 *
 * We listen on `hitTarget` (the container) but compute coordinates
 * against `canvas` (the actual image element). This matters when the
 * canvas has overlay siblings — e.g. the upload button positioned on
 * top of the canvas. Listening on the container means brushing the
 * overlay doesn't trigger spurious mouseleave events; the bubbling
 * mousemove still reaches us, and getBoundingClientRect on the canvas
 * gives accurate patch coordinates.
 *
 * Emits 'enter' only when the patch under the cursor actually changes
 * (no spam from intra-patch motion). Emits 'leave' once when the
 * mouse exits the hit target.
 */

export interface MouseToPatchOptions {
  /** Element that receives mouse events. */
  hitTarget: HTMLElement
  /** Element whose bounding rect defines the coordinate system. */
  canvas: HTMLElement
  /** Patches per side (default 14, for DeiT-Tiny). */
  gridSize?: number
  onChange: (event: PatchEvent) => void
}

export class MouseToPatch {
  private hitTarget: HTMLElement
  private canvas: HTMLElement
  private gridSize: number
  private onChange: (event: PatchEvent) => void
  private lastPatch: Patch | null = null

  constructor(opts: MouseToPatchOptions) {
    this.hitTarget = opts.hitTarget
    this.canvas = opts.canvas
    this.gridSize = opts.gridSize ?? 14
    this.onChange = opts.onChange

    this.hitTarget.addEventListener('mousemove', this.handleMove)
    this.hitTarget.addEventListener('mouseenter', this.handleMove)
    this.hitTarget.addEventListener('mouseleave', this.handleLeave)
  }

  destroy(): void {
    this.hitTarget.removeEventListener('mousemove', this.handleMove)
    this.hitTarget.removeEventListener('mouseenter', this.handleMove)
    this.hitTarget.removeEventListener('mouseleave', this.handleLeave)
  }

  private handleMove = (e: MouseEvent): void => {
    const patch = this.computePatch(e.clientX, e.clientY)
    if (
      this.lastPatch === null ||
      this.lastPatch.row !== patch.row ||
      this.lastPatch.col !== patch.col
    ) {
      this.lastPatch = patch
      this.onChange({ kind: 'enter', patch })
    }
  }

  private handleLeave = (): void => {
    if (this.lastPatch !== null) {
      this.lastPatch = null
      this.onChange({ kind: 'leave' })
    }
  }

  private computePatch(clientX: number, clientY: number): Patch {
    const rect = this.canvas.getBoundingClientRect()
    const fx = (clientX - rect.left) / rect.width
    const fy = (clientY - rect.top) / rect.height
    const g = this.gridSize
    const col = Math.max(0, Math.min(g - 1, Math.floor(fx * g)))
    const row = Math.max(0, Math.min(g - 1, Math.floor(fy * g)))
    return { row, col }
  }
}