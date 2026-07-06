import { Checkout } from '@/components/checkout'
import { Providers } from '@/components/providers'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Providers>
        <Checkout paymentId="pay_demo_123" />
      </Providers>
    </main>
  )
}
