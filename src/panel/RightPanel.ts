import type { Patch } from '../input/types'

/**
 * RightPanel
 * ----------
 * The information panel on the right side of the UI. Mirrors the
 * mockup's layout: header thumb + title, original classification,
 * "now attending to patch", new classification, saliency maps.
 *
 * Most slots are still placeholders; setters exist for everything so
 * future steps can wire in real data without touching the DOM here.
 */

/** Internal resolution for the header thumb canvas. Pinned so the red
 *  patch outline stays crisp regardless of source image size. */
const THUMB_RES = 256

export interface ClassificationView {
  classId: number
  className: string
  channelIds: [number, number, number]
}

export class RightPanel {
  private root: HTMLElement

  // header thumb canvas (small image with red square overlay)
  private thumbCanvas: HTMLCanvasElement
  private thumbCtx: CanvasRenderingContext2D
  private thumbBitmap: ImageBitmap | null = null
  private thumbPatch: Patch | null = null
  private thumbDwelling: boolean = false

  // dynamic text + image slots
  private origClassEl: HTMLElement
  private origChannelsEls: HTMLElement[]
  private attendingEl: HTMLElement
  private newClassEl: HTMLElement
  private newChannelsEls: HTMLElement[]
  private origChannelImgs: HTMLElement[]
  private newChannelImgs: HTMLElement[]
  private origSaliencyEl: HTMLElement
  private newSaliencyEl: HTMLElement

  constructor() {
    this.root = document.createElement('aside')
    this.root.className = 'panel'
    this.root.innerHTML = TEMPLATE

    this.thumbCanvas = this.root.querySelector('.thumb-image canvas')!
    this.thumbCanvas.width = THUMB_RES
    this.thumbCanvas.height = THUMB_RES
    const ctx = this.thumbCanvas.getContext('2d')
    if (!ctx) throw new Error('RightPanel: could not get thumb 2d context')
    this.thumbCtx = ctx
    this.thumbCtx.imageSmoothingEnabled = true
    this.thumbCtx.imageSmoothingQuality = 'high'

    this.origClassEl = this.q('[data-slot="orig-class"]')
    this.origChannelsEls = this.qa('[data-slot="orig-channel-label"]')
    this.attendingEl = this.q('[data-slot="attending-coords"]')
    this.newClassEl = this.q('[data-slot="new-class"]')
    this.newChannelsEls = this.qa('[data-slot="new-channel-label"]')

    this.origChannelImgs = this.qa('[data-slot="orig-channel-img"]')
    this.newChannelImgs = this.qa('[data-slot="new-channel-img"]')
    this.origSaliencyEl = this.q('[data-slot="orig-saliency"]')
    this.newSaliencyEl = this.q('[data-slot="new-saliency"]')
  }

  get element(): HTMLElement {
    return this.root
  }

  /** Append an externally-built section (e.g. SettingsControls) to the panel. */
  appendSection(el: HTMLElement): void {
    this.root.appendChild(el)
  }

  /** Insert an externally-built section at the top of the panel. */
  prependSection(el: HTMLElement): void {
    this.root.insertBefore(el, this.root.firstChild)
  }

  // ----- public setters -----

  setHeaderThumb(bitmap: ImageBitmap): void {
    this.thumbBitmap = bitmap
    this.redrawThumb()
  }

  /**
   * Update the patch indicator. Pass `dwelling=true` to show the
   * "fired" visual state (thicker outline + emphasized label).
   */
  setAttendingPatch(patch: Patch | null, dwelling: boolean = false): void {
    this.thumbPatch = patch
    this.thumbDwelling = dwelling && patch !== null
    this.attendingEl.textContent = patch ? `(${patch.row}, ${patch.col})` : '—'
    this.attendingEl.classList.toggle('dwelling', this.thumbDwelling)
    this.redrawThumb()
  }

  setOriginalClassification(view: ClassificationView | null): void {
    if (!view) {
      this.origClassEl.textContent = '—'
      this.origChannelsEls.forEach((el) => (el.textContent = '—'))
      this.origChannelImgs.forEach((el) => (el.style.backgroundImage = ''))
      return
    }
    this.origClassEl.textContent = `${view.classId} (${view.className})`
    view.channelIds.forEach((id, i) => {
      this.origChannelsEls[i].textContent = String(id)
      this.origChannelImgs[i].style.backgroundImage = `url('/api/channels/block11_ch${id}.png')`
    })
  }

  setNewClassification(view: ClassificationView | null): void {
    if (!view) {
      this.newClassEl.textContent = '—'
      this.newChannelsEls.forEach((el) => (el.textContent = '—'))
      this.newChannelImgs.forEach((el) => (el.style.backgroundImage = ''))
      return
    }
    this.newClassEl.textContent = `${view.classId} (${view.className})`
    view.channelIds.forEach((id, i) => {
      this.newChannelsEls[i].textContent = String(id)
      this.newChannelImgs[i].style.backgroundImage = `url('/api/channels/block11_ch${id}.png')`
    })
  }

  setOriginalSaliencyUrl(url: string | null): void {
    this.origSaliencyEl.style.backgroundImage = url ? `url('${url}')` : ''
  }

  setModifiedSaliencyUrl(url: string | null): void {
    this.newSaliencyEl.style.backgroundImage = url ? `url('${url}')` : ''
  }

  // ----- internals -----

  private redrawThumb(): void {
    if (!this.thumbBitmap) return
    const w = this.thumbCanvas.width
    const h = this.thumbCanvas.height
    const ctx = this.thumbCtx

    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(this.thumbBitmap, 0, 0, w, h)

    if (!this.thumbPatch) return

    const gridSize = 14
    const patchW = w / gridSize
    const patchH = h / gridSize
    const x = this.thumbPatch.col * patchW
    const y = this.thumbPatch.row * patchH

    if (this.thumbDwelling) {
      // emphasized: thicker outline + faint fill
      ctx.fillStyle = 'rgba(255, 77, 77, 0.18)'
      ctx.fillRect(x, y, patchW, patchH)
      ctx.strokeStyle = '#ff4d4d'
      ctx.lineWidth = 6
    } else {
      // scanning: clean outline
      ctx.strokeStyle = '#ff4d4d'
      ctx.lineWidth = 3
    }
    ctx.strokeRect(x, y, patchW, patchH)
  }

  private q(selector: string): HTMLElement {
    const el = this.root.querySelector(selector)
    if (!el) throw new Error(`RightPanel: missing element ${selector}`)
    return el as HTMLElement
  }

  private qa(selector: string): HTMLElement[] {
    return Array.from(this.root.querySelectorAll(selector)) as HTMLElement[]
  }
}

const TEMPLATE = /* html */ `
  <div class="panel-header">
    <div class="header-thumb">
      <div class="thumb-image">
        <canvas></canvas>
      </div>
      <div class="thumb-caption">current patch</div>
    </div>
    <div class="header-text">
      <div class="title">classification by DeiT-Tiny (Meta)</div>
      <div class="subtitle">channel visualizations from
DeiT-Tiny block 11 embeddings</div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">original classification: <span data-slot="orig-class" class="placeholder">—</span></div>
    <div class="section-label">top contributing channels:</div>
    <div class="tile-row">
      <div class="tile">
        <div class="tile-image" data-slot="orig-channel-img"></div>
        <div class="tile-label" data-slot="orig-channel-label">—</div>
      </div>
      <div class="tile">
        <div class="tile-image" data-slot="orig-channel-img"></div>
        <div class="tile-label" data-slot="orig-channel-label">—</div>
      </div>
      <div class="tile">
        <div class="tile-image" data-slot="orig-channel-img"></div>
        <div class="tile-label" data-slot="orig-channel-label">—</div>
      </div>
    </div>
  </div>

  <div class="attending">
    now attending to patch: <span class="coords" data-slot="attending-coords">—</span>
  </div>

  <div class="section">
    <div class="section-label">new classification: <span data-slot="new-class" class="placeholder">—</span></div>
    <div class="section-label">top contributing channels:</div>
    <div class="tile-row">
      <div class="tile">
        <div class="tile-image" data-slot="new-channel-img"></div>
        <div class="tile-label" data-slot="new-channel-label">—</div>
      </div>
      <div class="tile">
        <div class="tile-image" data-slot="new-channel-img"></div>
        <div class="tile-label" data-slot="new-channel-label">—</div>
      </div>
      <div class="tile">
        <div class="tile-image" data-slot="new-channel-img"></div>
        <div class="tile-label" data-slot="new-channel-label">—</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-label">saliency maps:</div>
    <div class="saliency-row">
      <div class="saliency-tile">
        <div class="saliency-image" data-slot="orig-saliency"></div>
        <div class="saliency-label">original relevancy</div>
      </div>
      <div class="saliency-tile">
        <div class="saliency-image" data-slot="new-saliency"></div>
        <div class="saliency-label">modified relevancy</div>
      </div>
    </div>
  </div>
`