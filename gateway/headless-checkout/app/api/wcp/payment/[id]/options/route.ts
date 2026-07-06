import { callEngine } from '@/lib/server/engine'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  return callEngine(`/v1/gateway/payment/${id}/options`, { method: 'POST', body })
}
