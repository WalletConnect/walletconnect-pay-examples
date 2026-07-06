/**
 * Vanilla (non-React) headless checkout entry.
 *
 * Proves a plain-TS host can drive a full WalletConnect Pay flow with NO React, using only:
 *   - `@walletconnect/pay-core`   → the `Transport` seam (→ our `/api/wcp` proxy),
 *   - `@walletconnect/pay-state`  → `createPaymentController` + `browserClock`,
 *   - `@walletconnect/pay-appkit` → `createAppKitWalletList`, the framework-neutral headless
 *                                   wallet-list controller (AppKit runs headless: no modal).
 *
 * AppKit is headless, so the host owns wallet selection: `createAppKitWalletList` fetches the
 * WalletGuide list, runs search + pagination, and exposes the `WalletProvider` seam. The
 * payment controller owns the same binding the React hook uses (wallet→machine reconciliation,
 * named actions, snapshot projection); here we subscribe to both and render imperatively.
 */
import { createHttpTransport } from '@walletconnect/pay-core'
import { createAppKitSigner, createAppKitWalletList } from '@walletconnect/pay-appkit'
import { browserClock, createPaymentController } from '@walletconnect/pay-state'

import { appKit } from './appkit'
import { createCheckout } from './render'

// The payment to drive, read from the URL path: `/<paymentId>` (e.g. `/pay_abc123`),
// matching the React example's `/[paymentId]` route. Falls back to a `?paymentId=`
// query param, then to a placeholder so the layout still renders against a live Engine
// (which reports an invalid payment — expected). Vite's SPA fallback serves index.html
// for arbitrary paths in dev; a static host needs the same SPA rewrite in production.
function resolvePaymentId(): string {
  const fromPath = window.location.pathname.replace(/^\/+/, '').split('/')[0]
  if (fromPath) {
    return decodeURIComponent(fromPath)
  }

  return new URLSearchParams(window.location.search).get('paymentId') ?? 'pay_demo_123'
}

const paymentId = resolvePaymentId()

// The headless wallet-list controller: it fetches the WalletGuide list, runs search +
// pagination, and exposes `walletList.wallet` — the `WalletProvider` seam the machine drives.
// `isMobile` drives deeplink-only mobile filtering; `wcPayUrl` lets a WC wallet return here.
const walletList = createAppKitWalletList(appKit, {
  isMobile: window.matchMedia('(max-width: 768px)').matches,
  wcPayUrl: window.location.href
})
const wallet = walletList.wallet

const controller = createPaymentController({
  paymentId,
  wallet,
  seams: {
    // Engine calls go through our same-origin proxy; the Engine key stays server-side.
    transport: createHttpTransport({ baseUrl: '/api/wcp' }),
    clock: browserClock,
    signer: createAppKitSigner(wallet)
  }
})

const mount = document.getElementById('checkout')
if (!mount) {
  throw new Error('checkout mount missing from index.html')
}

const checkout = createCheckout({
  mount,
  controller,
  walletList,
  paymentId
})

// Pre-generate a generic WalletConnect URI so the QR is on screen the moment the connect
// step opens. Mirrors the React example's eager-URI effect: fire once we're on the connect
// step (`ReadyForWallet`), AppKit has initialized, and no URI exists yet. Before init,
// `getWcUri()` is a no-op that resolves without a URI; this guard re-fires once it's ready.
// The one-shot latch is re-armed whenever we leave the connect step, so returning to it (e.g.
// after a disconnect) regenerates a URI rather than spinning forever on a stale latch.
let wcRequested = false
function maybeFetchWcUri(): void {
  const { isInitialized, wcUri } = walletList.getState()
  const onConnectStep = controller.getSnapshot().state === 'ReadyForWallet'
  if (onConnectStep && isInitialized && !wcUri && !wcRequested) {
    wcRequested = true
    void walletList.getWcUri().catch(error => console.error('[checkout] getWcUri failed', error))
  } else if (!onConnectStep) {
    wcRequested = false
  }
}

// Re-render on every machine transition. `getSnapshot()` is referentially stable
// between transitions, so this only does work when something actually changed.
controller.subscribe(() => {
  maybeFetchWcUri()
  checkout.render(controller.getSnapshot())
})
// Re-render on wallet-list changes too (fetch resolved, search results, new page, connection,
// AppKit init, WC URI generated), since the custom picker + QR read `walletList.getState()`
// rather than the payment snapshot.
walletList.subscribe(() => {
  maybeFetchWcUri()
  checkout.render(controller.getSnapshot())
})

controller.start()
// Fetch the first page of wallets once the controller is running (idempotent).
void walletList.fetchWallets()
maybeFetchWcUri()
checkout.render(controller.getSnapshot())
