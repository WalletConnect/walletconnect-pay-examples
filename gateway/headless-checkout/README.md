# headless-checkout (Next.js)

A complete buyer-side checkout built on the **WalletConnect Pay headless SDK**. The
entire screen is the consumer's own UI (Next.js App Router + shadcn/ui) — the SDK only
drives the payment state machine underneath. This is the **React** counterpart to
[`../headless-checkout-vanilla`](../headless-checkout-vanilla).

This is a standalone app: it pulls the `@walletconnect/pay-*` packages from npm (`^0.2.0`),
so there is nothing to build in a monorepo first.

## What it shows

- **One render per machine state** (`components/checkout.tsx`) — the `snapshot.state` from
  the SDK maps to the connect → choose option → confirm → approve & pay → done flow. The UI
  never decides flow; it just renders what the machine reports.
- **The React binding is a single hook** — `usePaymentSession` (from
  `@walletconnect/pay-react`) owns the session lifecycle and returns the snapshot + named
  domain actions. No XState, no raw `send`.
- **Wallet via the AppKit seam** — `@walletconnect/pay-appkit` (+ its `/react` hook) supplies
  the `WalletProvider`, and `createAppKitSigner` supplies the `Signer`. AppKit itself is
  created in `components/providers.tsx`.
- **Engine key stays server-side** — the browser talks to same-origin API routes under
  `app/api/wcp/*`, which use `@walletconnect/pay-core/server` (`createEngineClient`) to attach
  the secret key and forward to the Engine. The key never reaches the browser.

## SDK packages it consumes

| Package                            | Role                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| `@walletconnect/pay-core[/server]` | Engine client + `Transport` seam (`/server` for the proxy route) |
| `@walletconnect/pay-state`         | headless payment machine + snapshot projection                   |
| `@walletconnect/pay-react`         | `usePaymentSession` React binding                                |
| `@walletconnect/pay-appkit[/react]`| Reown AppKit `WalletProvider` seam + `createAppKitSigner`        |

## Setup

Create `.env.local` in this directory:

```bash
# Reown AppKit project ID — client-side (get one at https://dashboard.reown.com)
NEXT_PUBLIC_APPKIT_PROJECT_ID=

# Engine base URL — server-side (defaults to staging when unset)
WCP_API_URL=https://staging.api.pay.walletconnect.org

# Engine wallet API key — server-side, SECRET (never exposed to the browser)
WCP_WALLET_API_KEY=
```

## Run

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # production build
```

## Running against a real payment

Open `http://localhost:3000/<paymentId>` (e.g. `http://localhost:3000/pay_abc123`) with a
payment created on the configured Engine. The `/[paymentId]` route loads that payment and
drives the flow.

> ⚠️ The API routes under `app/api/wcp/*` are a **dev example proxy**, not production-ready —
> no origin allowlist, rate limiting, or auth. They exist only to keep the Engine key off the
> browser. Before shipping a real proxy, add origin/CORS checks, rate limiting + body-size
> caps, and your own auth.

## shadcn/ui

Components in `components/ui/` follow shadcn (vendored source — the copy-own model), with
Tailwind v4 tokens in `app/globals.css`.
