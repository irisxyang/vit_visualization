import './style.css'
import { ImageUploader } from './upload/ImageUploader'
import { MorphCanvas } from './canvas/MorphCanvas'
import { RightPanel } from './panel/RightPanel'
import { MouseToPatch } from './input/MouseToPatch'
import { DwellDetector } from './input/DwellDetector'
import { DwellProgressBar } from './canvas/DwellProgressBar'
import { BackendClient } from './api/BackendClient'
import { AppState } from './state/AppState'

const app = document.getElementById('app')
if (!app) throw new Error('main: #app root element missing')

// --- left side: canvas + upload + dwell bar ---

const canvasSection = document.createElement('section')
canvasSection.className = 'canvas-section'

const canvasFrame = document.createElement('div')
canvasFrame.className = 'canvas-frame'

const morphCanvas = new MorphCanvas()
canvasFrame.appendChild(morphCanvas.element)

const panel = new RightPanel()

const DWELL_MS = 3000
const dwellBar = new DwellProgressBar(DWELL_MS)
canvasFrame.appendChild(dwellBar.element)

// --- backend + state ---

const backend = new BackendClient({
  onResult: (msg) => state.onResult(msg),
  onProgress: (done, total, hash) => {
    console.log(`[precompute] ${done}/${total} for ${hash}`)
  },
  onConnectionChange: (connected) => {
    console.log('[ws]', connected ? 'connected' : 'disconnected')
  },
})

const state = new AppState(morphCanvas, panel, backend)

// --- input pipeline ---

const dwellDetector = new DwellDetector({
  dwellMs: DWELL_MS,
  onDwellFired: (patch) => state.onDwellFired(patch),
  onStatusChange: (status) => {
    state.setGazeStatus(status)
    dwellBar.setStatus(status)
  },
})

new MouseToPatch({
  hitTarget: canvasFrame,
  canvas: morphCanvas.element,
  onChange: (event) => dwellDetector.handle(event),
})

// --- uploader ---

const uploader = new ImageUploader({
  onUpload: (img) => {
    state.loadImage(img)
  },
})
canvasFrame.appendChild(uploader.element)

canvasSection.appendChild(canvasFrame)

// --- assemble ---

app.appendChild(canvasSection)
app.appendChild(panel.element)

// --- boot ---

uploader.loadFromUrl('/default.png')