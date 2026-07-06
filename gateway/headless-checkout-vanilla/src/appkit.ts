/**
 * Headless AppKit setup. Like the React example, this runs AppKit headless (no modal):
 * `features.headless` lets the host fetch the WalletGuide list and connect a chosen wallet
 * programmatically via `createAppKitWalletList`, so the UI owns a custom wallet picker
 * (search + infinite scroll + click-to-connect) instead of AppKit's standard modal.
 */
import { createAppKit, type AppKit } from '@reown/appkit'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import {
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
  solana,
  type AppKitNetwork
} from '@reown/appkit/networks'

// The same networks must reach createAppKit AND the wallet adapter, so a connected
// wallet's address expands across these chains in the `/options` request.
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  solana
]

// Public projectId for localhost only; set VITE_APPKIT_PROJECT_ID for your own.
const projectId = import.meta.env.VITE_APPKIT_PROJECT_ID || 'b56e18d47c72ab683b10814fe9495694'

/** Construct the AppKit instance once (module scope, runs on import). */
export const appKit: AppKit = createAppKit({
  adapters: [new WagmiAdapter({ networks, projectId }), new SolanaAdapter()],
  networks,
  projectId,
  // Headless: no modal — the host renders its own wallet picker and connects programmatically.
  features: { headless: true },
  metadata: {
    name: 'Acme Pay (vanilla)',
    description: 'Headless checkout demo — vanilla JS',
    url: window.location.origin,
    icons: []
  }
})
