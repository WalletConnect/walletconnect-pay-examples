import { callEngine } from '@/lib/server/engine'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return callEngine(`/v1/gateway/payment/${id}`, { method: 'GET' })
}
