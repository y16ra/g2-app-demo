# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This is a demo/practice repository for Even Hub G2 smart-glasses apps. It currently contains a single app, `my-first-app/`, built with Vite (vanilla-ts) and `@evenrealities/even_hub_sdk`. Additional apps may be added as sibling directories over time.

## Commands (run from `my-first-app/`)

```bash
npm install                 # install dependencies
npm run dev                 # start Vite dev server (http://localhost:5173)
npm run build                # tsc typecheck + vite build
npx tsc --noEmit             # typecheck only, no test suite exists yet
```

### Testing with the simulator

```bash
npm install -g @evenrealities/evenhub-simulator
evenhub-simulator -g http://localhost:5173
```

`evenhub-simulator` 0.9.5 takes the page URL as a positional argument (`evenhub-simulator http://localhost:5173 --automation-port 9898`). In that version `-g` / `--glow` is a display flag. The `-g <url>` form above is the 0.7.x CLI this repo was first verified with.

Opening `localhost:5173` in a plain browser and clicking does **not** trigger app logic — the SDK's `onEvenHubEvent` only receives events forwarded through the Even Hub bridge (simulator or real hardware), not raw DOM clicks. Always use the simulator (or real glasses) to exercise input handling.

For scripted/automated testing, launch with `--automation-port <PORT>` to expose an HTTP API (`POST /api/input` to send click/double_click/up/down, `GET /api/console` to read the webview's console log, `GET /api/screenshot/glasses` for the rendered framebuffer). This is the reliable way to inspect what event shape the simulator actually sends, since the app's own console.log cannot be observed directly from a GUI window.

## Architecture

- `app.json` — Even Hub manifest (package id, permissions, SDK/app version constraints). Required for packaging; not present in a stock Vite scaffold.
- `src/main.ts` — entire app logic. The pattern: await `waitForEvenAppBridge()`, restore the counter, build a `TextContainerProperty` (or other container types) and render it via `bridge.createStartUpPageContainer(...)`, then subscribe once via `bridge.onEvenHubEvent(...)` and route by inspecting which payload key is present on the event (`event.textEvent` / `event.listEvent` / `event.sysEvent` / `event.audioEvent`).
- Counter gestures: tap or swipe up (`OsEventTypeList.SCROLL_TOP_EVENT`) increments, swipe down (`OsEventTypeList.SCROLL_BOTTOM_EVENT`) decrements and clamps at 0, double-tap exits. The count is stored with `bridge.setLocalStorage` / `getLocalStorage` (SDK phone-side storage, no extra permission) and mirrored to `window.localStorage`. A revision picks the newer copy if they diverge. If both are unavailable the session still counts from 0. Simulator 0.9.5 keeps the bridge value for the process lifetime; a full process restart resumes from `localStorage`.
- Everything outside `app.json` is a standard Vite project (`index.html`, `tsconfig.json`, `public/`) — Even Hub-specific surface area is intentionally small.

### Known SDK/simulator quirk

The official quickstart docs assume taps on a container arrive as `event.textEvent` (carries `containerID`). In practice, `evenhub-simulator` v0.7.1 delivers taps on a full-screen container on the root/StartUp page as `event.sysEvent` instead (no `containerID`, only `eventType`). Code in this repo should check `event.textEvent ?? event.sysEvent` rather than assuming `textEvent` alone, or clicks will silently no-op. This was diagnosed via the automation HTTP API's `/api/console`, not by reading the (minified) SDK source.

Swipes do arrive as `textEvent` (`containerID` 1). In `@evenrealities/even_hub_sdk` 0.0.12, `OsEventTypeList.SCROLL_TOP_EVENT` is `1` (swipe up) and `SCROLL_BOTTOM_EVENT` is `2` (swipe down), matching the hardware logs. Compare against those constants, not raw numbers. The SDK also omits `eventType` when the value is `0` (`CLICK_EVENT`); treat a missing `eventType` as a tap.
