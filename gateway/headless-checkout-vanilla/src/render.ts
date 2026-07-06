/**
 * Imperative, framework-free rendering of the checkout from a `PaymentSnapshot` —
 * the vanilla equivalent of the React example's stepper + sidebar. The machine owns
 * the flow; this only dresses each state and wires controls to the controller's named
 * actions.
 *
 * `createCheckout(mount, controller, connectButton)` returns a `render(snapshot)` that
 * rebuilds the UI on every transition. It keeps a little view-only state (visited
 * steps, which step is expanded) so the stepper behaves like the React one.
 */
import QRCode from 'qrcode'
import { formatAmount, shortAddress } from '@walletconnect/pay-core'
import type { AppKitWalletList, ConnectedWallet, WalletListItem } from '@walletconnect/pay-appkit'
import { isFailureState } from '@walletconnect/pay-state'
import type {
  Namespace,
  PaymentController,
  PaymentSnapshot,
  PaymentState
} from '@walletconnect/pay-state'

/** Friendly label for a CAIP namespace. */
const NAMESPACE_LABEL: Record<string, string> = { eip155: 'Ethereum', solana: 'Solana' }
function namespaceLabel(namespace: string): string {
  return NAMESPACE_LABEL[namespace] ?? namespace
}

/** Loose views of the Engine shapes we read — enough to render without over-typing. */
type AmountLike = {
  value?: string
  display?: {
    assetSymbol?: string
    networkName?: string | null
    decimals?: number
  }
}
type OptionLike = { id: string; amount?: AmountLike; actions?: Array<{ type: string }> }
type CollectFieldLike = { id: string; name: string; required: boolean; type: 'text' | 'date' | 'checkbox' }

// Each machine state maps to one of the four buyer-facing stages, so the UI shows one
// card per stage and locks the ones still ahead. Mirrors the React example's STAGE map.
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

// The underlying machine steps, shown in the dev side panel (mirrors the React example).
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

type Variant = 'success' | 'secondary' | 'destructive'

function humanStatus(step: string): { label: string; variant: Variant } {
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

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

/** Create an element with optional class + text. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (opts.class) {
    node.className = opts.class
  }
  if (opts.text !== undefined) {
    node.textContent = opts.text
  }

  return node
}

/** Inline SVG helpers (no icon dependency). */
function icon(path: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  svg.append(p)

  return svg
}

const CHECK = 'M20 6 9 17l-5-5'
const LOCK_PATH = 'M19 11H5v10h14V11ZM7 11V7a5 5 0 0 1 10 0v4'
const CHEVRON = 'm6 9 6 6 6-6'
// A generic wallet glyph, used as the fallback avatar in the connect grid + tiles.
const WALLET_PATH = 'M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7M16 12h.01'

export interface Checkout {
  render: (snapshot: PaymentSnapshot) => void
}

/** Build the checkout view bound to a mount node + payment controller + wallet list. */
export interface CheckoutOptions {
  /** The mount node the checkout renders into (replaced on each transition). */
  mount: HTMLElement
  /** The session controller to read snapshots from and drive via named actions. */
  controller: PaymentController
  /** The headless wallet-list controller — drives the custom picker (fetch/search/paginate). */
  walletList: AppKitWalletList
  /** The payment id — shown in the summary's Reference row. */
  paymentId: string
}

export function createCheckout(options: CheckoutOptions): Checkout {
  const { mount, controller, walletList, paymentId } = options
  const visited = new Set<string>()
  let openStep = 0
  let prevStage: number | null = null
  let lastSnapshot: PaymentSnapshot | null = null
  // The "See all" wallet modal (search + infinite-scroll list) — opened from the connect grid.
  let dialogOpen = false
  // A multichain wallet awaiting a namespace choice (the "Choose a network" modal). When set,
  // the network-selector dialog is shown; clearing it closes the dialog.
  let networkChoice: WalletListItem | null = null
  // The "Wallets" manage hub (per-namespace disconnect + connect-another-network); when true
  // the manage dialog is shown. `manageTarget` drills into the in-dialog wallet picker.
  let walletsOpen = false
  let manageTarget: Namespace | null = null
  // Remember which wallet the buyer picked, to show its logo once connected.
  let pickedWallet: { name?: string; icon?: string } | null = null
  // Debounce handle for the search input, so each keystroke doesn't fire a WalletGuide fetch.
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const rerender = (): void => {
    if (lastSnapshot) {
      render(lastSnapshot)
    }
  }

  /**
   * A stepper card with a status indicator, title/summary, and (when open) a body. The
   * `extras` let the connect step, once connected, render as a non-collapsible identity row:
   * `avatar` replaces the numbered indicator's neighbouring slot, `rightAction` sits before the
   * chevron, and `collapsible: false` makes the header a static row (no toggle/chevron).
   */
  function stepCard(
    index: number,
    status: 'complete' | 'active' | 'locked',
    title: string,
    subtitle: string,
    summary: string,
    body: HTMLElement | null,
    extras: { avatar?: HTMLElement; rightAction?: HTMLElement; collapsible?: boolean } = {}
  ): HTMLElement {
    const collapsible = extras.collapsible ?? true
    const card = el('div', { class: `card step${status === 'locked' ? ' step--locked' : ''}` })
    const open = openStep === index && status !== 'locked' && body !== null && collapsible

    // A static header is a plain div; a collapsible one is a toggle button.
    const header = el(collapsible ? 'button' : 'div', { class: 'step__header' })
    if (collapsible) {
      ;(header as HTMLButtonElement).type = 'button'
      ;(header as HTMLButtonElement).disabled = status === 'locked'
    }

    const indicator = el('span', {
      class:
        'step__indicator' +
        (status === 'active' ? ' step__indicator--active' : '') +
        (status === 'complete' ? ' step__indicator--complete' : '')
    })
    if (status === 'complete') {
      indicator.append(icon(CHECK, 14))
    } else {
      indicator.textContent = String(index + 1)
    }
    header.append(indicator)

    if (extras.avatar) {
      header.append(extras.avatar)
    }

    const textWrap = el('div', { class: 'step__text' })
    textWrap.append(el('h2', { class: 'step__title', text: title }))
    textWrap.append(
      el('p', { class: 'step__desc', text: status === 'complete' && summary ? summary : subtitle })
    )
    header.append(textWrap)

    if (extras.rightAction) {
      header.append(extras.rightAction)
    }

    if (status === 'locked') {
      header.append(icon(LOCK_PATH, 15))
    } else if (collapsible) {
      const chevron = icon(CHEVRON, 16)
      chevron.classList.add('step__chevron')
      if (open) {
        chevron.classList.add('step__chevron--open')
      }
      header.append(chevron)
    }

    if (collapsible) {
      header.addEventListener('click', () => {
        if (status === 'locked') {
          return
        }
        openStep = openStep === index ? -1 : index
        rerender()
      })
    }

    card.append(header)

    if (open && body) {
      const bodyWrap = el('div', { class: 'step__body' })
      bodyWrap.append(body)
      card.append(bodyWrap)
    }

    return card
  }

  // ── Step bodies ────────────────────────────────────────────────────────────

  /**
   * Select a wallet from the connect grid (or a dialog). Mirrors the React example's
   * `selectWallet`: a multichain extension (more than one connectable namespace) opens the
   * "Choose a network" dialog; otherwise we connect on its first namespace right away. Either
   * way we remember the picked wallet so its logo can show in the connected header.
   */
  function selectWallet(item: WalletListItem): void {
    pickedWallet = { name: item.name, icon: item.icon }
    if (item.namespaces.length > 1) {
      networkChoice = item
      rerender()

      return
    }
    dialogOpen = false
    controller.connectWallet(item, item.namespaces[0])
    rerender()
  }

  /** A wallet logo `<img>`, or a generic-wallet fallback chip when WalletGuide has no icon. */
  function walletAvatar(item: WalletListItem, cls: string): HTMLElement {
    if (item.icon) {
      const img = el('img', { class: cls })
      img.src = item.icon
      img.alt = item.name
      img.loading = 'lazy'

      return img
    }
    const fallback = el('span', { class: `${cls} avatar--fallback` })
    fallback.append(icon(WALLET_PATH, 18))

    return fallback
  }

  /**
   * The left column of the connect step: the WalletConnect QR rendered from `wcUri`, or a
   * loading spinner until the URI is generated, with a "Scan with any wallet" caption.
   * Mirrors the React example's `Qr` component (also `qrcode` → a data-URL `<img>`). The URI
   * is pre-fetched eagerly (see main.ts) so the QR is on screen the moment the step opens.
   */
  function qrPanel(): HTMLElement {
    const { wcUri } = walletList.getState()
    const panel = el('div', { class: 'qr' })

    if (wcUri) {
      const img = el('img', { class: 'qr__code' })
      img.alt = 'WalletConnect QR code'
      // `toDataURL` is async; render the box now and swap in the data-URL when it resolves.
      QRCode.toDataURL(wcUri, { width: 200, margin: 2 })
        .then(url => {
          img.src = url
        })
        .catch(error => console.error('[checkout] QR render failed', error))
      panel.append(img)
    } else {
      // No URI yet — a pulsing placeholder until the eager `getWcUri()` resolves.
      panel.append(el('div', { class: 'qr__loading' }))
    }
    panel.append(el('p', { class: 'qr__caption', text: 'Scan with any wallet' }))

    return panel
  }

  /** One wallet tile in the connect grid: avatar (+ an installed dot) + name; click → select. */
  function walletTile(item: WalletListItem): HTMLElement {
    const tile = el('button', { class: 'tile' })
    tile.type = 'button'

    const avatarWrap = el('span', { class: 'tile__avatar' })
    avatarWrap.append(walletAvatar(item, 'tile__icon'))
    if (item.installed) {
      // Green dot badge — marks an installed browser extension (mirrors the React tile).
      avatarWrap.append(el('span', { class: 'tile__dot' }))
    }
    tile.append(avatarWrap)
    tile.append(el('span', { class: 'tile__name', text: item.name }))

    tile.addEventListener('click', () => selectWallet(item))

    return tile
  }

  /**
   * The connect step's main body when not connected: a 2-column layout — the QR on the left,
   * a 3-column grid of the first 6 wallets as tiles + a full-width "See all" button on the
   * right (which opens the searchable wallet dialog). Mirrors the React example's `walletBody`.
   */
  function connectGrid(snapshot: PaymentSnapshot): HTMLElement {
    const state = walletList.getState()
    const grid = state.wallets.slice(0, 6)

    const wrap = el('div', { class: 'connect-grid' })
    wrap.append(qrPanel())

    const right = el('div', { class: 'connect-grid__right' })
    const tiles = el('div', { class: 'tiles' })
    if (grid.length === 0) {
      // Skeleton tiles until the first WalletGuide fetch resolves (mirrors the React example).
      for (let i = 0; i < 6; i += 1) {
        tiles.append(el('div', { class: 'tile tile--skeleton' }))
      }
    } else {
      for (const item of grid) {
        tiles.append(walletTile(item))
      }
    }
    right.append(tiles)

    // A "connecting" line while the machine is mid-connect (the React tile shows the same).
    if (snapshot.state === 'ConnectingWallet') {
      right.append(el('p', { class: 'connect__status', text: 'Connecting…' }))
    }

    const seeAll = el('button', { class: 'button--outline button--block', text: 'See all' })
    seeAll.type = 'button'
    seeAll.addEventListener('click', () => {
      dialogOpen = true
      rerender()
    })
    right.append(seeAll)
    wrap.append(right)

    return wrap
  }

  function connectBody(snapshot: PaymentSnapshot): HTMLElement {
    // Not connected → the QR + 6-tile grid + "See all". The connected case is handled by the
    // step header (a non-collapsible identity row with a Disconnect / Wallets action), so this
    // body is only ever rendered for the not-connected state.
    return connectGrid(snapshot)
  }

  // ── Wallet-connect dialogs (overlays driven by view-state, not the snapshot) ─────────

  /** A modal shell: a dimmed backdrop (click-to-close) wrapping a card with the given body. */
  function dialog(onClose: () => void, body: HTMLElement): HTMLElement {
    const overlay = el('div', { class: 'overlay' })
    overlay.addEventListener('click', onClose)
    const card = el('div', { class: 'card dialog' })
    // Clicks inside the card must not bubble to the backdrop (which would close the dialog).
    card.addEventListener('click', event => event.stopPropagation())
    card.append(body)
    overlay.append(card)

    return overlay
  }

  /** A dialog header: a title + a muted description line. */
  function dialogHeader(title: string, description: string): HTMLElement {
    const header = el('div', { class: 'dialog__header' })
    header.append(el('h3', { class: 'dialog__title', text: title }))
    header.append(el('p', { class: 'dialog__desc', text: description }))

    return header
  }

  /**
   * One wallet row (used in the "See all" + manage-dialog pickers): avatar (+ installed dot) +
   * name. The `onSelect` lets the manage dialog connect on a specific namespace instead.
   */
  function walletRow(item: WalletListItem, onSelect: (item: WalletListItem) => void): HTMLElement {
    const row = el('button', { class: 'picker__row' })
    row.type = 'button'

    const avatarWrap = el('span', { class: 'picker__avatar' })
    avatarWrap.append(walletAvatar(item, 'picker__icon'))
    if (item.installed) {
      avatarWrap.append(el('span', { class: 'picker__dot' }))
    }
    row.append(avatarWrap)
    row.append(el('span', { class: 'picker__name', text: item.name }))

    row.addEventListener('click', () => onSelect(item))

    return row
  }

  /**
   * The "See all" wallet dialog: a search input + a scrollable, infinite-scrolling list of
   * `walletList.getState().wallets`. Clicking a row runs `selectWallet` (which may open the
   * network-choice dialog). Mirrors the React example's `WalletDialog`. The render loop's
   * picker-state-preservation keeps the search box + scroll position across re-renders.
   */
  function walletDialog(snapshot: PaymentSnapshot): HTMLElement {
    const state = walletList.getState()
    const body = el('div', { class: 'dialog__body' })
    body.append(
      dialogHeader(
        'Select a wallet',
        snapshot.state === 'ConnectingWallet' ? 'Connecting…' : 'Choose a wallet to connect.'
      )
    )

    // Search: debounce ~300ms so each keystroke doesn't fire a WalletGuide fetch. The input is
    // left uncontrolled (we don't re-set its value on re-render) so the caret stays put.
    const search = el('input', { class: 'picker__search' })
    search.type = 'search'
    search.placeholder = 'Search wallets'
    search.addEventListener('input', () => {
      const value = search.value
      if (searchTimer !== undefined) {
        clearTimeout(searchTimer)
      }
      searchTimer = setTimeout(() => void walletList.search(value), 300)
    })
    body.append(search)

    // Scrollable list with infinite scroll: near the bottom, with more to load and no fetch in
    // flight, page in the next batch. (No-op while searching — the controller guards it.)
    const scroll = el('div', { class: 'picker__scroll' })
    scroll.addEventListener('scroll', () => {
      const nearBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 48
      const live = walletList.getState()
      if (nearBottom && live.hasMore && !live.isFetchingWallets) {
        void walletList.loadMore()
      }
    })

    if (state.wallets.length === 0) {
      const note = state.isFetchingWallets || state.isLoading ? 'Loading wallets…' : 'No wallets found.'
      scroll.append(el('p', { class: 'center-note', text: note }))
    } else {
      for (const item of state.wallets) {
        scroll.append(walletRow(item, selectWallet))
      }
      if (state.isFetchingWallets) {
        scroll.append(el('p', { class: 'picker__more', text: 'Loading more…' }))
      }
    }
    body.append(scroll)

    return dialog(() => {
      dialogOpen = false
      rerender()
    }, body)
  }

  /**
   * The "Choose a network" dialog — shown when a multichain extension supports more than one
   * namespace (e.g. MetaMask: Ethereum + Solana). The buyer picks which namespace to connect;
   * we forward it to `controller.connectWallet(wallet, namespace)`. Mirrors the React example.
   */
  function networkDialog(item: WalletListItem): HTMLElement {
    const body = el('div', { class: 'dialog__body' })
    body.append(dialogHeader('Choose a network', `${item.name} supports more than one network.`))

    const list = el('div', { class: 'picker__scroll' })
    for (const namespace of item.namespaces) {
      const row = el('button', { class: 'picker__row' })
      row.type = 'button'
      const badge = el('span', { class: 'picker__avatar picker__avatar--ns' })
      badge.append(icon(WALLET_PATH, 16))
      row.append(badge)
      row.append(el('span', { class: 'picker__name', text: namespaceLabel(namespace) }))
      row.addEventListener('click', () => {
        networkChoice = null
        dialogOpen = false
        controller.connectWallet(item, namespace)
        rerender()
      })
      list.append(row)
    }
    body.append(list)

    return dialog(() => {
      networkChoice = null
      rerender()
    }, body)
  }

  /**
   * The "Wallets" manage hub — a single dialog for multi-namespace connections, mirroring the
   * React example's `ManageWalletsDialog`:
   *
   * - Lists every connected namespace (network label + address) with a per-namespace Disconnect.
   * - Lists the still-unconnected namespaces with a "Connect" action; picking one drills into an
   *   in-dialog wallet picker filtered to wallets that support that namespace (`manageTarget`).
   */
  function manageDialog(): HTMLElement {
    const state = walletList.getState()
    const connectedWallets = state.connectedWallets
    const unconnected = unconnectedNamespaces(connectedWallets, state.supportedNamespaces)
    const body = el('div', { class: 'dialog__body' })

    if (manageTarget) {
      // Drill-in: pick a wallet that supports `manageTarget` to connect on that namespace.
      body.append(
        dialogHeader(
          `Connect ${namespaceLabel(manageTarget)}`,
          'Choose a wallet to connect on this network.'
        )
      )
      const target = manageTarget
      const pickerWallets = state.allWallets.filter(w => w.namespaces.includes(target))
      const list = el('div', { class: 'picker__scroll' })
      if (pickerWallets.length === 0) {
        list.append(el('p', { class: 'center-note', text: 'No wallets available for this network.' }))
      } else {
        for (const w of pickerWallets) {
          list.append(
            walletRow(w, item => {
              manageTarget = null
              walletsOpen = false
              pickedWallet = { name: item.name, icon: item.icon }
              controller.connectWallet(item, target)
              rerender()
            })
          )
        }
      }
      body.append(list)

      const back = el('button', { class: 'button--ghost button--block', text: 'Back' })
      back.type = 'button'
      back.addEventListener('click', () => {
        manageTarget = null
        rerender()
      })
      body.append(back)
    } else {
      body.append(dialogHeader('Wallets', 'Manage connected networks.'))

      const list = el('div', { class: 'wallets' })
      for (const connected of connectedWallets) {
        const row = el('div', { class: 'wallets__row' })
        const meta = el('div', { class: 'wallets__meta' })
        meta.append(el('span', { class: 'wallets__ns', text: namespaceLabel(connected.namespace) }))
        meta.append(el('span', { class: 'wallets__addr', text: shortAddress(connected.caipAddress) }))
        row.append(meta)
        const disconnect = el('button', { class: 'button--outline', text: 'Disconnect' })
        disconnect.type = 'button'
        disconnect.addEventListener('click', () => controller.disconnectWallet(connected.namespace))
        row.append(disconnect)
        list.append(row)
      }
      body.append(list)

      if (unconnected.length > 0) {
        const addWrap = el('div', { class: 'wallets' })
        addWrap.append(el('p', { class: 'dialog__section', text: 'Add a network' }))
        for (const namespace of unconnected) {
          const row = el('div', { class: 'wallets__row wallets__row--dashed' })
          row.append(el('span', { class: 'wallets__ns', text: namespaceLabel(namespace) }))
          const connect = el('button', { class: 'button button--inline', text: 'Connect' })
          connect.type = 'button'
          connect.addEventListener('click', () => {
            manageTarget = namespace
            rerender()
          })
          row.append(connect)
          addWrap.append(row)
        }
        body.append(addWrap)
      }
    }

    return dialog(() => {
      walletsOpen = false
      manageTarget = null
      rerender()
    }, body)
  }

  /** Namespaces the runtime targets but the buyer hasn't connected yet (manage-dialog input). */
  function unconnectedNamespaces(
    connectedWallets: ConnectedWallet[],
    supportedNamespaces: Namespace[]
  ): Namespace[] {
    return supportedNamespaces.filter(ns => !connectedWallets.some(w => w.namespace === ns))
  }

  /** The connected-wallet step header avatar: the picked wallet's logo, or a generic fallback. */
  function connectedAvatar(): HTMLElement {
    const wrap = el('span', { class: 'step__avatar' })
    if (pickedWallet?.icon) {
      const img = el('img', { class: 'step__avatar-img' })
      img.src = pickedWallet.icon
      img.alt = pickedWallet.name ?? ''
      wrap.append(img)
    } else {
      const fallback = el('span', { class: 'step__avatar-img avatar--fallback' })
      fallback.append(icon(WALLET_PATH, 16))
      wrap.append(fallback)
    }

    return wrap
  }

  /** A small outline action button for the connected step header (Disconnect / Wallets). */
  function actionButton(label: string, onClick: () => void): HTMLElement {
    const button = el('button', { class: 'button--outline', text: label })
    button.type = 'button'
    button.addEventListener('click', onClick)

    return button
  }

  function optionsBody(snapshot: PaymentSnapshot): HTMLElement {
    if (snapshot.state === 'LoadingOptions') {
      return el('p', { class: 'center-note', text: 'Finding payment options…' })
    }
    if (snapshot.state === 'NoOptions') {
      return el('p', { class: 'center-note', text: 'No payment options for this wallet.' })
    }

    const list = el('div', { class: 'options' })
    ;(snapshot.options as OptionLike[]).forEach((option, rank) => {
      const button = el('button', { class: 'option' })
      button.type = 'button'
      const symbol = option.amount?.display?.assetSymbol ?? option.id
      const network = option.amount?.display?.networkName
      button.append(el('span', { class: 'option__symbol', text: symbol }))
      button.append(
        el('span', {
          class: 'option__amount',
          text: `${formatAmount(option.amount)}${network ? ` · ${network}` : ''}`
        })
      )
      // Select ONLY — the machine moves to InformationCapture (if required) or
      // OptionSelected; confirmation happens on the Confirm step. (Doing select+confirm
      // together here is what skipped IC and bounced the UI back to the option list.)
      button.addEventListener('click', () => controller.selectOption(option as never, rank))
      list.append(button)
    })

    return list
  }

  function infoCaptureBody(snapshot: PaymentSnapshot): HTMLElement {
    if (snapshot.state !== 'InformationCapture') {
      return el('p', {
        class: 'center-note',
        text: visited.has('InformationCapture') ? 'Details submitted.' : 'Not required for this payment.'
      })
    }

    const fields = (snapshot.collectData as { fields?: CollectFieldLike[] } | undefined)?.fields ?? []
    const form = el('form', { class: 'form' })
    const inputs = new Map<string, HTMLInputElement>()

    for (const field of fields) {
      const isCheckbox = field.type === 'checkbox'
      const row = el('label', { class: `form__row${isCheckbox ? ' form__row--checkbox' : ''}` })
      row.append(document.createTextNode(field.name))
      const input = document.createElement('input')
      input.type = field.type === 'date' ? 'date' : isCheckbox ? 'checkbox' : 'text'
      input.required = field.required
      row.append(input)
      inputs.set(field.id, input)
      form.append(row)
    }

    const submit = el('button', { class: 'button', text: 'Continue' })
    submit.type = 'submit'
    form.append(submit)
    form.addEventListener('submit', event => {
      event.preventDefault()
      const data: Record<string, string | boolean> = {}
      for (const [id, input] of inputs) {
        data[id] = input.type === 'checkbox' ? input.checked : input.value
      }
      controller.submitInfoCapture(data)
    })

    return form
  }

  function confirmBody(snapshot: PaymentSnapshot): HTMLElement {
    const state = snapshot.state

    if (isFailureState(state)) {
      const wrap = el('div', { class: 'center-note' })
      wrap.append(el('p', { text: `Payment ${humanStatus(state).label.toLowerCase()}.` }))
      wrap.append(el('p', { text: 'This payment can’t be completed.' }))

      return wrap
    }

    if (state === 'Succeeded') {
      const payment = snapshot.payment as { amount?: AmountLike } | undefined
      const wrap = el('div', { class: 'success-state' })
      const check = el('span', { class: 'success-state__check' })
      check.append(icon(CHECK, 24))
      wrap.append(check)
      wrap.append(el('p', { text: `Paid ${formatAmount(payment?.amount)}` }))

      return wrap
    }

    if (state === 'WaitingForConfirmation') {
      return el('p', { class: 'center-note', text: 'Submitting payment…' })
    }

    if (state === 'AwaitingWalletApproval') {
      return el('p', { class: 'center-note', text: 'Approve the transaction in your wallet…' })
    }

    // OptionSelected / RequiresApproval → the Confirm CTA.
    const selected = snapshot.selectedOption as OptionLike | undefined
    const wrap = el('div')
    const row = el('div', { class: 'summary__row' })
    row.style.borderTop = '1px solid var(--border)'
    row.append(el('dt', { text: 'Paying' }))
    row.append(el('dd', { text: formatAmount(selected?.amount) }))
    wrap.append(row)

    // A build-type option fetches its wallet-RPC actions after selection; gate Confirm
    // until they're ready (mirrors the React example's buildingActions gate).
    const building = (selected?.actions ?? []).some(a => a.type === 'build')
    const confirm = el('button', {
      class: 'button',
      text: building ? 'Preparing payment…' : snapshot.requiresApproval ? 'Approve & pay' : 'Confirm'
    })
    confirm.type = 'button'
    confirm.disabled = building
    confirm.style.marginTop = '0.75rem'
    confirm.addEventListener('click', () => controller.confirmSelection())
    wrap.append(confirm)

    return wrap
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────

  function summaryCard(snapshot: PaymentSnapshot): HTMLElement {
    const payment = snapshot.payment as
      | { merchant?: { name?: string }; amount?: AmountLike }
      | undefined
    const selected = snapshot.selectedOption as OptionLike | undefined
    const merchant = payment?.merchant?.name ?? 'Merchant'
    const status = humanStatus(snapshot.state)

    const card = el('div', { class: 'card summary' })
    const top = el('div', { class: 'summary__top' })
    top.append(el('span', { class: 'summary__merchant', text: merchant }))
    top.append(el('span', { class: `badge badge--${status.variant}`, text: status.label }))
    card.append(top)
    card.append(el('div', { class: 'summary__amount', text: formatAmount(payment?.amount) }))

    const rows = el('dl', { class: 'summary__rows' })
    const addRow = (key: string, value: string): void => {
      const row = el('div', { class: 'summary__row' })
      row.append(el('dt', { text: key }))
      row.append(el('dd', { text: value }))
      rows.append(row)
    }
    addRow('Pay to', merchant)
    if (payment?.amount?.display?.networkName) {
      addRow('Network', payment.amount.display.networkName)
    }
    if (selected) {
      addRow('Paying with', selected.amount?.display?.assetSymbol ?? '—')
    }
    addRow('Reference', shortId(paymentId))
    card.append(rows)

    return card
  }

  function devPanel(snapshot: PaymentSnapshot): HTMLElement {
    const panel = el('div', { class: 'dev' })
    panel.append(el('p', { class: 'dev__label', text: 'Dev · machine state' }))
    const list = el('ol', { class: 'dev__list' })

    for (const name of DEV_JOURNEY) {
      const active = name === snapshot.state
      const done = visited.has(name) && !active
      const item = el('li', { class: `dev__item${active ? ' dev__item--current' : ''}` })
      const dot = el('span', {
        class: 'dev__dot' + (active ? ' dev__dot--active' : done ? ' dev__dot--done' : '')
      })
      if (done) {
        dot.append(icon(CHECK, 10))
      }
      item.append(dot)
      item.append(el('span', { text: name }))
      list.append(item)
    }
    panel.append(list)

    return panel
  }

  // ── Main render ────────────────────────────────────────────────────────────

  function render(snapshot: PaymentSnapshot): void {
    lastSnapshot = snapshot
    visited.add(snapshot.state)

    const stage = STAGE[snapshot.state] ?? 0
    const isFailure = isFailureState(snapshot.state)

    // Keep the active stage expanded as the flow advances; collapse all on failure.
    if (prevStage !== stage) {
      openStep = isFailure ? -1 : Math.min(stage, 3)
      prevStage = stage
    }

    const connected = snapshot.wallet.isConnected
    const firstAccount = snapshot.wallet.accounts[0]
    const selected = snapshot.selectedOption as OptionLike | undefined
    const selectedSummary = selected
      ? `${selected.amount?.display?.assetSymbol ?? ''} · ${formatAmount(selected.amount)}`.trim()
      : ''

    // Forget the picked wallet once nothing is connected (so the avatar doesn't linger).
    if (!connected) {
      pickedWallet = null
    }
    // Close the wallet dialogs once we've moved past the connect step.
    if (snapshot.state !== 'ReadyForWallet' && snapshot.state !== 'ConnectingWallet') {
      dialogOpen = false
    }

    const steps: Array<{ title: string; subtitle: string; summary: string; body: HTMLElement }> = [
      {
        title: 'Connect your wallet',
        subtitle: 'Connect a wallet to continue.',
        summary: snapshot.wallet.isConnected ? `Connected ${shortAddress(firstAccount)}` : '',
        body: connectBody(snapshot)
      },
      {
        title: 'Choose how to pay',
        subtitle: 'Pick a token to pay with.',
        summary: selectedSummary,
        body: optionsBody(snapshot)
      },
      {
        title: 'A few details',
        subtitle: 'Identity details for this payment.',
        summary: visited.has('InformationCapture') ? 'Details submitted' : 'Not required',
        body: infoCaptureBody(snapshot)
      },
      {
        title: 'Confirm & pay',
        subtitle: 'Approve the transaction in your wallet.',
        summary: snapshot.state === 'Succeeded' ? 'Paid' : '',
        body: confirmBody(snapshot)
      }
    ]

    const layout = el('div', { class: 'layout' })

    // Once connected, the wallet step becomes a static identity row (wallet avatar + a
    // Disconnect / Wallets action), mirroring the React example's `isConnectedWalletCard`.
    const connectedWallets = walletList.getState().connectedWallets
    const supportedNamespaces = walletList.getState().supportedNamespaces
    const unconnected = unconnectedNamespaces(connectedWallets, supportedNamespaces)
    // The manage hub is offered when there's more than one connection to act on (disconnect one
    // of several) or another network to add; otherwise a plain one-click Disconnect.
    const canManageWallets = connectedWallets.length > 1 || unconnected.length > 0

    const stepper = el('div', { class: 'stepper' })
    steps.forEach((s, i) => {
      const status: 'complete' | 'active' | 'locked' = isFailure
        ? i === 3
          ? 'active' // surface the failure message in the final card
          : 'locked'
        : stage > i
          ? 'complete'
          : stage === i
            ? 'active'
            : 'locked'

      const isConnectedWalletCard = i === 0 && connected
      const extras: { avatar?: HTMLElement; rightAction?: HTMLElement; collapsible?: boolean } = {}
      if (isConnectedWalletCard) {
        extras.collapsible = false
        extras.avatar = connectedAvatar()
        // No action once the payment succeeded or the flow died — only mid-flow.
        if (!isFailure && snapshot.state !== 'Succeeded') {
          extras.rightAction = canManageWallets
            ? actionButton('Wallets', () => {
                walletsOpen = true
                rerender()
              })
            : actionButton('Disconnect', () => controller.disconnectWallet())
        }
      }

      stepper.append(stepCard(i, status, s.title, s.subtitle, s.summary, s.body, extras))
    })
    layout.append(stepper)

    const sidebar = el('div', { class: 'sidebar' })
    sidebar.append(summaryCard(snapshot))
    sidebar.append(devPanel(snapshot))
    layout.append(sidebar)

    const root = el('div')
    root.append(layout)

    if (snapshot.signingError) {
      root.append(
        el('p', {
          class: 'error',
          text: `Signing failed (${snapshot.signingError.code}): ${snapshot.signingError.message}`
        })
      )
    }

    // Wallet-connect overlays — mutually exclusive, driven by view-state. The network-choice
    // dialog stacks over the "See all" dialog (you pick a wallet there, then a network).
    if (networkChoice) {
      root.append(networkDialog(networkChoice))
    } else if (dialogOpen) {
      root.append(walletDialog(snapshot))
    }
    if (walletsOpen && connected) {
      root.append(manageDialog())
    }

    // The whole card is rebuilt each render, but list-only changes (search results,
    // pagination, the fetching flag) must not wipe the buyer's in-progress search or scroll
    // position — otherwise typing clears the box mid-search and each loaded page jumps back
    // to the top. Capture the live search value/focus/caret + the list scrollTop from the
    // outgoing DOM, then restore them onto the freshly-built picker after the swap.
    const prevSearch = mount.querySelector<HTMLInputElement>('.picker__search')
    const searchValue = prevSearch?.value
    const searchFocused = prevSearch !== null && document.activeElement === prevSearch
    const caretStart = prevSearch?.selectionStart ?? null
    const caretEnd = prevSearch?.selectionEnd ?? null
    const prevScrollTop = mount.querySelector<HTMLElement>('.picker__scroll')?.scrollTop ?? 0

    mount.replaceChildren(root)

    const nextSearch = mount.querySelector<HTMLInputElement>('.picker__search')
    if (nextSearch && searchValue !== undefined) {
      nextSearch.value = searchValue
      if (searchFocused) {
        nextSearch.focus()
        if (caretStart !== null) {
          nextSearch.setSelectionRange(caretStart, caretEnd)
        }
      }
    }
    const nextScroll = mount.querySelector<HTMLElement>('.picker__scroll')
    if (nextScroll && prevScrollTop > 0) {
      nextScroll.scrollTop = prevScrollTop
    }
  }

  return { render }
}
