/**
 * ⚠️ DEV EXAMPLE — NOT PRODUCTION-READY.
 * This proxy attaches the secret Engine wallet key to any `/api/wcp/payment/:id/*`
 * request with no origin allowlist, no rate limiting, and no auth — fine for local dev,
 * dangerous if pasted into prod. The path allowlist in `dispatch()` (404 on unknown
 * routes) is the only hardening. Before deploying a real proxy: verify the request
 * Origin / restrict CORS, add rate limiting + body-size caps, and put it behind your
 * existing auth. It exists only to keep the Engine key off the browser.
 *
 * Minimal standalone Engine proxy for the vanilla example.
 *
 * The browser must never see the Engine key, so the `Transport` seam points at this
 * same-origin proxy (`/api/wcp/*`), which forwards to the real Engine with the key
 * attached server-side — exactly the "PSP backend proxy" from the design, but as a
 * tiny dependency-free Node server instead of a Next API route.
 *
 * Routes (mirroring the pay-core Transport's paths under its baseUrl):
 *   GET  /api/wcp/payment/:id            → getPayment
 *   POST /api/wcp/payment/:id/options    → getPaymentOptions
 *   GET  /api/wcp/payment/:id/status     → getPaymentStatus
 *   POST /api/wcp/payment/:id/confirm    → confirmPayment
 *   POST /api/wcp/payment/:id/fetch      → fetchOptionActions
 */
import { createServer } from 'node:http'

import { createEngineClient } from '@walletconnect/pay-core/server'

const PORT = Number(process.env.PORT ?? 8787)
const API_URL = process.env.WCP_API_URL ?? 'https://staging.api.pay.walletconnect.org'
const WALLET_API_KEY = process.env.WCP_WALLET_API_KEY ?? ''

const client = createEngineClient({ apiUrl: API_URL, apiKey: WALLET_API_KEY })

/**
 * Read a request body as JSON (empty body → undefined). Rejects on malformed JSON so
 * the caller can return a 400 — parsing inside the `end` callback must not throw
 * uncaught (it runs in a separate tick from the request handler's try/catch).
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      if (!raw) {
        resolve(undefined)

        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Map an incoming proxy request to the matching Engine client call. */
async function dispatch(method, segments, body) {
  // segments after `/api/wcp`: ['payment', ':id', maybe 'options'|'status'|'confirm'|'fetch']
  const [resource, id, action] = segments
  if (resource !== 'payment' || !id) {
    return null
  }

  if (method === 'GET' && !action) {
    return client.getPayment(id)
  }
  if (method === 'GET' && action === 'status') {
    return client.getPaymentStatus(id)
  }
  if (method === 'POST' && action === 'options') {
    return client.getPaymentOptions(id, body)
  }
  if (method === 'POST' && action === 'confirm') {
    return client.confirmPayment(id, body)
  }
  if (method === 'POST' && action === 'fetch') {
    return client.fetchOptionActions(id, body)
  }

  return null
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    if (!url.pathname.startsWith('/api/wcp/')) {
      res.writeHead(404).end('Not found')

      return
    }

    const segments = url.pathname.replace('/api/wcp/', '').split('/').filter(Boolean)
    const body = req.method === 'POST' ? await readJson(req) : undefined
    const result = await dispatch(req.method ?? 'GET', segments, body)

    if (result === null) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'error', error: { code: 'INVALID_PATH', message: url.pathname } }))

      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    // Log the detail server-side; never return it to the client — a stack trace /
    // error string in the response is an information-exposure risk (CodeQL).
    console.error('[engine-proxy] request failed:', error)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'error', error: { code: 'PROXY_ERROR', message: 'Proxy error' } }))
  }
})

server.listen(PORT, () => {
  if (!WALLET_API_KEY) {
    console.warn('[engine-proxy] WCP_WALLET_API_KEY is unset — Engine calls will be unauthorized.')
  }
  console.log(`[engine-proxy] listening on http://localhost:${PORT} → ${API_URL}`)
})
