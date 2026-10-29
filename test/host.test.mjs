import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function mount() {
  let handler
  const ctx = {
    inject(_names, cb) {
      cb({
        effect(fn) {
          fn()
          return () => {}
        },
        webServer: {
          register({ handler: h }) {
            handler = h
            return () => {}
          },
        },
      })
    },
  }
  apply(ctx)
  assert.equal(typeof handler, 'function', 'sound route must register')
  return handler
}

function call(handler, method, headers, remote = '127.0.0.1') {
  const out = { status: 0, body: '' }
  const req = {
    method,
    headers,
    socket: { remoteAddress: remote, localAddress: '127.0.0.1' },
    resume() {},
  }
  const res = {
    setHeader() {},
    end(body) {
      out.body = body ?? ''
    },
    set statusCode(value) {
      out.status = value
    },
    get statusCode() {
      return out.status
    },
  }
  handler(req, res)
  return out
}

test('sound route rejects non-POST', () => {
  const handler = mount()
  assert.equal(call(handler, 'GET', { host: '127.0.0.1:1234' }).status, 405)
})

test('sound route requires the marker header', () => {
  const handler = mount()
  assert.equal(call(handler, 'POST', { host: '127.0.0.1:1234' }).status, 403)
})

test('sound route rejects a cross-origin caller', () => {
  const handler = mount()
  const res = call(handler, 'POST', {
    host: '127.0.0.1:1234',
    origin: 'https://evil.example',
    'x-dsh-ping': 'sound',
  })
  assert.equal(res.status, 403)
})

test('sound route rejects a non-local Host', () => {
  const handler = mount()
  const res = call(handler, 'POST', {
    host: 'evil.example:1234',
    origin: 'https://evil.example',
    'x-dsh-ping': 'sound',
  })
  assert.equal(res.status, 403)
})
