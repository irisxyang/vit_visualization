/**
 * SettingsControls
 * ----------------
 * Two range sliders in a collapsible section: dwell time and morph
 * time constant. Live-updates via the `input` event so values flow
 * to the rest of the app on every drag, not just release.
 *
 * Resets to defaults on page reload (no persistence).
 */

export interface SettingsValues {
  dwellMs: number
  morphTimeConstantS: number
}

export interface SettingsControlsOptions {
  defaults: SettingsValues
  onChange: (values: SettingsValues) => void
}

export class SettingsControls {
  private root: HTMLElement
  private values: SettingsValues
  private onChange: (values: SettingsValues) => void

  private dwellInput!: HTMLInputElement
  private dwellValue!: HTMLElement
  private tauInput!: HTMLInputElement
  private tauValue!: HTMLElement

  constructor(opts: SettingsControlsOptions) {
    this.values = { ...opts.defaults }
    this.onChange = opts.onChange

    this.root = document.createElement('div')
    this.root.className = 'section settings'
    this.root.innerHTML = `
      <div class="section-label">settings:</div>

      <div class="setting-row">
        <div class="setting-label">
          <span>dwell time</span>
          <span class="setting-value" data-slot="dwell-value"></span>
        </div>
        <input
          type="range"
          class="setting-slider"
          data-slot="dwell-input"
          min="500" max="6000" step="50"
        />
      </div>

      <div class="setting-row">
        <div class="setting-label">
          <span>morph time constant</span>
          <span class="setting-value" data-slot="tau-value"></span>
        </div>
        <input
          type="range"
          class="setting-slider"
          data-slot="tau-input"
          min="0.05" max="2.0" step="0.05"
        />
      </div>
    `

    this.dwellInput = this.q('[data-slot="dwell-input"]') as HTMLInputElement
    this.dwellValue = this.q('[data-slot="dwell-value"]')
    this.tauInput = this.q('[data-slot="tau-input"]') as HTMLInputElement
    this.tauValue = this.q('[data-slot="tau-value"]')

    // initial values
    this.dwellInput.value = String(this.values.dwellMs)
    this.tauInput.value = String(this.values.morphTimeConstantS)
    this.refreshLabels()

    // live updates
    this.dwellInput.addEventListener('input', () => {
      this.values.dwellMs = Number(this.dwellInput.value)
      this.refreshLabels()
      this.onChange({ ...this.values })
    })
    this.tauInput.addEventListener('input', () => {
      this.values.morphTimeConstantS = Number(this.tauInput.value)
      this.refreshLabels()
      this.onChange({ ...this.values })
    })
  }

  get element(): HTMLElement {
    return this.root
  }

  private refreshLabels(): void {
    this.dwellValue.textContent = `${(this.values.dwellMs / 1000).toFixed(2)}s`
    this.tauValue.textContent = `${this.values.morphTimeConstantS.toFixed(2)}s`
  }

  private q(selector: string): HTMLElement {
    const el = this.root.querySelector(selector)
    if (!el) throw new Error(`SettingsControls: missing ${selector}`)
    return el as HTMLElement
  }
}