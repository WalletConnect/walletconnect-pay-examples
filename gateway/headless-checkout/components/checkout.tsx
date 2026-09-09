'use client'

import { createHttpTransport, formatAmount, shortAddress } from '@walletconnect/pay-core'
import {
  useAppKitWalletProvider,
  type ConnectedWallet,
  type WalletListItem
} from '@walletconnect/pay-appkit/react'
import {
  browserClock,
  isFailureState,
  type Namespace,
  type PaymentOptionExtended,
  type PaymentState
} from '@walletconnect/pay-state'
import { usePaymentSession } from '@walletconnect/pay-react'
import {
  Check,
  ChevronDown,
  ClipboardList,
  Coins,
  Loader2,
  Lock,
  ShieldCheck,
  Wallet,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { createAppKitSigner } from '@walletconnect/pay-appkit'

import { cn } from '@/lib/utils'
import { useAppKit } from '@/components/providers'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Qr } from '@/components/qr'

// The four buyer-facing steps. Each machine step maps to one of these stages, so
// the UI can show one expandable card per stage and lock the ones still ahead.
const STAGE: Record<string, number> = {
  Initializing: 0,
  ReadyForWallet: 0,
  ConnectingWallet: 0,
  LoadingOptions: 1,
  OptionsReady: 1,
  NoOptions: 1,
  InformationCapture: 2,
  OptionSelected: 3,
  RequiresApproval: 3,
  AwaitingWalletApproval: 3,
  WaitingForConfirmation: 3,
  Succeeded: 4
}

// Dev-only: the underlying machine steps, shown in the side panel.
const DEV_JOURNEY = [
  'ReadyForWallet',
  'ConnectingWallet',
  'LoadingOptions',
  'OptionsReady',
  'InformationCapture',
  'OptionSelected',
  'AwaitingWalletApproval',
  'WaitingForConfirmation',
  'Succeeded'
]

type AmountLike = {
  value?: string
  display?: {
    assetSymbol?: string
    assetName?: string
    networkName?: string | null
    decimals?: number
    iconUrl?: string | null
    networkIconUrl?: string | null
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

/** Friendly label for a CAIP namespace (the connect/disconnect surfaces). */
const NAMESPACE_LABEL: Record<string, string> = {
  eip155: 'Ethereum',
  solana: 'Solana'
}

function namespaceLabel(namespace: string): string {
  return NAMESPACE_LABEL[namespace] ?? namespace
}

function humanStatus(step: string): {
  label: string
  variant: 'success' | 'secondary' | 'outline' | 'destructive'
} {
  if (step === 'Succeeded') {
    return { label: 'Paid', variant: 'success' }
  }
  if (step === 'PaymentExpired') {
    return { label: 'Expired', variant: 'destructive' }
  }
  if (step === 'PaymentCancelled') {
    return { label: 'Cancelled', variant: 'destructive' }
  }
  if (isFailureState(step as PaymentState)) {
    return { label: 'Failed', variant: 'destructive' }
  }
  if (step === 'WaitingForConfirmation') {
    return { label: 'Processing', variant: 'secondary' }
  }

  return { label: 'Awaiting payment', variant: 'secondary' }
}

type StepStatus = 'complete' | 'active' | 'locked'

export function Checkout({ paymentId }: { paymentId: string }) {
  const appKit = useAppKit()
  const {
    wallet,
    wallets,
    allWallets,
    connectedWallets,
    supportedNamespaces,
    wcUri,
    isInitialized,
    getWcUri,
    searchQuery,
    setSearchQuery,
    hasMore,
    loadMore,
    isFetchingWallets
  } = useAppKitWalletProvider(appKit, {
    wcPayUrl: typeof window !== 'undefined' ? window.location.href : undefined
  })

  // Assemble the runtime seams: the Engine client (talks to our /api/wcp proxy), the
  // browser clock (status polling), and the signer (built from the wallet provider).
  const seams = useMemo(
    () => ({
      transport: createHttpTransport({ baseUrl: '/api/wcp' }),
      clock: browserClock,
      signer: createAppKitSigner(wallet)
    }),
    [wallet]
  )

  const { snapshot, connectWallet, disconnectWallet, selectOption, confirmSelection, submitInfoCapture } =
    usePaymentSession({ paymentId, seams, wallet })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [visited, setVisited] = useState<string[]>([])
  const [openStep, setOpenStep] = useState(0)
  // Remember which wallet the buyer picked, to show its logo once connected.
  const [pickedWallet, setPickedWallet] = useState<{ name?: string; icon?: string } | null>(null)
  // A multichain wallet awaiting a namespace choice (the "Choose a network" modal).
  const [networkChoice, setNetworkChoice] = useState<WalletListItem | null>(null)
  // The "Wallets" manage dialog (list connected wallets, disconnect per namespace).
  const [walletsOpen, setWalletsOpen] = useState(false)

  const step = snapshot.state
  const stage = STAGE[step] ?? 0
  // Terminal failure (expired / cancelled / failed): the whole flow is dead.
  const isFailure = isFailureState(step)

  useEffect(() => {
    setVisited(prev => (prev[prev.length - 1] === step ? prev : [...prev, step]))
  }, [step])

  // Keep the active stage expanded as the flow advances; collapse everything on failure.
  useEffect(() => {
    setOpenStep(isFailure ? -1 : Math.min(stage, 3))
  }, [stage, isFailure])

  // Pre-generate a generic WalletConnect URI so the QR is on screen immediately.
  // Must wait for AppKit to initialize: before that, `getWcUri` is a no-op that
  // resolves without producing a URI. Once `isInitialized` flips true this effect
  // re-runs and calls the real one.
  const wcRequestedRef = useRef(false)
  useEffect(() => {
    if (step === 'ReadyForWallet' && isInitialized && !wcUri && !wcRequestedRef.current) {
      wcRequestedRef.current = true
      void getWcUri().catch(err => console.error('[checkout] getWcUri failed', err))
    }
  }, [step, wcUri, getWcUri, isInitialized])

  // Re-arm the one-shot WC URI request whenever we leave the connect step. Without this
  // the ref stays `true` after the first fetch, so returning to ReadyForWallet (e.g.
  // after a disconnect) never regenerates a URI and the QR spins forever.
  useEffect(() => {
    if (step !== 'ReadyForWallet') {
      wcRequestedRef.current = false
    }
  }, [step])

  // Close the wallet dialog once we've moved past connection.
  useEffect(() => {
    if (step !== 'ReadyForWallet' && step !== 'ConnectingWallet') {
      setDialogOpen(false)
    }
  }, [step])

  const connected = snapshot.wallet.isConnected
  const firstAccount = snapshot.wallet.accounts[0]

  // Forget the picked wallet once nothing is connected.
  useEffect(() => {
    if (!connected) {
      setPickedWallet(null)
    }
  }, [connected])

  const payment = snapshot.payment as
    | { merchant?: { name?: string }; amount?: AmountLike }
    | undefined
  const options = (snapshot.options ?? []) as Array<{ id: string; amount?: AmountLike }>
  const selected = snapshot.selectedOption as
    | { id: string; amount?: AmountLike; actions?: Array<{ type: string }> }
    | undefined
  // A build-type option's wallet-RPC actions are fetched in the background once it's
  // selected; the runtime swaps the `build` action for `walletRpc` ones when ready.
  // Until then, signing has nothing to sign — so gate the Confirm CTA on it.
  const buildingActions = (selected?.actions ?? []).some(a => a.type === 'build')
  const visitedIc = visited.includes('InformationCapture')

  const selectWallet = (w: WalletListItem) => {
    setPickedWallet({ name: w.name, icon: w.icon })
    // A multichain extension can connect on more than one namespace — ask which.
    if (w.namespaces.length > 1) {
      setNetworkChoice(w)

      return
    }
    connectWallet(w, w.namespaces[0])
  }

  // The user picked a network in the "Choose a network" modal → connect that namespace.
  const connectNamespace = (namespace: Namespace) => {
    if (networkChoice) {
      connectWallet(networkChoice, namespace)
    }
    setNetworkChoice(null)
  }

  // Namespaces the runtime targets but the buyer hasn't connected yet — offered as
  // "connect another network" in the manage dialog. Connecting one refetches options.
  const unconnectedNamespaces = supportedNamespaces.filter(
    ns => !connectedWallets.some(w => w.namespace === ns)
  )
  // Show the "Wallets" manage hub (connect-more + per-namespace disconnect) when there's
  // more than a single connection to act on; otherwise a plain one-click Disconnect.
  const canManageWallets = connectedWallets.length > 1 || unconnectedNamespaces.length > 0

  // --- Per-step bodies (rendered only while that step is the active one) ------

  const walletGrid = wallets.slice(0, 6)
  const walletBody = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col items-center justify-center gap-2">
        {wcUri ? (
          <Qr uri={wcUri} />
        ) : (
          <div className="flex aspect-square w-full max-w-[200px] items-center justify-center rounded-lg bg-muted">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Scan with any wallet</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          {walletGrid.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
            ))
            : walletGrid.map(wallet => (
              <WalletTile key={wallet.id} wallet={wallet} onSelect={selectWallet} />
            ))}
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => setDialogOpen(true)}>
          See all
        </Button>
      </div>
    </div>
  )

  const tokenBody =
    step === 'LoadingOptions' ? (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Finding payment options…
      </div>
    ) : step === 'NoOptions' ? (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No payment options for this wallet.
      </p>
    ) : (
      <div className="space-y-2">
        {options.map((option, rank) => (
          <Button
            key={option.id}
            variant="outline"
            className="h-auto w-full justify-start gap-3 px-3 py-3"
            onClick={() => selectOption(option as unknown as PaymentOptionExtended, rank)}
          >
            <TokenIcon
              icon={option.amount?.display?.iconUrl}
              network={option.amount?.display?.networkIconUrl}
              symbol={option.amount?.display?.assetSymbol}
            />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span className="font-medium">{option.amount?.display?.assetSymbol ?? option.id}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {formatAmount(option.amount)}
                {option.amount?.display?.networkName ? ` · ${option.amount.display.networkName}` : ''}
              </span>
            </span>
          </Button>
        ))}
      </div>
    )

  // Render the identity form from the option's `collectData.schema` (the Engine's
  // JSON Schema — the source of truth). `collectData.fields` is the deprecated
  // fallback. Only interactive while the machine is actually in the IC step; when the
  // option skips IC (or it's already done), show a read-only note so a "peeked" card
  // can't fire INFO_CAPTURED into a state that ignores it.
  const collect = snapshot.collectData as CollectData | undefined
  const nativeFields = collect?.schema ? schemaToFields(collect.schema) : (collect?.fields ?? [])
  const icBody =
    step === 'InformationCapture' ? (
      <InfoCaptureForm
        fields={nativeFields}
        onSubmit={async data => {
          submitInfoCapture(data)

          return true
        }}
      />
    ) : (
      <p className="py-2 text-sm text-muted-foreground">
        {visitedIc ? 'Details submitted.' : 'Not required for this payment.'}
      </p>
    )

  const payBody = isFailure ? (
    <div className="py-4 text-center">
      <p className="font-medium">Payment {humanStatus(step).label.toLowerCase()}</p>
      <p className="text-sm text-muted-foreground">This payment can’t be completed.</p>
    </div>
  ) : step === 'Succeeded' ? (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-success/15">
        <Check className="size-6 text-success" />
      </span>
      <p className="font-medium">Paid {formatAmount(payment?.amount)}</p>
    </div>
  ) : step === 'WaitingForConfirmation' ? (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Submitting payment…
    </div>
  ) : step === 'AwaitingWalletApproval' ? (
    // Confirm moved the machine here, which auto-invokes the signing actor — the wallet
    // is prompting. No button: the signature/approval arrives via the runtime.
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Approve in your wallet…
    </div>
  ) : (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">Paying</span>
        <span className="font-medium">{formatAmount(selected?.amount)}</span>
      </div>
      {snapshot.signingError && (
        <p className="text-sm text-destructive">
          Signing failed ({snapshot.signingError.code}): {snapshot.signingError.message}
        </p>
      )}
      <Button className="w-full" disabled={buildingActions} onClick={() => confirmSelection()}>
        {buildingActions ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Preparing payment…
          </>
        ) : snapshot.requiresApproval ? (
          'Approve & pay'
        ) : (
          'Confirm'
        )}
      </Button>
    </div>
  )

  const steps: Array<{
    icon: LucideIcon
    title: string
    subtitle: string
    summary: string
    body: ReactNode
  }> = [
      {
        icon: Wallet,
        title: 'Connect your wallet',
        subtitle: 'Scan the QR or pick a wallet.',
        summary: connected ? `Connected ${shortAddress(firstAccount)}` : '',
        body: walletBody
      },
      {
        icon: Coins,
        title: 'Choose how to pay',
        subtitle: 'Pick a token to pay with.',
        summary: selected
          ? `${selected.amount?.display?.assetSymbol ?? ''} · ${formatAmount(selected.amount)}`
          : '',
        body: tokenBody
      },
      {
        icon: ClipboardList,
        title: 'A few details',
        subtitle: 'Identity details for this payment.',
        summary: visitedIc ? 'Details submitted' : 'Not required',
        body: icBody
      },
      {
        icon: ShieldCheck,
        title: 'Confirm & pay',
        subtitle: 'Approve the transaction in your wallet.',
        summary: step === 'Succeeded' ? `Paid ${formatAmount(payment?.amount)}` : '',
        body: payBody
      }
    ]

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {steps.map((s, i) => {
          // On terminal failure every step is locked; otherwise it's the usual ladder.
          const status: StepStatus = isFailure
            ? 'locked'
            : stage > i
              ? 'complete'
              : stage === i
                ? 'active'
                : 'locked'
          // Once connected, the wallet step becomes a non-collapsible identity row:
          // wallet + network logo, address, and an outline Disconnect on the right.
          const isConnectedWalletCard = i === 0 && connected

          return (
            <StepCard
              key={s.title}
              index={i}
              status={status}
              icon={s.icon}
              title={s.title}
              subtitle={s.subtitle}
              summary={s.summary}
              open={openStep === i}
              onToggle={() => setOpenStep(prev => (prev === i ? -1 : i))}
              collapsible={!isConnectedWalletCard}
              avatar={
                isConnectedWalletCard ? (
                  <WalletNetworkAvatar
                    walletIcon={pickedWallet?.icon}
                    walletName={pickedWallet?.name}
                    networkImage={undefined}
                  />
                ) : undefined
              }
              rightAction={
                isConnectedWalletCard && !isFailure && step !== 'Succeeded' ? (
                  canManageWallets ? (
                    // More than one connection to act on (connect another network, or
                    // disconnect one of several) → open the manage hub.
                    <Button variant="outline" size="sm" onClick={() => setWalletsOpen(true)}>
                      Wallets
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => disconnectWallet()}>
                      Disconnect
                    </Button>
                  )
                ) : undefined
              }
            >
              {s.body}
            </StepCard>
          )
        })}
      </div>

      <div className="space-y-4">
        <PaymentInfo payment={payment} paymentId={paymentId} selected={selected} step={step} />
        <MachineStatePanel step={step} visited={visited} />
      </div>

      {dialogOpen && (
        <WalletDialog
          wallets={wallets}
          connecting={step === 'ConnectingWallet'}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          hasMore={hasMore}
          isFetching={isFetchingWallets}
          onLoadMore={loadMore}
          onSelect={selectWallet}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {networkChoice && (
        <NetworkSelectorDialog
          wallet={networkChoice}
          onSelect={connectNamespace}
          onClose={() => setNetworkChoice(null)}
        />
      )}

      {walletsOpen && (
        <ManageWalletsDialog
          connectedWallets={connectedWallets}
          unconnectedNamespaces={unconnectedNamespaces}
          allWallets={allWallets}
          onConnect={(walletRef, namespace) => {
            connectWallet(walletRef, namespace)
            setPickedWallet({ name: walletRef.name, icon: walletRef.icon })
            setWalletsOpen(false)
          }}
          onDisconnect={namespace => disconnectWallet(namespace)}
          onClose={() => setWalletsOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * One expandable step. Active = expanded, complete = collapsed summary, locked = disabled.
 * `avatar` replaces the step icon (e.g. wallet+network logo); `collapsible=false` turns
 * the header into a static row (no chevron/toggle); `rightAction` sits before the chevron.
 */
function StepCard({
  index,
  status,
  icon: Icon,
  title,
  subtitle,
  summary,
  open,
  onToggle,
  children,
  avatar,
  rightAction,
  collapsible = true
}: {
  index: number
  status: StepStatus
  icon: LucideIcon
  title: string
  subtitle: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
  avatar?: ReactNode
  rightAction?: ReactNode
  collapsible?: boolean
}) {
  const locked = status === 'locked'

  const header = (
    <CardHeader className="flex-row items-center gap-3 p-4">
      <StepIndicator status={status} index={index} />
      {avatar ?? <Icon className="size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="truncate">
          {status === 'complete' && summary ? summary : subtitle}
        </CardDescription>
      </div>
      {rightAction}
      {locked ? (
        <Lock className="size-4 shrink-0 text-muted-foreground" />
      ) : collapsible ? (
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      ) : null}
    </CardHeader>
  )

  return (
    <Card className={cn(locked && 'opacity-60', 'shadow-xs')}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          disabled={locked}
          className="w-full text-left disabled:cursor-not-allowed"
        >
          {header}
        </button>
      ) : (
        header
      )}
      {open && !locked && collapsible && <CardContent className="p-4 pt-0">{children}</CardContent>}
    </Card>
  )
}

/** Token logo with a small network badge — used in the option list. */
function TokenIcon({
  icon,
  network,
  symbol
}: {
  icon?: string | null
  network?: string | null
  symbol?: string
}) {
  return (
    <span className="relative shrink-0">
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt={symbol ?? ''} className="size-8 rounded-full object-cover" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
          {symbol?.slice(0, 3) ?? '?'}
        </span>
      )}
      {network ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={network}
          alt=""
          className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-2 border-background object-cover"
        />
      ) : null}
    </span>
  )
}

/** Connected-wallet logo with the active-network badge — used in the wallet step header. */
function WalletNetworkAvatar({
  walletIcon,
  walletName,
  networkImage
}: {
  walletIcon?: string
  walletName?: string
  networkImage?: string
}) {
  return (
    <span className="relative shrink-0">
      {walletIcon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={walletIcon} alt={walletName ?? ''} className="size-7 rounded-lg object-cover" />
      ) : (
        <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
          <Wallet className="size-4 text-muted-foreground" />
        </span>
      )}
      {networkImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={networkImage}
          alt=""
          className="absolute -bottom-1 -right-1 size-3.5 rounded-full border-2 border-background object-cover"
        />
      ) : null}
    </span>
  )
}

function StepIndicator({ status, index }: { status: StepStatus; index: number }) {
  if (status === 'complete') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check className="size-3.5" />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
        status === 'active' ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground'
      )}
    >
      {index + 1}
    </span>
  )
}

function PaymentInfo({
  payment,
  paymentId,
  selected,
  step
}: {
  payment?: { merchant?: { name?: string }; amount?: AmountLike }
  paymentId: string
  selected?: { amount?: AmountLike }
  step: string
}) {
  const merchant = payment?.merchant?.name ?? 'Merchant'
  const status = humanStatus(step)
  const rows = (
    [
      ['Pay to', merchant],
      payment?.amount?.display?.networkName ? ['Network', payment.amount.display.networkName] : null,
      selected ? ['Paying with', selected.amount?.display?.assetSymbol ?? '—'] : null,
      ['Reference', shortId(paymentId)]
    ] as Array<[string, string] | null>
  ).filter(Boolean) as Array<[string, string]>

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{merchant}</CardDescription>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <CardTitle className="text-3xl">{formatAmount(payment?.amount)}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {rows.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="truncate font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function MachineStatePanel({ step, visited }: { step: string; visited: string[] }) {
  return (
    <Card className="border-dashed bg-muted/30 shadow-none">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs font-medium uppercase tracking-wide">
          Dev · machine state
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5">
          {DEV_JOURNEY.map(name => {
            const active = name === step
            const done = visited.includes(name) && !active

            return (
              <li key={name} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'flex size-4 items-center justify-center rounded-full border text-[9px]',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : done
                        ? 'border-success bg-success text-white'
                        : 'border-border text-muted-foreground'
                  )}
                >
                  {done ? '✓' : ''}
                </span>
                <span className={active ? 'font-medium' : 'text-muted-foreground'}>{name}</span>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

/** Wallet logo with a fallback, plus a green dot when it's an installed extension. */
function WalletIcon({
  icon,
  name,
  className
}: {
  icon?: string
  name: string
  className?: string
}) {
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt={name} className={cn('rounded-lg object-cover', className)} />
  }

  return (
    <span className={cn('flex items-center justify-center rounded-lg bg-muted', className)}>
      <Wallet className="size-1/2 text-muted-foreground" />
    </span>
  )
}

/** A single wallet tile in the connect grid. */
function WalletTile({
  wallet,
  onSelect
}: {
  wallet: WalletListItem
  onSelect: (wallet: WalletListItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(wallet)}
      className="flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors hover:bg-accent"
    >
      <span className="relative">
        <WalletIcon icon={wallet.icon} name={wallet.name} className="size-10" />
        {wallet.installed && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-success" />
        )}
      </span>
      <span className="w-full truncate text-center text-xs">{wallet.name}</span>
    </button>
  )
}

/**
 * Modal listing wallets (the "see all" view). Mirrors BX: a debounced search box
 * (the hook debounces the fetch internally — we just wire value + onChange) plus
 * infinite-scroll pagination. When the buyer scrolls near the bottom of the list and
 * there are more pages to load (`hasMore`) and no fetch is in flight (`!isFetching`),
 * we ask the hook for the next page via `onLoadMore`.
 */
function WalletDialog({
  wallets,
  connecting,
  searchQuery,
  onSearchChange,
  hasMore,
  isFetching,
  onLoadMore,
  onSelect,
  onClose
}: {
  wallets: WalletListItem[]
  connecting: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  hasMore: boolean
  isFetching: boolean
  onLoadMore: () => Promise<void>
  onSelect: (wallet: WalletListItem) => void
  onClose: () => void
}) {
  // Trigger the next page when the buyer scrolls within this many px of the bottom.
  const LOAD_MORE_THRESHOLD_PX = 80

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!hasMore || isFetching) {
      return
    }
    const el = e.currentTarget
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceToBottom <= LOAD_MORE_THRESHOLD_PX) {
      void onLoadMore()
    }
  }

  // Empty state only once a fetch has settled — while fetching, show the spinner instead.
  const isEmpty = wallets.length === 0 && !isFetching

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>Select a wallet</CardTitle>
          <CardDescription>
            {connecting ? 'Connecting…' : 'Choose a wallet to connect.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search wallets"
            className={inputClass}
            autoFocus
          />
          <div className="max-h-80 space-y-1 overflow-y-auto" onScroll={handleScroll}>
            {isEmpty && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No wallets match your search.' : 'No wallets available.'}
              </p>
            )}
            {wallets.map(wallet => (
              <button
                key={wallet.id}
                onClick={() => onSelect(wallet)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="relative shrink-0">
                  <WalletIcon icon={wallet.icon} name={wallet.name} className="size-7" />
                  {wallet.installed && (
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-success" />
                  )}
                </span>
                <span className="font-medium">{wallet.name}</span>
              </button>
            ))}
            {isFetching && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * "Choose a network" modal — shown when a multichain extension wallet supports more
 * than one namespace (e.g. MetaMask: Ethereum + Solana). The buyer picks which
 * namespace to connect; we forward it to the runtime's `connectWallet(wallet, namespace)`.
 */
function NetworkSelectorDialog({
  wallet,
  onSelect,
  onClose
}: {
  wallet: WalletListItem
  onSelect: (namespace: Namespace) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>Choose a network</CardTitle>
          <CardDescription>{wallet.name} supports more than one network.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {wallet.namespaces.map(namespace => (
              <button
                key={namespace}
                onClick={() => onSelect(namespace)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Coins className="size-4 text-muted-foreground" />
                </span>
                <span className="font-medium">{namespaceLabel(namespace)}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * "Wallets" manage hub — a single dialog for multi-namespace connections:
 *
 * - Lists every connected namespace (network label + address) with a per-namespace
 *   Disconnect, so the buyer can drop one chain without losing the others.
 * - Lists the still-un-connected namespaces with a "Connect" action; picking one opens
 *   an in-dialog wallet picker filtered to wallets that support that namespace. Selecting
 *   a wallet connects it on that namespace (the runtime then refetches options).
 */
function ManageWalletsDialog({
  connectedWallets,
  unconnectedNamespaces,
  allWallets,
  onConnect,
  onDisconnect,
  onClose
}: {
  connectedWallets: ConnectedWallet[]
  unconnectedNamespaces: Namespace[]
  allWallets: WalletListItem[]
  onConnect: (wallet: WalletListItem, namespace: Namespace) => void
  onDisconnect: (namespace: Namespace) => void
  onClose: () => void
}) {
  // When set, the dialog shows the wallet picker for connecting this namespace.
  const [connectTarget, setConnectTarget] = useState<Namespace | null>(null)

  // Only wallets that can connect the target namespace (e.g. Solana extensions for solana).
  const pickerWallets = connectTarget
    ? allWallets.filter(w => w.namespaces.includes(connectTarget))
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
        {connectTarget ? (
          <>
            <CardHeader>
              <CardTitle>Connect {namespaceLabel(connectTarget)}</CardTitle>
              <CardDescription>Choose a wallet to connect on this network.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {pickerWallets.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No wallets available for this network.
                  </p>
                )}
                {pickerWallets.map(w => (
                  <button
                    key={w.id}
                    onClick={() => onConnect(w, connectTarget)}
                    className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                  >
                    <span className="relative shrink-0">
                      <WalletIcon icon={w.icon} name={w.name} className="size-7" />
                      {w.installed && (
                        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-success" />
                      )}
                    </span>
                    <span className="font-medium">{w.name}</span>
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setConnectTarget(null)}
              >
                Back
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Wallets</CardTitle>
              <CardDescription>Manage connected networks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {connectedWallets.map(connected => (
                  <div
                    key={connected.namespace}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{namespaceLabel(connected.namespace)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {shortAddress(connected.caipAddress)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDisconnect(connected.namespace)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ))}
              </div>

              {unconnectedNamespaces.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Add a network
                  </p>
                  {unconnectedNamespaces.map(namespace => (
                    <div
                      key={namespace}
                      className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3"
                    >
                      <p className="font-medium">{namespaceLabel(namespace)}</p>
                      <Button size="sm" onClick={() => setConnectTarget(namespace)}>
                        Connect
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border bg-muted/40 px-4 py-3 text-sm outline-none transition-colors focus:bg-background'

/** One field from the option's `collectData` (rendered by {@link InfoCaptureForm}). */
type CollectField = {
  id: string
  name: string
  required: boolean
  type: 'text' | 'date' | 'checkbox'
}

/** The Engine's `collectData` as the SDK surfaces it on the snapshot. */
type CollectSchema = {
  properties?: Record<string, { title?: string; type?: string; format?: string; const?: unknown }>
  required?: string[]
}
type CollectData = { schema?: CollectSchema; fields?: CollectField[] }

/** Flatten a JSON-Schema `collectData.schema` into the field model the form renders. */
function schemaToFields(schema: CollectSchema): CollectField[] {
  const required = new Set(schema.required ?? [])

  return Object.entries(schema.properties ?? {}).map(([id, prop]) => ({
    id,
    name: prop.title ?? id,
    required: required.has(id),
    type:
      prop.const !== undefined || prop.type === 'boolean'
        ? 'checkbox'
        : prop.format === 'date'
          ? 'date'
          : 'text'
  }))
}

/**
 * KYC form rendered from the option's `collectData.fields` schema — a text, date
 * or checkbox input per field, per the Engine contract. Submitted values (keyed
 * by field id) are kept in machine context and sent with `/confirm` as
 * `collectedData`. No fields are hardcoded; the PSP just renders the schema.
 */
function InfoCaptureForm({
  fields,
  onSubmit
}: {
  fields: CollectField[]
  onSubmit: (data: Record<string, string | boolean>) => Promise<boolean>
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  const valid = fields.every(field => {
    if (!field.required) {
      return true
    }
    const value = values[field.id]
    if (field.type === 'checkbox') {
      return value === true
    }

    return typeof value === 'string' && value.trim() !== ''
  })

  const submit = async () => {
    if (!valid || submitting) {
      return
    }
    setSubmitting(true)
    const ok = await onSubmit(values)
    if (!ok) {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      {fields.map(field =>
        field.type === 'checkbox' ? (
          <label
            key={field.id}
            className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/40 px-4 py-3"
          >
            <span className="text-sm">{field.name}</span>
            <input
              type="checkbox"
              checked={values[field.id] === true}
              onChange={e => setValues(v => ({ ...v, [field.id]: e.target.checked }))}
              className="size-4"
            />
          </label>
        ) : (
          <input
            key={field.id}
            className={inputClass}
            type={field.type === 'date' ? 'date' : 'text'}
            placeholder={field.name}
            value={(values[field.id] as string) ?? ''}
            onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))}
          />
        )
      )}
      <Button className="w-full" disabled={!valid || submitting} onClick={submit}>
        {submitting && <Loader2 className="animate-spin" />} Confirm
      </Button>
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {[0, 1, 2, 3].map(i => (
          <Card key={i}>
            <CardHeader className="flex-row items-center gap-3 p-4">
              <span className="size-6 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                <div className="h-3 w-44 animate-pulse rounded bg-muted" />
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="space-y-4">
        <Card>
          <CardContent className="flex min-h-[140px] items-center justify-center pt-6">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
