/**
 * dsh-ping-macos — host half.
 *
 * The browser half raises notifications. The only thing it cannot do is play
 * macOS's own alert sound: the renderer has no filesystem access, and the Web
 * Audio route is both synthesized and subject to autoplay policy. This module
 * therefore owns one loopback route:
 *
 *   POST /__dsh-ping-macos/sound   (x-dsh-ping-macos: sound)
 *
 * It spawns `afplay` on the system's Glass alert. The route is gated to the
 * local host / bound address, requires the marker header, and accepts only
 * POST, so a random page cannot make the machine beep.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export const name = 'dsh-ping-macos'

export const SOUND_ROUTE = '/__dsh-ping-macos/sound'
const SOUND_HEADER = 'x-dsh-ping-macos'
const SOUND_HEADER_VALUE = 'sound'
const CANDIDATES = ['/System/Library/Sounds/Glass.aiff', '/System/Library/Sounds/Ping.aiff']

function respond(res, status, body) {
  try {
    if (status === 204 || body === undefined) {
      res.statusCode = status
      res.end()
      return
    }
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  } catch {
    // The client may have gone away; nothing to report.
  }
}

function hostnameOf(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '') return ''
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    return end > 0 ? raw.slice(0, end + 1) : raw
  }
  return raw.split(':')[0]
}

function allowed(req) {
  const hostHeader = req.headers?.host
  const host = hostnameOf(hostHeader)
  const local = String(req.socket?.localAddress ?? '').toLowerCase()
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  if (!loopback && host !== local) return false
  const origin = req.headers?.origin
  // The desktop page sends `Origin: dsh-app://app` (a custom scheme, so it is
  // not comparable to the loopback Host). `null` is the opaque form some
  // Chromium versions use for the same page. Both are fine once the Host is
  // local and the marker header is present.
  if (origin !== undefined && origin !== 'dsh-app://app' && origin !== 'null') {
    try {
      if (new URL(String(origin)).host.toLowerCase() !== String(hostHeader).toLowerCase()) return false
    } catch {
      return false
    }
  }
  return req.headers?.[SOUND_HEADER] === SOUND_HEADER_VALUE
}

function play() {
  if (process.platform !== 'darwin') return false
  const file = CANDIDATES.find((candidate) => existsSync(candidate))
  if (file === undefined) return false
  try {
    const child = spawn('afplay', [file], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: SOUND_ROUTE,
          handler: (req, res) => {
            const method = req.method ?? 'GET'
            if (method !== 'POST') {
              respond(res, 405, { ok: false, reason: 'method-not-allowed' })
              return
            }
            if (!allowed(req)) {
              respond(res, 403, { ok: false, reason: 'forbidden' })
              return
            }
            req.resume()
            if (!play()) {
              respond(res, 501, { ok: false, reason: 'unsupported-host', platform: process.platform })
              return
            }
            respond(res, 204)
          },
        }),
      'dsh-ping-macos: sound route',
    )
  })
}
