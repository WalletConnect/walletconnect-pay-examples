import { createRequire } from 'node:module'
import path from 'node:path'

import type { NextConfig } from 'next'

const require = createRequire(import.meta.url)

const nextConfig: NextConfig = {
  // Compile the workspace SDK packages within the app's module graph.
  transpilePackages: [
    '@walletconnect/pay-appkit',
    '@walletconnect/pay-react',
    '@walletconnect/pay-state'
  ],
  // Pin the trace root to the monorepo (silences the multi-lockfile warning).
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any, { webpack }: any) => {
    // SINGLE AppKit instance. In a pnpm workspace, @walletconnect/pay-appkit and this
    // app can resolve DIFFERENT physical @reown/appkit copies (different peer-hashes),
    // which splits AppKit's controller singleton — the package's hook then reads an
    // empty controller (no wallets, no WC URI). Force every @reown/appkit* import (the
    // package's hook AND this app's createAppKit) to the app's single copy so they
    // share one controller. Aliases are exact (respect each package's `exports` map).
    config.resolve.alias = {
      ...config.resolve.alias,
      '@reown/appkit$': require.resolve('@reown/appkit'),
      '@reown/appkit/react': require.resolve('@reown/appkit/react'),
      '@reown/appkit-controllers$': require.resolve('@reown/appkit-controllers'),
      '@reown/appkit-controllers/react': require.resolve('@reown/appkit-controllers/react')
    }

    // Optional wallet-connector deps that @wagmi/connectors references for connectors
    // this demo never instantiates. Ignore so webpack doesn't fail resolving them.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(porto|accounts|@metamask\/connect-evm|@base-org\/account|pino-pretty|lokijs|encoding)(\/|$)/
      })
    )

    return config
  }
}

export default nextConfig
