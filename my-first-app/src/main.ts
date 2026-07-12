import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// Wait for the bridge to be ready before doing anything else.
// In the simulator this resolves immediately; on hardware it waits
// for the WebView to initialize the SDK bridge.
const bridge = await waitForEvenAppBridge()

// Build a single text container that fills the visible canvas (576×288).
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
  content: 'Hello from G2!\n\nTap to count: 0\nDouble-tap to exit',
  isEventCapture: 1,           // ← receive click events on this container
})

// Render the page. `result` is 0 on success.
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

if (result !== 0) {
  console.error('createStartUpPageContainer failed:', result)
  // 1 = invalid params, 2 = oversize, 3 = out of memory
}

// Single event subscription - all OS events arrive through onEvenHubEvent.
// Inspect event.textEvent / event.listEvent / event.sysEvent to route by source.
//
// On the root/start-up page, taps on the full-screen container arrive as
// `sysEvent` (no containerID) rather than `textEvent` - confirmed against
// evenhub-simulator v0.7.1 via its automation console log, which never
// emitted a textEvent for click/double_click on this page.
let count = 0

bridge.onEvenHubEvent((event) => {
  const source = event.textEvent ?? event.sysEvent
  if (!source) return
  if (event.textEvent && event.textEvent.containerID !== 1) return

  switch (source.eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined: // SDK normalizes 0 to undefined in some cases
      count += 1
      bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'main',
        content: `Hello from G2!\n\nTap to count: ${count}\nDouble-tap to exit`,
      }))
      break

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Mode 1 shows the system exit-confirmation dialog -
      // required on the root page; silent exit (mode 0) is rejected in QA.
      bridge.shutDownPageContainer(1)
      break
  }
})
