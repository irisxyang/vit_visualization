import type { ManifestImageView } from '../api/types'

/**
 * ImagePicker
 * -----------
 * Owns three pieces of UI for switching between default images:
 *   1. Left arrow button (positioned by parent CSS, flanking canvas)
 *   2. Right arrow button (same)
 *   3. Thumbnail strip below the canvas
 *
 * Plus a global keydown listener for ArrowLeft / ArrowRight.
 *
 * Wraps around at both ends. Emits `onSelect(image_id)` whenever the
 * active selection changes. Selecting the already-active image is a
 * no-op and does not fire the callback.
 *
 * Owners of this picker should attach the L/R buttons and thumbnails
 * to the DOM in whatever positions they want — `leftButton`,
 * `rightButton`, and `thumbnails` are all individually addressable.
 */

export interface ImagePickerOptions {
  onSelect: (imageId: string) => void
}

export class ImagePicker {
  private images: ManifestImageView[] = []
  private activeIndex: number = 0
  private opts: ImagePickerOptions

  readonly leftButton: HTMLButtonElement
  readonly rightButton: HTMLButtonElement
  readonly thumbnails: HTMLElement
  private thumbEls: HTMLButtonElement[] = []

  constructor(opts: ImagePickerOptions) {
    this.opts = opts

    this.leftButton = document.createElement('button')
    this.leftButton.className = 'arrow-button arrow-left'
    this.leftButton.setAttribute('aria-label', 'previous image')
    this.leftButton.textContent = '‹'
    this.leftButton.addEventListener('click', () => this.step(-1))

    this.rightButton = document.createElement('button')
    this.rightButton.className = 'arrow-button arrow-right'
    this.rightButton.setAttribute('aria-label', 'next image')
    this.rightButton.textContent = '›'
    this.rightButton.addEventListener('click', () => this.step(1))

    this.thumbnails = document.createElement('div')
    this.thumbnails.className = 'thumbnails'

    document.addEventListener('keydown', this.handleKey)
  }

  /** Populate the picker with the manifest's images and select the first. */
  setImages(images: ManifestImageView[]): void {
    this.images = images
    this.thumbnails.innerHTML = ''
    this.thumbEls = []

    images.forEach((img, idx) => {
      const btn = document.createElement('button')
      btn.className = 'thumbnail'
      btn.setAttribute('aria-label', img.image_id)
      btn.title = img.image_id
      btn.style.backgroundImage = `url('${img.image_url}')`
      btn.addEventListener('click', () => this.selectIndex(idx))
      this.thumbnails.appendChild(btn)
      this.thumbEls.push(btn)
    })

    if (images.length > 0) {
      this.activeIndex = 0
      this.applyActiveStyles()
      // fire initial selection so the rest of the app loads the default
      this.opts.onSelect(images[0].image_id)
    }
  }

  /** Programmatic selection by image_id (no-op if already active). */
  selectById(imageId: string): void {
    const idx = this.images.findIndex((img) => img.image_id === imageId)
    if (idx !== -1) this.selectIndex(idx)
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKey)
  }

  // ----- internals -----

  private handleKey = (e: KeyboardEvent): void => {
    // ignore typing in inputs / textareas
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return

    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      this.step(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      this.step(1)
    }
  }

  private step(delta: number): void {
    if (this.images.length === 0) return
    const n = this.images.length
    const next = (((this.activeIndex + delta) % n) + n) % n  // wraparound
    this.selectIndex(next)
  }

  private selectIndex(idx: number): void {
    if (idx === this.activeIndex) return
    if (idx < 0 || idx >= this.images.length) return
    this.activeIndex = idx
    this.applyActiveStyles()
    this.opts.onSelect(this.images[idx].image_id)
  }

  private applyActiveStyles(): void {
    this.thumbEls.forEach((el, i) => {
      el.classList.toggle('active', i === this.activeIndex)
    })
  }
}