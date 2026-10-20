import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// Bridge local storage is the source of truth after a read succeeds.
// A timeout or rejection is not an empty key: resume from localStorage and
// do not write the bridge, so an unread value cannot be overwritten.
// Writes are not timed out. One write is in flight; a newer count replaces
// anything still queued, so a slow write cannot land after a newer one.
const COUNT_KEY = 'count'
const BRIDGE_READ_TIMEOUT_MS = 1500

type BridgeRead =
  | { ok: true; count: number | null }
  | { ok: false }

const bridge = await waitForEvenAppBridge()

let count = 0
let bridgeReady = false
let pendingBridgeCount: number | null = null
let bridgeWrite: Promise<void> = Promise.resolve()

await restoreCount()

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: contentFor(count),
  isEventCapture: 1, // receive click and swipe events on this container
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

if (result !== 0) {
  // 1 = invalid params, 2 = oversize, 3 = out of memory
  throw new Error(`createStartUpPageContainer failed with code ${result}`)
}

// Single event subscription — all OS events arrive through onEvenHubEvent.
//
// On the root/start-up page, click/double-click on the full-screen container
// arrive as `sysEvent` (no containerID) rather than `textEvent` — confirmed
// on both evenhub-simulator v0.7.1 and real G2 hardware. Swipes arrive as
// `textEvent` with containerID set. OsEventTypeList in SDK 0.0.12 maps those
// swipes to SCROLL_TOP_EVENT (1, swipe up) and SCROLL_BOTTOM_EVENT (2, swipe down).
bridge.onEvenHubEvent((event) => {
  const source = event.textEvent ?? event.sysEvent
  if (!source) return
  if (event.textEvent && event.textEvent.containerID !== 1) return
  handleGesture(source.eventType)
})

function contentFor(value: number): string {
  return `Hello from G2!\n\nCount: ${value}\nTap or swipe up +1\nSwipe down -1\nDouble-tap to exit`
}

// Swipe down undoes one step. The number is a tally, so it stops at 0
// instead of going negative.
function applyDelta(delta: 1 | -1, gesture: 'tap' | 'swipe-up' | 'swipe-down'): void {
  const next = Math.max(0, count + delta)
  if (next === count) {
    console.log(`[g2demo] count=${count} unchanged after ${gesture}`)
    return
  }

  count = next
  saveCount(count)
  renderCount()
  console.log(`[g2demo] count=${count} after ${gesture}`)
}

function renderCount(): void {
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    containerName: 'main',
    content: contentFor(count),
  })).catch((error: unknown) => {
    console.warn('[g2demo] text update failed', error)
  })
}

function handleGesture(eventType: OsEventTypeList | undefined): void {
  // The SDK omits eventType when the numeric value is 0 (CLICK_EVENT).
  if (eventType == null) {
    applyDelta(1, 'tap')
    return
  }

  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      applyDelta(1, 'tap')
      break
    case OsEventTypeList.SCROLL_TOP_EVENT:
      applyDelta(1, 'swipe-up')
      break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      applyDelta(-1, 'swipe-down')
      break
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Mode 1 shows the system exit-confirmation dialog —
      // required on the root page; silent exit (mode 0) is rejected in QA.
      console.log('[g2demo] double-tap exit')
      bridge.shutDownPageContainer(1)
      break
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.IMU_DATA_REPORT:
      break
    default: {
      const unexpected: never = eventType
      void unexpected
    }
  }
}

async function restoreCount(): Promise<void> {
  const bridgeRead = await readBridgeCount()
  if (!bridgeRead.ok) {
    count = readBrowserCount() ?? 0
    console.log(`[g2demo] bridge read failed; count=${count} from localStorage, bridge left untouched`)
    return
  }

  bridgeReady = true
  if (bridgeRead.count !== null) {
    count = bridgeRead.count
    writeBrowserCount(count)
    console.log(`[g2demo] restored count=${count} from bridge`)
    return
  }

  const saved = readBrowserCount()
  if (saved === null) {
    console.log('[g2demo] no stored count; starting at 0')
    return
  }

  // The read succeeded and the key was empty, so this does not replace an unread value.
  count = saved
  console.log(`[g2demo] restored count=${count} from localStorage`)
  saveCount(count)
}

function saveCount(value: number): void {
  writeBrowserCount(value)
  if (!bridgeReady) return
  pendingBridgeCount = value
  bridgeWrite = bridgeWrite.then(flushBridgeCount)
}

async function flushBridgeCount(): Promise<void> {
  while (pendingBridgeCount !== null) {
    const value = pendingBridgeCount
    pendingBridgeCount = null
    try {
      const ok = await bridge.setLocalStorage(COUNT_KEY, String(value))
      if (ok !== true) console.warn('[g2demo] bridge storage write declined')
    } catch (error) {
      console.warn('[g2demo] bridge storage write failed', error)
    }
  }
}

async function readBridgeCount(): Promise<BridgeRead> {
  try {
    const raw = await withTimeout(bridge.getLocalStorage(COUNT_KEY), BRIDGE_READ_TIMEOUT_MS)
    if (typeof raw !== 'string') {
      console.warn('[g2demo] bridge storage read failed', raw)
      return { ok: false }
    }
    return { ok: true, count: parseCount(raw) }
  } catch (error) {
    console.warn('[g2demo] bridge storage read failed', error)
    return { ok: false }
  }
}

function parseCount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

function readBrowserCount(): number | null {
  try {
    const raw = localStorage.getItem(COUNT_KEY)
    return raw === null ? null : parseCount(raw)
  } catch (error) {
    console.warn('[g2demo] localStorage read failed', error)
    return null
  }
}

function writeBrowserCount(value: number): void {
  try {
    localStorage.setItem(COUNT_KEY, String(value))
  } catch (error) {
    console.warn('[g2demo] localStorage write failed', error)
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`storage read timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
