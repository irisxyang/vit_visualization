/**
 * ImageUploader
 * -------------
 * Owns a file input (rendered as a styled label/button) and emits an
 * UploadedImage whenever the user picks a file or we programmatically
 * load one (e.g. the default image on boot).
 *
 * The image is always center-cropped to a square. Original resolution
 * is preserved (so the displayed canvas stays crisp). Downstream
 * consumers that need a fixed model size (e.g. 224x224) should resize
 * on their end.
 */

export interface UploadedImage {
  /** square ImageBitmap, ready to draw */
  bitmap: ImageBitmap
  /** side length in pixels (== bitmap.width == bitmap.height) */
  size: number
  /** display name, useful for debugging */
  name: string
}

export interface ImageUploaderOptions {
  onUpload: (img: UploadedImage) => void
}

export class ImageUploader {
  private root: HTMLLabelElement
  private input: HTMLInputElement
  private onUpload: (img: UploadedImage) => void

  constructor(opts: ImageUploaderOptions) {
    this.onUpload = opts.onUpload

    this.root = document.createElement('label')
    this.root.className = 'upload-button'
    this.root.title = 'upload a new image (will be center-cropped to square)'
    this.root.appendChild(document.createTextNode('upload image'))

    this.input = document.createElement('input')
    this.input.type = 'file'
    this.input.accept = 'image/png, image/jpeg, image/webp'
    this.input.addEventListener('change', this.handleChange)
    this.root.appendChild(this.input)
  }

  get element(): HTMLElement {
    return this.root
  }

  /**
   * Programmatically load an image from a URL (e.g. the bundled default
   * image). Will still center-crop in case the asset isn't square.
   */
  async loadFromUrl(url: string, name = 'default'): Promise<void> {
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`)
      const blob = await resp.blob()
      const cropped = await this.cropToSquare(blob)
      this.onUpload({ bitmap: cropped, size: cropped.width, name })
    } catch (err) {
      console.error('[ImageUploader] failed to load default image:', err)
    }
  }

  private handleChange = async (e: Event) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return

    try {
      const cropped = await this.cropToSquare(file)
      this.onUpload({ bitmap: cropped, size: cropped.width, name: file.name })
    } catch (err) {
      console.error('[ImageUploader] failed to load file:', err)
    } finally {
      // reset so the same file can be re-selected
      target.value = ''
    }
  }

  /** Decode the source and return a square ImageBitmap (center-cropped). */
  private async cropToSquare(source: Blob): Promise<ImageBitmap> {
    const full = await createImageBitmap(source)
    const side = Math.min(full.width, full.height)

    if (full.width === full.height) {
      return full
    }

    const sx = Math.floor((full.width - side) / 2)
    const sy = Math.floor((full.height - side) / 2)
    const cropped = await createImageBitmap(full, sx, sy, side, side)
    full.close()
    return cropped
  }
}