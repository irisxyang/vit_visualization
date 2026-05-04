import type { GazeStatus } from '../input/types'

/**
 * DwellProgressBar
 * ----------------
 * Thin overlay along the bottom edge of the canvas frame that fills
 * 0→100% over the dwell threshold while a patch is being scanned.
 * Fades out when the user enters the dwelling or off_canvas state.
 *
 * State is fully derived from GazeStatus — pass status changes in via
 * `setStatus()` and the bar handles its own animation via rAF.
 */
export class DwellProgressBar {
  private root: HTMLElement
  private fill: HTMLElement
  private dwellMs: number
  private status: GazeStatus = { kind: 'off_canvas' }
  private rafId: number | null = null

  constructor(dwellMs: number) {
    this.dwellMs = dwellMs
    this.root = document.createElement('div')
    this.root.className = 'dwell-bar'
    this.fill = document.createElement('div')
    this.fill.className = 'dwell-bar-fill'
    this.root.appendChild(this.fill)
  }

  get element(): HTMLElement {
    return this.root
  }

  setStatus(status: GazeStatus): void {
    this.status = status
    if (status.kind === 'scanning') {
      // snap to 0 immediately — otherwise the previous patch's last
      // width is briefly visible until the next rAF frame.
      this.fill.style.width = '0%'
      this.root.classList.add('visible')
      this.startLoop()
    } else {
      // bar fades via CSS opacity transition; width stays at its last
      // value so the fade reads as "we got this far, then released".
      this.root.classList.remove('visible')
      this.stopLoop()
    }
  }

  destroy(): void {
    this.stopLoop()
  }

  private startLoop(): void {
    if (this.rafId !== null) return
    const tick = () => {
      if (this.status.kind !== 'scanning') {
        this.rafId = null
        return
      }
      const elapsed = performance.now() - this.status.enteredAt
      const progress = Math.min(1, Math.max(0, elapsed / this.dwellMs))
      this.fill.style.width = `${progress * 100}%`
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}