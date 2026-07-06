'use client'

import type { AppKit } from '@reown/appkit'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  celo,
  mainnet,
  monad,
  optimism,
  polygon,
  solana,
  zksync,
  type AppKitNetwork
} from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState } from 'react'
import { WagmiProvider } from 'wagmi'

/**
 * The same networks must be passed to createAppKit AND to the wallet adapter. Mirrors
 * BX's configured set (`AppKitProvider`) so a connected wallet's address expands across
 * the same chains in the `/options` request.
 */
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  avalanche,
  zksync,
  bsc,
  celo,
  monad,
  solana
]

const projectId = process.env.NEXT_PUBLIC_APPKIT_PROJECT_ID ?? ''

let wagmiAdapter: WagmiAdapter | null = null
let appKitInstance: AppKit | null = null

/** Initialize AppKit once, on the client. Ported from BX's initializeAppKit. */
function initAppKit(): { adapter: WagmiAdapter; appKit: AppKit } | null {
  if (wagmiAdapter && appKitInstance) {
    return { adapter: wagmiAdapter, appKit: appKitInstance }
  }
  if (typeof window === 'undefined' || !projectId) {
    return null
  }

  wagmiAdapter = new WagmiAdapter({ networks, projectId })
  appKitInstance = createAppKit({
    adapters: [wagmiAdapter, new SolanaAdapter()],
    networks,
    projectId,
    // Headless: no AppKit modal — this app renders its own wallet picker and connects
    // programmatically through `useAppKitWalletProvider` (matches BX).
    features: { headless: true },
    metadata: {
      name: 'Acme Pay',
      description: 'Headless checkout demo',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://example.com',
      icons: []
    }
  })

  return { adapter: wagmiAdapter, appKit: appKitInstance }
}

/** The constructed AppKit instance, exposed so the checkout can build the wallet seam. */
const AppKitContext = createContext<AppKit | null>(null)

/** Read the live AppKit instance. Non-null below `<Providers>` (it gates on init). */
export function useAppKit(): AppKit {
  const appKit = useContext(AppKitContext)
  if (!appKit) {
    throw new Error('useAppKit must be used within <Providers> after AppKit initializes')
  }

  return appKit
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ adapter: WagmiAdapter; appKit: AppKit } | null>(null)
  const [queryClient] = useState(() => new QueryClient())

  useEffect(() => {
    setState(initAppKit())
  }, [])

  if (!projectId) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-sm text-muted-foreground">
        Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_APPKIT_PROJECT_ID</code> in{' '}
        <code className="rounded bg-muted px-1">.env.local</code> to enable wallet connection.
      </div>
    )
  }

  if (!state) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="p-6 text-center text-sm text-muted-foreground">Initializing…</div>
      </QueryClientProvider>
    )
  }

  return (
    <WagmiProvider config={state.adapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppKitContext.Provider value={state.appKit}>{children}</AppKitContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
