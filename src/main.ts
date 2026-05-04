import './style.css'
import { ImageUploader } from './upload/ImageUploader'
import { MorphCanvas } from './canvas/MorphCanvas'
import { RightPanel } from './panel/RightPanel'
import { MouseToPatch } from './input/MouseToPatch'
import { DwellDetector } from './input/DwellDetector'
import { DwellProgressBar } from './canvas/DwellProgressBar'
import { attachMorphTester } from './dev/morphTester'

const app = document.getElementById('app')
if (!app) throw new Error('main: #app root element missing')

// --- left side: canvas + upload button ---

const canvasSection = document.createElement('section')
canvasSection.className = 'canvas-section'

const canvasFrame = document.createElement('div')
canvasFrame.className = 'canvas-frame'

const morphCanvas = new MorphCanvas()
canvasFrame.appendChild(morphCanvas.element)

const panel = new RightPanel()

// --- input pipeline: mouse → patch → dwell ---

const DWELL_MS = 3000

const dwellBar = new DwellProgressBar(DWELL_MS)
canvasFrame.appendChild(dwellBar.element)

const dwellDetector = new DwellDetector({
  dwellMs: DWELL_MS,
  onDwellFired: (patch) => {
    // step 4 will trigger the backend pipeline here
    // eslint-disable-next-line no-console
    console.log(`[dwell] *** FIRED *** on patch (${patch.row}, ${patch.col})`)
  },
  onStatusChange: (status) => {
    // eslint-disable-next-line no-console
    console.log('[gaze]', status.kind, 'patch' in status ? status.patch : '')
    if (status.kind === 'off_canvas') {
      panel.setAttendingPatch(null, false)
    } else {
      panel.setAttendingPatch(status.patch, status.kind === 'dwelling')
    }
    dwellBar.setStatus(status)
  },
})

new MouseToPatch({
  hitTarget: canvasFrame,
  canvas: morphCanvas.element,
  onChange: (event) => dwellDetector.handle(event),
})

// dev-only morph test harness; remove when real pipeline lands
const tester = attachMorphTester(morphCanvas)

const uploader = new ImageUploader({
  onUpload: async (img) => {
    morphCanvas.setImage(img)
    panel.setHeaderThumb(img)
    await tester.onImageLoaded(img)
  },
})
canvasFrame.appendChild(uploader.element)

canvasSection.appendChild(canvasFrame)

// --- right side: info panel ---

app.appendChild(canvasSection)
app.appendChild(panel.element)

// --- boot: load default image ---

uploader.loadFromUrl('/default.jpg')