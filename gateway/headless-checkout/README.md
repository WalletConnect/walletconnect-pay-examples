# headless-checkout-example

A PSP-owned checkout UI built entirely on `@walletconnect/pay-core`. Demonstrates
the **headless** story: the whole screen is the consumer's (Next.js + shadcn/ui),
and pay-core only drives the payment state machine underneath.

This is **Layer B** — "import the package + dress UI per state" — as a real app.

## Run

```bash
# pay-core must be built first (the example consumes its dist/):
pnpm --filter @walletconnect/pay-core build

pnpm --filter headless-checkout-example dev     # http://localhost:3000
pnpm --filter headless-checkout-example build   # production build
```

## What it shows

- **One render per machine step** (`components/checkout.tsx`) — `STEP_META` maps
  each `step` to a title/description; the action area swaps per step
  (connect → choose option → confirm → approve & pay → done).
- **The binding is ~15 lines** (`usePaymentSession` in `checkout.tsx`): create a
  session, `subscribe`, re-render. That's the entire cost of consuming pay-core
  in React — the inline equivalent of a future `pay-react` hook.
- **The machine drives it**: the right sidebar shows the live `step` and the
  journey, all coming from pay-core — the UI never decides flow, it just renders.

## Seams

Wired to the mock seams from `@walletconnect/pay-core/mocks` (scripted happy
path — no backend, no wallet). A real PSP swaps these for:

- an **`EngineTransport`** hitting their backend proxy (Engine keys stay server-side), and
- a **`WalletProvider`** — the AppKit adapter (`pay-appkit`) or their own wallet stack.

Nothing else in the UI changes.

## shadcn/ui

Components in `components/ui/` follow shadcn (vendored source — the copy-own
model). The `init -t next` CLI is interactive (prompts for monorepo setup), so
this example was scaffolded manually with the same structure (`components.json`,
`lib/utils`, Tailwind v4 tokens in `app/globals.css`).
