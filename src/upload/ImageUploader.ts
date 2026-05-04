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
 *
 * The backend also center-crops on its end (defensive duplication) so
 * the hash is stable regardless of which side did the cropping.
 */

export interface UploadedImage {
  /** square ImageBitmap, ready to draw */
  bitmap: ImageBitmap
  /** square Blob (PNG), ready to upload */
  blob: Blob
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
      const result = await this.cropToSquare(blob, name)
      this.onUpload(result)
    } catch (err) {
      console.error('[ImageUploader] failed to load default image:', err)
    }
  }

  private handleChange = async (e: Event) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return

    try {
      const result = await this.cropToSquare(file, file.name)
      this.onUpload(result)
    } catch (err) {
      console.error('[ImageUploader] failed to load file:', err)
    } finally {
      target.value = ''
    }
  }

  /**
   * Decode the source, center-crop to square, return both an
   * ImageBitmap (for display) and a PNG Blob (for upload to backend).
   */
  private async cropToSquare(source: Blob, name: string): Promise<UploadedImage> {
    const full = await createImageBitmap(source)
    const side = Math.min(full.width, full.height)

    // for a square source, skip the canvas roundtrip — but we still
    // need a blob, so re-encode if the source isn't already a PNG/JPEG
    // we can pass through. simpler to always re-encode.
    const canvas =
      'OffscreenCanvas' in window
        ? new OffscreenCanvas(side, side)
        : (() => {
            const c = document.createElement('canvas')
            c.width = side
            c.height = side
            return c
          })()
    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null
    if (!ctx) throw new Error('ImageUploader: 2d context unavailable')

    const sx = Math.floor((full.width - side) / 2)
    const sy = Math.floor((full.height - side) / 2)
    ctx.drawImage(full, sx, sy, side, side, 0, 0, side, side)
    full.close()

    const blob = await canvasToPngBlob(canvas)
    const bitmap = await createImageBitmap(blob)

    return { bitmap, blob, size: side, name }
  }
}

async function canvasToPngBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return await canvas.convertToBlob({ type: 'image/png' })
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('toBlob returned null'))
    }, 'image/png')
  })
}