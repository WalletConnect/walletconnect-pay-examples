# @walletconnect/pay-example-headless-checkout-vanilla

A complete checkout built on the headless **WalletConnect Pay SDK** with **no React**
and **headful AppKit** (the standard modal — no enterprise headless feature). It's the
vanilla-JS counterpart to [`../headless-checkout`](../headless-checkout) (Next.js), and
proves a plain-TS host can drive the full payment flow.

## What it shows

- **Framework-agnostic binding** — `createPaymentController` (from `@walletconnect/pay-state`)
  owns the session lifecycle, the wallet→machine reconciliation, the named actions, and
  the snapshot projection. The app just `subscribe()`s and renders to the DOM. No React,
  no XState, no raw `send`.
- **Headful AppKit** — `createAppKit(...)` runs with its **standard modal** (no
  `features.headless`). The `<appkit-button>` opens the wallet picker; the connection is
  surfaced to the machine by the controller's reconciliation. `createAppKitWalletProvider(appKit, { headless: false })`
  also makes a programmatic `connect()` open the modal.
- **One render per machine state** (`src/render.ts`) — `snapshot.state` maps to the
  connect → choose option → capture details → approve → done flow.

## SDK packages it consumes

| Package                     | Role                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| `@walletconnect/pay-core`   | Engine client + `Transport` seam (`/server` for the proxy)        |
| `@walletconnect/pay-state`  | headless machine, `createPaymentController`, signing strategies   |
| `@walletconnect/pay-appkit` | Reown AppKit `WalletProvider` seam (main entry — **no `/react`**) |

> Note: this example imports **only** the framework-neutral entry points — never
> `@walletconnect/pay-react` or `@walletconnect/pay-appkit/react`.

## Architecture

```
browser (Vite, no React)                         standalone Node server
┌───────────────────────────────┐                ┌─────────────────────────┐
│ <appkit-button> (headful)      │                │ server/index.mjs        │
│ createPaymentController(...)   │  /api/wcp/* ──▶ │ createEngineClient(key) │ ──▶ Engine
│   ├─ transport → /api/wcp      │   (vite proxy) │ (Engine key, server-side)│
│   ├─ wallet → AppKit seam      │                └─────────────────────────┘
│   ├─ signer → signing strategies
│   └─ clock  → browserClock     │
│ subscribe() → render(DOM)      │
└───────────────────────────────┘
```

The Engine key never reaches the browser: the `Transport` seam points at the same-origin
`/api/wcp` proxy, which Vite forwards to the standalone server, which attaches the key.

> ⚠️ **The proxy (`server/index.mjs`) is a dev example, not production-ready** — no origin
> allowlist, rate limiting, or auth. Before shipping a real proxy: verify the request
> Origin / restrict CORS, add rate limiting + body-size caps, and put it behind your
> existing auth. It exists only to keep the Engine key off the browser.

## Setup

1. Copy the env template and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   | Variable                  | Side   | Purpose                                                          |
   | ------------------------- | ------ | ---------------------------------------------------------------- |
   | `VITE_APPKIT_PROJECT_ID`  | client | Reown AppKit project ID ([dashboard.reown.com](https://dashboard.reown.com)) |
   | `WCP_API_URL`             | server | Engine base URL (defaults to staging when unset)                 |
   | `WCP_WALLET_API_KEY`      | server | Engine wallet API key — **secret**, server-side only             |

2. Build the SDK packages (the example consumes their built `dist/`):

   ```bash
   pnpm build:packages   # from the repo root
   ```

3. Run it (starts the Engine proxy + the Vite client together):

   ```bash
   pnpm --filter @walletconnect/pay-example-headless-checkout-vanilla dev
   # client → http://localhost:3012 , proxy → http://localhost:8787
   ```

## Running against a real payment

Open `http://localhost:3012/<paymentId>` (e.g. `http://localhost:3012/pay_abc123`) with a
payment created on the configured Engine — matching the React example's `/[paymentId]`
route. A `?paymentId=` query param also works. With neither, a placeholder is used for
layout preview, which a live Engine reports as an invalid payment (expected).

> Path-based routing relies on an SPA fallback (serve `index.html` for unmatched paths).
> Vite's dev server and `vite preview` do this by default; a static production host needs
> the same rewrite.

## Files

| File              | Role                                                            |
| ----------------- | --------------------------------------------------------------- |
| `src/main.ts`     | Wire the seams + controller; subscribe → render                 |
| `src/appkit.ts`   | Headful `createAppKit` (standard modal)                         |
| `src/signer.ts`   | `Signer` seam from the AppKit wallet (EVM + Solana strategies)  |
| `src/render.ts`   | Imperative DOM rendering per `snapshot.state`                   |
| `server/index.mjs`| Minimal standalone Engine proxy (key stays server-side)         |
| `scripts/dev.mjs` | Runs the proxy + Vite together (zero extra deps)                |
