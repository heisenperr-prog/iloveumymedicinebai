# Medibox SCADA dashboard

React + TypeScript + Vite dashboard for a Smart Medicine Reminder Box, with a local Node.js backend adapting the existing `kkk.ino` HTTP API. The dashboard layout and hardware wiring are preserved. The project root is this folder; `.tools` and `node.zip` are not used by the app.

## Run locally

```powershell
npm.cmd install
npm.cmd run backend
```

In a second terminal:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:5173/**. The backend runs at **http://127.0.0.1:3000/**. Node.js 24 is supported; the backend uses native TypeScript stripping and adds no npm dependencies. `npm.cmd` avoids Windows PowerShell script execution restrictions; other shells can use `npm`.

```powershell
npm.cmd run build
npm.cmd run preview
npm.cmd test
npm.cmd run test:ui
```

Browser tests require Microsoft Edge and the running dev server. The Playwright config uses installed Edge, with desktop and mobile viewports. Production output goes to `dist/`.

## Features

- **Dashboard:** device connection, next reminder/countdown, acknowledgment counts, alerts, compartment states, event log, seven-day activity chart.
- **Medicine Schedule:** add/edit/delete/search daily reminders, choose either compartment, change time and notes, and enable/disable reminders. Duplicate enabled times in the same compartment are rejected. Up to 200 schedules.
- **Live Monitoring:** doors, reed switches, servo locks, LEDs, speaker output and events. Demo fault injection and recovery for each reed switch/servo.
- **Alerts:** severity and acknowledgment filters. Reviewing an alert does not acknowledge medicine intake.
- **Medicine History:** medicine search, date/result filters, required/opened compartment and acknowledgment audit trail.
- **Device Control:** confirmed manual door commands, three-second LED/speaker diagnostics and test alerts. Manual commands are logged separately from intake acknowledgment.
- **Settings:** device name/IP, heartbeat refresh interval, acknowledgment timeout and simulated RTC sync.

## Demo workflow

Choose **DEMO MODE** or **REAL DEVICE MODE** in Settings. Switching reloads the app. `.env.local` is configured for real mode and `ESP32_URL=http://10.216.159.229`; `.env.example` defaults to demo. A previously selected mode in browser storage takes precedence. Demo mode runs without a backend. Initial demo medicine names/times and history are illustrative editable seed data; the scheduler reads the current editable schedule store.

1. Create a schedule or select one in the demo simulator.
2. Click **Trigger schedule**. The assigned LED and simulated speaker activate.
3. Open the other compartment to demonstrate a wrong-compartment critical alert, or open the required compartment.
4. Click **Acknowledge intake** to simulate the physical push-button. A healthy reed switch and an open correct compartment are required. The reminder resolves and the door closes.
5. Leave a reminder unresolved to generate a missed-reminder alert after the configurable timeout.
6. Use **Go offline/Reconnect** to demonstrate disconnected telemetry and disabled controls. In Live Monitoring, inject or restore reed/servo faults.

Device outputs and audio are visual simulations. The app does not emit physical audio or contact an ESP32 in demo mode. Schedules, settings, alerts, history and events persist in browser local storage under `medibox-demo-v1`. Physical states reset on reload; unresolved reminders become missed. To restart the sample, remove that key from browser storage and reload. This affects only this app's demo data.

Reminders recur daily using the browser's local timezone while the demo is open. A sleeping tab catches each schedule's most recent missed tick when it resumes; it is not a background medication alarm. For reliable physical reminders, timing must run on the ESP32/backend. An acknowledgment records device interaction and user confirmation, not proof that medicine was swallowed.

## Real ESP32 integration

The existing `DashboardGateway`, `DemoGateway`, services and snapshot subscriptions are reused. `ApiGateway` polls the local backend every second. The backend polls the ESP32 once per 1–2 seconds with non-overlapping requests, an 1.8-second timeout, and automatic reconnection. React never waits synchronously for the device; `/api/snapshot` returns cached state immediately. Vite proxies same-origin `/api` requests to port 3000, avoiding browser-to-device CORS issues. Preview mode uses the same proxy. The backend binds to loopback and only accepts the local frontend origins.

Configuration in `.env.local`:

```dotenv
VITE_DEVICE_MODE=live
VITE_API_BASE_URL=/api
ESP32_URL=http://10.216.159.229
BACKEND_PORT=3000
ESP32_TIMEOUT_MS=1800
```

`ESP32_URL` is server-side and is the sole hardware target; React components contain no device IP. Changing it requires restarting the backend. Changing the backend port also requires restarting Vite. Never put credentials in `VITE_*` variables.

`backend/esp32Service.ts` contains the exact user-confirmed `kkk.ino` schema and all response/command parsing. It also recognizes the smaller legacy status response actually observed on this ESP32 during inspection, while leaving absent sensors Unknown. In real mode no demo schedules, history, outputs or events are loaded. Real records persist separately in `.data/real-device.json`; demo data remains in browser storage.

### Existing ESP32 routes (port 80)

| ESP32 route | Behavior / confirmation |
| --- | --- |
| `GET /api/status` | `time`, `date`, `rtc`, `wifi`, `ip`, `med1`, `med2`, `alarm`, `lastEvent` |
| `GET /api/set?med=1&name=...&hour=...&minute=...` | Edit slot 1; `Schedule saved successfully!` plus matching status readback |
| `GET /api/set?med=2&name=...&hour=...&minute=...` | Edit slot 2; same confirmation |
| `GET /api/test?med=1` | Start complete medicine 1 cycle; `Medicine test started` |
| `GET /api/test?med=2` | Start complete medicine 2 cycle; same confirmation |
| `GET /api/ack` | `Medicine 1 acknowledged` / `Medicine 2 acknowledged`; `No active medicine alert` is **not success** |

The smaller legacy firmware page originally observed uses `/set` instead of `/api/set`; the adapter chooses that path only when the actual response identifies the legacy profile. No second ESP32 server or firmware was created.

In `kkk.ino`, **reed=true means OPEN**, and **reed=false means CLOSED**. The original boolean is preserved without inversion in both backend endpoints and the dashboard snapshot; the real-mode reed row displays `OPEN (true)` or `CLOSED (false)`. The door comes directly from `med1.compartment` / `med2.compartment`; SG90 position is never inferred. Servo, LED and speaker states remain Unknown because the firmware does not report them. Alarm remains the exact firmware flag, not speaker feedback.

`rtc: "ACTIVE"` is preserved in `/api/status` and maps to dashboard `rtcStatus: "synced"`. Time and date are copied directly, including invalid strings. Both the real-mode header and Settings display these unmodified device values. `clockValid` separately controls whether a countdown can be calculated; invalid calendar values never cause a computer-time fallback. Demo mode retains its original computer clock. `Snapshot.firmwareStatus` preserves the exact complete firmware packet, including every medicine field, alarm and lastEvent. `/api/status` includes those original fields alongside backend connection/compartment metadata.

### Local backend routes

| Endpoint (relative to `VITE_API_BASE_URL`) | Method | Contract |
| --- | --- | --- |
| `/snapshot` | GET | Full `Snapshot` JSON matching `src/types/index.ts` and `snapshotSchema` |
| `/status` | GET | Original firmware fields plus backend metadata; `compartment1.reed = med1.reed`, `compartment2.reed = med2.reed`, with true meaning OPEN and false meaning CLOSED |
| `/health` | GET | Backend availability and device connection state |
| `/commands` | POST | `{ "type": "test-medicine", "compartment": 1 }` or `{ "type": "acknowledge-medicine" }` |
| `/medicine/1/test`, `/medicine/2/test` | POST | Translate to the existing ESP32 `/api/test?med=...` |
| `/medicine/ack` | POST | Translate to existing ESP32 `/api/ack` |
| `/schedules` | POST | Create a backend schedule **draft**, without running it on hardware |
| `/schedules/:id` | PUT | Edit a device slot via `/api/set` with readback, or edit a backend draft |
| `/schedules/:id` | DELETE | Delete a backend draft; existing firmware cannot delete an active device slot |
| `/alerts/:id/acknowledge` | POST | Record alert review |
| `/settings` | PUT | `Settings` JSON |

Backend mutations use POST/PUT/DELETE even though the existing firmware uses GET writes. Responses are JSON; failed or unconfirmed commands return a non-2xx error. Commands are **never automatically retried**, since a timed-out request might still have reached the device. The UI shows sending/success/failure, and success requires the documented ESP32 response or an actual status transition. Generic HTML/HTTP 200 is insufficient. After command acceptance the backend reads device status; it never optimistically changes a sensor value.

The current firmware has **no direct open/close, LED-only, speaker-only, or RTC-sync routes**. Existing buttons remain visible but disabled in real mode. Corresponding backend calls return `501` without forwarding invented routes to the ESP32. Use the new medicine-cycle actions in the existing Dashboard, Live Monitoring and Device Control screens. Tests invoke the complete existing firmware cycle; they are not labeled as isolated LED/speaker tests.

### Schedules, acknowledgment and audit records

The ESP32 owns scheduling, RTC, actuator timing and Preferences storage. Its two slots are imported into the unchanged Medicine Schedule UI. Name/time edits go to the existing route and require matching readback. Current firmware cannot add more slots, delete/disable an active slot or move its compartment. Those actions fail explicitly for physical slots. Additional backend drafts support add/edit/delete/enable/disable/compartment/time editing, are labeled **not synchronized**, and never count as real pending reminders or run a second scheduler.

Firmware `DUE` creates an observed pending record; `DUE`/`WAITING` → `TAKEN` creates **Medicine intake acknowledged** and history. Dashboard acknowledgments use the exact `/api/ack` response. A cleared due flag is not treated as proof of acknowledgment. Initial or reconnecting `TAKEN` state is not fabricated into a new button press. Door transitions can generate wrong-compartment/unexpected-opening alerts only when firmware due state is available. State timestamps are backend receipt times unless a firmware event supplies a timestamp. Repeated `lastEvent` strings are not duplicated; short changes between polls and outages can be missed because this firmware has no durable event IDs/history.

### Test locally and on hardware

1. Run `npm.cmd run backend` and `npm.cmd run dev`; open the dashboard in Real Device Mode.
2. Run `curl.exe http://127.0.0.1:3000/api/status`, then `curl.exe http://127.0.0.1:5173/api/status` to check the proxy. `online` is true only after successful, validated ESP32 status.
3. Check `curl.exe http://10.216.159.229/api/status` directly if offline. Ensure this computer is still on the same Wi-Fi and the ESP32 still has that address.
4. When online with the `kkk` profile, use **Test medicine 1**, check real DUE/door/reed/alarm/lastEvent, then **Acknowledge active medicine**. Repeat with medicine 2. This operates the physical medicine cycle.
5. Edit a physical slot's name/time, save, and confirm the actual firmware value in a new `/api/status` response.
6. Disconnect/reconnect ESP32 Wi-Fi. Verify OFFLINE, preserved last-seen, disabled real actions, automatic ONLINE recovery and connection events.
7. Run `npm.cmd test`, `npm.cmd run test:ui`, and `npm.cmd run build`. Automated adapter and browser tests use explicitly isolated fixtures, not fabricated live backend data.

At implementation-time verification on October 8, 2026, the ESP32 initially returned HTTP 200 with the smaller legacy payload, then subsequent status requests timed out. The local backend and frontend proxy responded correctly with OFFLINE. Physical command success and reconnection were therefore **not verified**; passing fixture tests do not prove hardware operation. No unsupported actuator command was sent.

To expose direct controls, more schedule slots/enable/delete, explicit LED/playback state, or durable event history later, the main `kkk.ino` and its included source files are needed. Keep all existing GPIO assignments and the existing ESP32 WebServer. No firmware upload or wiring changes have been performed by this project. This local prototype has no sign-in; the displayed administrator is a local profile.

## Structure

`src/pages/` contains the seven screens; `src/components/` reusable panels, dialogs, badges, charts and telemetry; `src/hooks/` subscriptions and action feedback; `src/services/` adapters and validation; `src/data/seed.ts` editable sample data; `src/styles.css` responsive SCADA theme with Tailwind utilities. Tests cover controller behavior plus desktop/mobile page navigation, schedule persistence and the reminder workflow.

## Integration files changed

- Added `backend/server.ts`, `backend/controller.ts`, `backend/esp32Service.ts`, their three test files, and test-only `backend/testFixtures.ts`.
- Added `src/components/RealDeviceControls.tsx`; updated `CompartmentCard.tsx`, `ActivityChart.tsx`, and `HistoryTable.tsx`.
- Updated `src/services/index.ts`, `apiGateway.ts`, `apiGateway.test.ts`, `validation.ts`, and `demoGateway.ts` to retain the existing gateway architecture and demo compatibility.
- Updated `src/types/index.ts`, `src/utils/time.ts`, `src/hooks/useAction.ts`, `src/hooks/useDashboard.ts`, `src/App.tsx`, and `src/layouts/AppLayout.tsx`.
- Updated the existing `Dashboard`, `Control`, `Monitoring`, `Settings`, `Schedules`, and `History` pages without replacing their layouts.
- Added `tests/real-device.spec.ts` and the read-only `tests/connection.spec.ts`; updated `tests/dashboard.spec.ts` to select isolated demo mode explicitly.
- Added `.env.local`; updated `.env.example`, `.gitignore`, `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, and this README. No dependency additions were needed.

The initial integration validation above preceded the mapping correction described below.

## Data mapping correction and verification

Only backend/dashboard mapping was changed. No ESP32 code, GPIO, wiring, firmware route or hardware-action behavior was changed. Polling remains configured at 1000 ms.

Files changed for this correction:

- `backend/esp32Service.ts`, `backend/controller.ts`, `backend/server.ts`
- `src/types/index.ts`, `src/services/validation.ts`
- `src/components/CompartmentCard.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Settings.tsx`, `src/layouts/AppLayout.tsx`
- `backend/esp32Service.test.ts`, `backend/server.test.ts`, `tests/real-device.spec.ts`, `tests/connection.spec.ts`
- `scripts/verify-read-only-mapping.mjs` and this README

Verification passed: 50 service/API/demo tests; production build; 17 desktop/mobile browser checks (one desktop skip for a mobile-only test). Read-only live comparison found an **exact match for all original fields** between the ESP32 and backend, including time/date and both medicine objects. The sampled device itself reported `time: "45:161:00"`, `date: "2000-06-10"`, and `rtc: "ACTIVE"`; those literal strings were preserved, `rtcStatus` was `synced`, and `clockValid` was false. Both real compartments were OPEN with reed=true. The closed/false case was verified using isolated backend and browser fixtures. No hardware write or command was sent during mapping verification.

Repeat the read-only source/backend comparison with both servers running:

```powershell
node --env-file=.env.local scripts/verify-read-only-mapping.mjs
```

The verifier compares current ESP32 data to backend data, retries adjacent clock samples, checks snapshot mapping and unknown outputs, and fails if it cannot obtain a matching live packet. Its result is not a claim that hardware actions or RTC accuracy were tested.
