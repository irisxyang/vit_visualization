import type { MorphCanvas } from '../canvas/MorphCanvas'
import type { UploadedImage } from '../upload/ImageUploader'

/**
 * Dev-only test harness for MorphCanvas.
 *
 * On first image load, generates three filtered variants and binds
 * keyboard shortcuts:
 *
 *   1 → original
 *   2 → variant A (hue-rotated)
 *   3 → variant B (inverted)
 *   4 → variant C (sepia)
 *
 * Hammering 1–4 in succession verifies that mid-morph target swaps
 * redirect smoothly without resetting to the prior frame's state.
 *
 * Remove the import in `main.ts` once the real backend pipeline lands.
 */

interface MorphTesterHandle {
  onImageLoaded: (img: UploadedImage) => Promise<void>
}

const FILTERS: Array<{ key: string; filter: string }> = [
  { key: '2', filter: 'hue-rotate(120deg) saturate(1.6)' },
  { key: '3', filter: 'invert(1)' },
  { key: '4', filter: 'sepia(1) contrast(1.4) saturate(1.4)' },
]

export function attachMorphTester(canvas: MorphCanvas): MorphTesterHandle {
  let original: UploadedImage | null = null
  let variants: UploadedImage[] = []

  document.addEventListener('keydown', (e) => {
    if (!original) return
    // ignore typing in inputs / textareas
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return

    if (e.key === '1') {
      canvas.setTarget(original)
      return
    }
    const idx = FILTERS.findIndex((f) => f.key === e.key)
    if (idx !== -1 && variants[idx]) {
      canvas.setTarget(variants[idx])
    }
  })

  return {
    async onImageLoaded(img: UploadedImage) {
      original = img
      // close previous variant bitmaps to avoid leaks on re-upload
      for (const v of variants) v.bitmap.close()
      variants = await Promise.all(
        FILTERS.map((f, i) => applyFilter(img, f.filter, `variant-${i}`)),
      )
      // eslint-disable-next-line no-console
      console.log('[morphTester] ready. press 1 (original), 2-4 (variants).')
    },
  }
}

async function applyFilter(
  img: UploadedImage,
  filter: string,
  name: string,
): Promise<UploadedImage> {
  const c = document.createElement('canvas')
  c.width = img.bitmap.width
  c.height = img.bitmap.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('morphTester: 2d context unavailable')
  ctx.filter = filter
  ctx.drawImage(img.bitmap, 0, 0)
  const bitmap = await createImageBitmap(c)
  return { bitmap, size: bitmap.width, name }
}