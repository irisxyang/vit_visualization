import type {
  ClientMessage,
  ManifestResponse,
  RequestMessage,
  ResultMessage,
  ServerMessage,
  Patch,
} from './types'

/**
 * BackendClient
 * -------------
 * Wraps the backend's HTTP /manifest, WS /morph, and image URL fetches
 * behind a single object the rest of the app can drive without
 * caring about the network layer.
 *
 * Responsibilities:
 *   - lifecycle: connect WS lazily, reconnect on drops with backoff
 *   - manifest: fetch the list of available default images
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

  async fetchManifest(): Promise<ManifestResponse> {
    const resp = await fetch('/api/manifest')
    if (!resp.ok) {
      throw new Error(`manifest fetch failed: ${resp.status}`)
    }
    return (await resp.json()) as ManifestResponse
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
    p.catch(() => this.bitmapCache.delete(url))
    return p
  }

  /** Drop all bitmap cache entries. Called on image switch. */
  clearBitmapCache(): void {
    this.bitmapCache.clear()
  }

  // ===== WebSocket =====

  request(requestId: string, imageId: string, patch: Patch): void {
    const msg: RequestMessage = {
      type: 'request',
      request_id: requestId,
      image_id: imageId,
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
      case 'error':
        console.error('[BackendClient] server error:', msg.message, 'req=', msg.request_id)
        break
    }
  }
}