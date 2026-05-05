/**
 * MorphCanvas
 * -----------
 * WebGL2 canvas that smoothly morphs between images.
 *
 * Architecture: ping-pong between two textures (texA, texB) holding
 * the displayed state, with a third texture (targetTex) holding the
 * desired state. Each frame:
 *
 *   1. lerp pass: render mix(currentSlot, target, k) into the OTHER
 *      slot via FBO, where k = 1 - exp(-dt/τ).
 *   2. swap which slot is "current".
 *   3. display pass: render the current slot to the screen.
 *
 * Mid-morph target swaps cost nothing — `setTarget` just rewrites
 * `targetTex` and the next frame chases from wherever it currently is.
 * No reset, no animation state to coordinate.
 *
 * Internal textures are pinned at TEX_SIZE × TEX_SIZE (FBO requires
 * matching sizes). Source images are scaled to TEX_SIZE via a staging
 * 2D canvas before upload.
 */

/** Internal texture/FBO resolution. Independent of display size. */
const TEX_SIZE = 512

/** Time constant for exponential approach. ~3τ = visually settled. */
const TIME_CONSTANT_S = 0.35

const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`

const LERP_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_current;
uniform sampler2D u_target;
uniform float u_k;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 a = texture(u_current, v_uv);
  vec4 b = texture(u_target, v_uv);
  fragColor = mix(a, b, u_k);
}`

const DISPLAY_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv);
}`

export class MorphCanvas {
  private canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext

  // staging canvas: source images get rasterized here at TEX_SIZE
  // before upload, so all GPU textures share the same dimensions.
  private stagingCanvas: HTMLCanvasElement
  private stagingCtx: CanvasRenderingContext2D

  // ping-pong: displayed state alternates between texA and texB.
  // currentSlot indicates which one holds "the truth" right now.
  private texA: WebGLTexture
  private texB: WebGLTexture
  private fboA: WebGLFramebuffer
  private fboB: WebGLFramebuffer
  private currentSlot: 0 | 1 = 0

  // the target the displayed state is chasing.
  private targetTex: WebGLTexture

  // shaders
  private lerpProgram: WebGLProgram
  private lerpUniforms: {
    current: WebGLUniformLocation
    target: WebGLUniformLocation
    k: WebGLUniformLocation
  }
  private lerpAttribPos: number

  private displayProgram: WebGLProgram
  private displayUniforms: { tex: WebGLUniformLocation }
  private displayAttribPos: number

  // fullscreen quad geometry (two triangles)
  private quadBuffer: WebGLBuffer

  // animation state
  private rafId: number = 0
  private lastTime: number = 0

  // most recently uploaded source bitmap; surfaced via getCurrentBitmap()
  // for downstream consumers (e.g. the right panel's header thumb).
  private currentBitmap: ImageBitmap | null = null

  private resizeObserver: ResizeObserver

  constructor() {
    this.canvas = document.createElement('canvas')

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) {
      throw new Error('MorphCanvas: WebGL2 is not supported in this browser')
    }
    this.gl = gl

    // staging canvas for image standardization
    this.stagingCanvas = document.createElement('canvas')
    this.stagingCanvas.width = TEX_SIZE
    this.stagingCanvas.height = TEX_SIZE
    const sctx = this.stagingCanvas.getContext('2d', { willReadFrequently: false })
    if (!sctx) throw new Error('MorphCanvas: staging 2d context unavailable')
    this.stagingCtx = sctx
    this.stagingCtx.imageSmoothingEnabled = true
    this.stagingCtx.imageSmoothingQuality = 'high'

    // shader programs
    this.lerpProgram = buildProgram(gl, VERT_SRC, LERP_FRAG_SRC)
    this.lerpUniforms = {
      current: getUniform(gl, this.lerpProgram, 'u_current'),
      target: getUniform(gl, this.lerpProgram, 'u_target'),
      k: getUniform(gl, this.lerpProgram, 'u_k'),
    }
    this.lerpAttribPos = gl.getAttribLocation(this.lerpProgram, 'a_position')

    this.displayProgram = buildProgram(gl, VERT_SRC, DISPLAY_FRAG_SRC)
    this.displayUniforms = {
      tex: getUniform(gl, this.displayProgram, 'u_tex'),
    }
    this.displayAttribPos = gl.getAttribLocation(this.displayProgram, 'a_position')

    // fullscreen quad
    this.quadBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    // textures
    this.targetTex = createBlankTexture(gl, TEX_SIZE)
    this.texA = createBlankTexture(gl, TEX_SIZE)
    this.texB = createBlankTexture(gl, TEX_SIZE)

    // FBOs for ping-pong
    this.fboA = createFBO(gl, this.texA)
    this.fboB = createFBO(gl, this.texB)

    // clear ping-pong textures to black so first frames don't sample
    // undefined data
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA)
    gl.viewport(0, 0, TEX_SIZE, TEX_SIZE)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // size canvas to its CSS box (and re-size on layout changes)
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas())
    this.resizeObserver.observe(this.canvas)

    this.rafId = requestAnimationFrame(this.frame)
  }

  get element(): HTMLCanvasElement {
    return this.canvas
  }

  /**
   * Snap to a new image. Both ping-pong slots and the target are
   * overwritten — no morph. Use this on upload / fresh image load.
   */
  setImage(bitmap: ImageBitmap): void {
    this.currentBitmap = bitmap
    this.uploadStandardized(this.targetTex, bitmap)
    this.uploadStandardized(this.texA, bitmap)
    this.uploadStandardized(this.texB, bitmap)
  }

  /**
   * Set the target the morph is chasing. The current displayed state
   * keeps moving toward it smoothly. Calling this mid-morph redirects.
   */
  setTarget(bitmap: ImageBitmap): void {
    this.uploadStandardized(this.targetTex, bitmap)
  }

  /** Most recent source bitmap (i.e. last `setImage` arg). */
  getCurrentBitmap(): ImageBitmap | null {
    return this.currentBitmap
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    const gl = this.gl
    gl.deleteTexture(this.texA)
    gl.deleteTexture(this.texB)
    gl.deleteTexture(this.targetTex)
    gl.deleteFramebuffer(this.fboA)
    gl.deleteFramebuffer(this.fboB)
    gl.deleteBuffer(this.quadBuffer)
    gl.deleteProgram(this.lerpProgram)
    gl.deleteProgram(this.displayProgram)
  }

  // ===========================================================
  // internals
  // ===========================================================

  /**
   * Rasterize the source bitmap onto the staging canvas at TEX_SIZE,
   * then upload it to the given GPU texture.
   */
  private uploadStandardized(tex: WebGLTexture, bitmap: ImageBitmap): void {
    this.stagingCtx.clearRect(0, 0, TEX_SIZE, TEX_SIZE)
    this.stagingCtx.drawImage(bitmap, 0, 0, TEX_SIZE, TEX_SIZE)

    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.stagingCanvas,
    )
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  /** Sync the canvas pixel buffer to its CSS box (handles HiDPI). */
  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  /** rAF callback: lerp pass → swap → display pass. Always running. */
  private frame = (now: number) => {
    this.rafId = requestAnimationFrame(this.frame)

    if (!this.lastTime) this.lastTime = now
    // clamp dt so a backgrounded tab doesn't snap us forward weirdly
    const dt = Math.min(0.1, (now - this.lastTime) / 1000)
    this.lastTime = now

    const gl = this.gl

    // ---- pass 1: render mix(current, target, k) into the off slot ----
    const k = 1 - Math.exp(-dt / TIME_CONSTANT_S)
    const srcTex = this.currentSlot === 0 ? this.texA : this.texB
    const dstFbo = this.currentSlot === 0 ? this.fboB : this.fboA

    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo)
    gl.viewport(0, 0, TEX_SIZE, TEX_SIZE)
    gl.useProgram(this.lerpProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(this.lerpUniforms.current, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.targetTex)
    gl.uniform1i(this.lerpUniforms.target, 1)

    gl.uniform1f(this.lerpUniforms.k, k)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.lerpAttribPos)
    gl.vertexAttribPointer(this.lerpAttribPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // off slot now holds the new "current"; swap.
    this.currentSlot = (1 - this.currentSlot) as 0 | 1

    // ---- pass 2: render current slot to the canvas ----
    const showTex = this.currentSlot === 0 ? this.texA : this.texB

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.displayProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, showTex)
    gl.uniform1i(this.displayUniforms.tex, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(this.displayAttribPos)
    gl.vertexAttribPointer(this.displayAttribPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
}

// =============================================================
// GL helpers (kept module-private — extract if reused elsewhere)
// =============================================================

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('MorphCanvas: createShader returned null')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`MorphCanvas: shader compile error: ${info}`)
  }
  return sh
}

function buildProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  if (!prog) throw new Error('MorphCanvas: createProgram returned null')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`MorphCanvas: program link error: ${info}`)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return prog
}

function getUniform(gl: WebGL2RenderingContext, prog: WebGLProgram, name: string): WebGLUniformLocation {
  const loc = gl.getUniformLocation(prog, name)
  if (!loc) throw new Error(`MorphCanvas: missing uniform ${name}`)
  return loc
}

function createBlankTexture(gl: WebGL2RenderingContext, size: number): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('MorphCanvas: createTexture returned null')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function createFBO(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer()
  if (!fbo) throw new Error('MorphCanvas: createFramebuffer returned null')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('MorphCanvas: FBO incomplete')
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return fbo
}