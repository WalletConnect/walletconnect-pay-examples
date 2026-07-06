'use client'

import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** Renders a WalletConnect URI as a scannable QR code. */
export function Qr({ uri }: { uri: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    QRCode.toDataURL(uri, { width: 240, margin: 2 })
      .then(url => {
        if (active) setDataUrl(url)
      })
      .catch(() => {
        if (active) setDataUrl(null)
      })

    return () => {
      active = false
    }
  }, [uri])

  if (!dataUrl) {
    return <div className="size-[240px] animate-pulse rounded-lg bg-muted" />
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="WalletConnect QR code" width={240} height={240} className="rounded-lg" />
}
