import { Checkout } from '@/components/checkout'
import { Providers } from '@/components/providers'

/**
 * Real-payment route: /<paymentId>.
 *
 * Reads the payment id from the URL and runs the checkout against the LIVE
 * Engine (via the /api/wcp proxy). Same UI, same machine — only the
 * EngineTransport is real instead of mocked.
 */
export default async function PaymentPage({
  params
}: {
  params: Promise<{ paymentId: string }>
}) {
  const { paymentId } = await params

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Providers>
        <Checkout paymentId={paymentId} />
      </Providers>
    </main>
  )
}
