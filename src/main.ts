import './style.css'
import { MorphCanvas } from './canvas/MorphCanvas'
import { RightPanel } from './panel/RightPanel'
import { MouseToPatch } from './input/MouseToPatch'
import { DwellDetector } from './input/DwellDetector'
import { DwellProgressBar } from './canvas/DwellProgressBar'
import { BackendClient } from './api/BackendClient'
import { AppState } from './state/AppState'
import { ImagePicker } from './picker/ImagePicker'
import type { ManifestImageView } from './api/types'

const app = document.getElementById('app')
if (!app) throw new Error('main: #app root element missing')

// --- left side: canvas section (canvas-row + thumbnails below) ---

const canvasSection = document.createElement('section')
canvasSection.className = 'canvas-section'

const canvasRow = document.createElement('div')
canvasRow.className = 'canvas-row'
canvasSection.appendChild(canvasRow)

const canvasFrame = document.createElement('div')
canvasFrame.className = 'canvas-frame'
canvasRow.appendChild(canvasFrame)

const morphCanvas = new MorphCanvas()
canvasFrame.appendChild(morphCanvas.element)

const panel = new RightPanel()

const DWELL_MS = 3000
const dwellBar = new DwellProgressBar(DWELL_MS)
canvasFrame.appendChild(dwellBar.element)

// --- backend ---

const backend = new BackendClient({
  onResult: (msg) => state.onResult(msg),
  onConnectionChange: (connected) => {
    console.log('[ws]', connected ? 'connected' : 'disconnected')
  },
})

// --- input pipeline ---

const dwellDetector = new DwellDetector({
  dwellMs: DWELL_MS,
  onDwellFired: (patch) => state.onDwellFired(patch),
  onStatusChange: (status) => {
    state.setGazeStatus(status)
    dwellBar.setStatus(status)
  },
})

const state = new AppState(morphCanvas, panel, backend, dwellDetector)

new MouseToPatch({
  hitTarget: canvasFrame,
  canvas: morphCanvas.element,
  onChange: (event) => dwellDetector.handle(event),
})

// --- image picker ---

// quick lookup: image_id -> manifest entry
let manifestById: Map<string, ManifestImageView> = new Map()

const picker = new ImagePicker({
  onSelect: (imageId) => {
    const entry = manifestById.get(imageId)
    if (!entry) {
      console.error('[main] selected image not in manifest:', imageId)
      return
    }
    state.selectImage(entry)
  },
})

// arrows go inside canvas-row (absolutely positioned, flanking canvas)
canvasRow.appendChild(picker.leftButton)
canvasRow.appendChild(picker.rightButton)
// thumbnails go below canvas-row, inside canvas-section
canvasSection.appendChild(picker.thumbnails)

// --- assemble ---

app.appendChild(canvasSection)
app.appendChild(panel.element)

// --- boot: fetch manifest, hand to picker ---

;(async () => {
  try {
    const manifest = await backend.fetchManifest()
    manifestById = new Map(manifest.images.map((img) => [img.image_id, img]))
    picker.setImages(manifest.images)
  } catch (err) {
    console.error('[main] manifest fetch failed:', err)
  }
})()