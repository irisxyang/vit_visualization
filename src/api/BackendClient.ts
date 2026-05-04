import type {
  ClientMessage,
  RequestMessage,
  ResultMessage,
  ServerMessage,
  UploadResponse,
  Patch,
} from './types'

/**
 * BackendClient
 * -------------
 * Wraps the backend's HTTP /upload, WS /morph, and image URL fetches
 * behind a single object the rest of the app can drive without
 * caring about the network layer.
 *
 * Responsibilities:
 *   - lifecycle: connect WS lazily, reconnect on drops with backoff
 *   - upload: POST file, return UploadResponse
 *   - request: send a RequestMessage; receive results via callback
 *   - cancel: send a CancelMessage (best-effort, fire-and-forget)
 *   - image cache: fetch+decode merged_image_url -> ImageBitmap, memoized
 *
 * Stale request handling (i.e. dropping results for outdated requests)
 * is NOT done here — that's AppState's job. This client just emits
 * everything the server says verbatim.
 */

export interface BackendClientOptions {
  onResult: (msg: ResultMessage) => void
  onProgress: (done: number, total: number, imageHash: string) => void
  onConnectionChange?: (connected: boolean) => void
}

export class BackendClient {
  private opts: BackendClientOptions
  private ws: WebSocket | null = null
  private reconnectDelay = 500
  private destroyed = false
  private bitmapCache: Map<string, Promise<ImageBitmap>> = new Map()

  constructor(opts: BackendClientOptions) {
    this.opts = opts
    this.connect()
  }

  // ===== HTTP =====

  async upload(blob: Blob, filename: string): Promise<UploadResponse> {
    const fd = new FormData()
    fd.append('file', blob, filename)
    const resp = await fetch('/api/upload', { method: 'POST', body: fd })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`upload failed: ${resp.status} ${text}`)
    }
    return (await resp.json()) as UploadResponse
  }

  /**
   * Fetch + decode an image URL into an ImageBitmap. Memoized — the
   * same URL is decoded at most once per session.
   */
  fetchBitmap(url: string): Promise<ImageBitmap> {
    const cached = this.bitmapCache.get(url)
    if (cached) return cached
    const p = (async () => {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`fetchBitmap ${url}: ${resp.status}`)
      const blob = await resp.blob()
      return await createImageBitmap(blob)
    })()
    this.bitmapCache.set(url, p)
    // if it fails, drop from cache so a retry can re-fetch
    p.catch(() => this.bitmapCache.delete(url))
    return p
  }

  /** Drop all bitmap cache entries. Called on image switch. */
  clearBitmapCache(): void {
    this.bitmapCache.clear()
  }

  // ===== WebSocket =====

  request(requestId: string, imageHash: string, patch: Patch): void {
    const msg: RequestMessage = {
      type: 'request',
      request_id: requestId,
      image_hash: imageHash,
      patch,
    }
    this.send(msg)
  }

  cancel(requestId: string): void {
    this.send({ type: 'cancel', request_id: requestId })
  }

  destroy(): void {
    this.destroyed = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  // ===== internals =====

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      // dropped on the floor — caller is responsible for noticing if
      // they care. results loop will re-fire on reconnect via app state.
      console.warn('[BackendClient] dropping message (ws not open):', msg.type)
    }
  }

  private connect(): void {
    if (this.destroyed) return
    const wsUrl =
      (location.protocol === 'https:' ? 'wss://' : 'ws://') +
      location.host +
      '/ws/morph'
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.reconnectDelay = 500
      this.opts.onConnectionChange?.(true)
    }

    this.ws.onclose = () => {
      this.opts.onConnectionChange?.(false)
      if (this.destroyed) return
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2)
    }

    this.ws.onerror = () => {
      // onclose will fire next; backoff handled there
    }

    this.ws.onmessage = (e) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(e.data) as ServerMessage
      } catch {
        console.error('[BackendClient] non-JSON message:', e.data)
        return
      }
      this.handleMessage(msg)
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'result':
        this.opts.onResult(msg)
        break
      case 'precompute_progress':
        this.opts.onProgress(msg.done, msg.total, msg.image_hash)
        break
      case 'error':
        console.error('[BackendClient] server error:', msg.message, 'req=', msg.request_id)
        break
    }
  }
}