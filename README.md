# WalletConnect Pay — Examples

Reference integrations for the **WalletConnect Pay headless SDK**
(`@walletconnect/pay-core`, `-state`, `-react`, `-appkit`).

## `gateway/`

Buyer-side (gateway) checkout examples:

| Example | Stack | What it shows |
| --- | --- | --- |
| [`gateway/headless-checkout`](./gateway/headless-checkout) | Next.js (App Router) | React integration via `@walletconnect/pay-react` + `@walletconnect/pay-appkit`, server-side Engine proxy |
| [`gateway/headless-checkout-vanilla`](./gateway/headless-checkout-vanilla) | Vite + vanilla TS | Framework-neutral integration driving the payment controller directly |

Each example is self-contained — see its own `README.md` for setup.

## Install & run

```bash
cd gateway/headless-checkout   # or gateway/headless-checkout-vanilla
pnpm install
pnpm dev
```

The examples pin the `@walletconnect/pay-*` packages at `^0.2.0` from npm.
