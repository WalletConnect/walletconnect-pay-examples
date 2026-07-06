import 'server-only'

import { createEngineClient } from '@walletconnect/pay-core/server'

/**
 * Server-only Engine proxy helper — the "PSP backend proxy" from the design.
 *
 * The gateway API key lives here (server env) and NEVER reaches the browser.
 * The client transport calls our /api/wcp/* routes; these forward to the real
 * WCP Engine with the key attached.
 */
const API_URL = process.env.WCP_API_URL ?? 'https://staging.api.pay.walletconnect.org'
const WALLET_API_KEY = process.env.WCP_WALLET_API_KEY ?? ''

const client = createEngineClient({
  apiUrl: API_URL,
  apiKey: WALLET_API_KEY
})

/** Forward a call to the Engine and return an EngineResponse-shaped Response. */
export async function callEngine(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
): Promise<Response> {
  // Map internal paths to client methods
  let result

  if (path.startsWith('/v1/gateway/payment/') && path.endsWith('/options')) {
    const paymentId = path.split('/')[4]
    result = await client.getPaymentOptions(paymentId!, init.body as any)
  } else if (path.startsWith('/v1/gateway/payment/') && path.endsWith('/status')) {
    const paymentId = path.split('/')[4]
    result = await client.getPaymentStatus(paymentId!)
  } else if (path.startsWith('/v1/gateway/payment/') && path.endsWith('/confirm')) {
    const paymentId = path.split('/')[4]
    result = await client.confirmPayment(paymentId!, init.body as any)
  } else if (path.startsWith('/v1/gateway/payment/') && path.endsWith('/fetch')) {
    const paymentId = path.split('/')[4]
    result = await client.fetchOptionActions(paymentId!, init.body as any)
  } else if (path.startsWith('/v1/gateway/payment/')) {
    const paymentId = path.split('/')[4]
    result = await client.getPayment(paymentId!)
  } else {
    return Response.json({
      status: 'error',
      error: { code: 'INVALID_PATH', message: `Unknown path: ${path}` }
    })
  }

  return Response.json(result)
}
