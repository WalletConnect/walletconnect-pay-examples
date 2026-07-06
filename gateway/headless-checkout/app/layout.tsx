import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'Headless Checkout — pay-core demo',
  description: 'A PSP-owned checkout UI built on @walletconnect/pay-core'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
