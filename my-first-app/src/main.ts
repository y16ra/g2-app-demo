import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// Prefer the SDK phone-side store (setLocalStorage / getLocalStorage).
// Mirror every write to window.localStorage so a host with no bridge, or an
// empty bridge value, can still resume. The higher revision wins if the two
// copies diverge. Simulator 0.9.5 keeps the bridge value for the process
// only; a full restart comes back from localStorage.
const COUNT_STORAGE_KEY = 'count'
const STORAGE_TIMEOUT_MS = 1500

type StoredCount = {
  count: number
  revision: number
}

const bridge = await waitForEvenAppBridge()

let count = 0
let revision = 0
const warned = new Set<string>()
let bridgeWriteChain: Promise<void> = Promise.resolve()

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
  revision += 1
  saveCount({ count, revision })
  renderCount()
  console.log(`[g2demo] count=${count} after ${gesture}`)
}

function renderCount(): void {
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    containerName: 'main',
    content: contentFor(count),
  })).catch((error: unknown) => {
    warnOnce('render', '[g2demo] text update failed', error)
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
  const fromBridge = await readBridgeCount()
  const fromBrowser = readBrowserCount()
  const restored = newerCount(fromBridge, fromBrowser)
  if (!restored) {
    console.log('[g2demo] no stored count; starting at 0')
    return
  }

  count = restored.count
  revision = restored.revision
  const source = restored === fromBridge ? 'bridge' : 'localStorage'
  console.log(`[g2demo] restored count=${count} revision=${revision} from ${source}`)

  if (!sameCount(fromBrowser, restored)) writeBrowserCount(restored)
  if (!sameCount(fromBridge, restored)) writeBridgeCount(restored)
}

function saveCount(stored: StoredCount): void {
  writeBrowserCount(stored)
  writeBridgeCount(stored)
}

function newerCount(fromBridge: StoredCount | null, fromBrowser: StoredCount | null): StoredCount | null {
  if (!fromBridge) return fromBrowser
  if (!fromBrowser) return fromBridge
  return fromBrowser.revision > fromBridge.revision ? fromBrowser : fromBridge
}

function sameCount(left: StoredCount | null, right: StoredCount | null): boolean {
  if (!left || !right) return false
  return left.count === right.count && left.revision === right.revision
}

function parseStoredCount(raw: unknown): StoredCount | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d+):(\d+)$/.exec(raw.trim())
  if (!match) return null
  const storedCount = Number(match[1])
  const storedRevision = Number(match[2])
  if (!Number.isSafeInteger(storedCount) || !Number.isSafeInteger(storedRevision)) return null
  return { count: storedCount, revision: storedRevision }
}

function formatStoredCount(stored: StoredCount): string {
  return `${stored.count}:${stored.revision}`
}

async function readBridgeCount(): Promise<StoredCount | null> {
  try {
    const raw = await withTimeout(bridge.getLocalStorage(COUNT_STORAGE_KEY), STORAGE_TIMEOUT_MS)
    return parseStoredCount(raw)
  } catch (error) {
    warnOnce('bridge-read', '[g2demo] bridge storage read failed', error)
    return null
  }
}

function writeBridgeCount(stored: StoredCount): void {
  const payload = formatStoredCount(stored)
  bridgeWriteChain = bridgeWriteChain.then(async () => {
    try {
      const ok = await withTimeout(
        bridge.setLocalStorage(COUNT_STORAGE_KEY, payload),
        STORAGE_TIMEOUT_MS,
      )
      if (ok !== true) {
        warnOnce('bridge-write', '[g2demo] bridge storage write declined; localStorage fallback is in use')
      }
    } catch (error) {
      warnOnce('bridge-write', '[g2demo] bridge storage write failed; localStorage fallback is in use', error)
    }
  })
}

function readBrowserCount(): StoredCount | null {
  try {
    return parseStoredCount(localStorage.getItem(COUNT_STORAGE_KEY))
  } catch (error) {
    warnOnce('browser-read', '[g2demo] localStorage read failed', error)
    return null
  }
}

function writeBrowserCount(stored: StoredCount): void {
  try {
    localStorage.setItem(COUNT_STORAGE_KEY, formatStoredCount(stored))
  } catch (error) {
    warnOnce('browser-write', '[g2demo] localStorage write failed', error)
  }
}

function warnOnce(key: string, message: string, error?: unknown): void {
  if (warned.has(key)) return
  warned.add(key)
  if (error === undefined) console.warn(message)
  else console.warn(message, error)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`storage timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
