# Feature Spec: Dashboard v2 — Enhanced Diagnostics & Visualizations

**Status:** Draft  
**Author:** kasarevest  
**Created:** 2026-04-02  
**Branch:** develop

---

## 1. Overview

The current Dashboard surfaces a single-pass summary: app counts by publishing state, device compliance counts, and a bar chart. It calls two PS scripts (`Get-IntuneApps.ps1`, `Get-IntuneDevices.ps1`) on load and auto-refreshes every 60 s.

This spec describes Dashboard v2: a multi-panel, visualization-first page that pulls additional Intune data sources to answer the questions an IT admin actually needs at a glance:

- Which OS builds are in the fleet, and are we lagging behind?
- What is the security posture device-by-device?
- Which apps are failing to install, and on how many devices?
- How is device performance trending (User Experience Analytics)?
- What is the Windows Update compliance picture?
- How many enrollments succeeded vs. failed recently?

No new routes are added. The Dashboard page itself is enhanced in place.

---

## 2. Design Decisions

### 2.1 Chart Library

**Choice: Recharts (SVG-based)**

Rationale:
- React-native API (`<BarChart>`, `<PieChart>`, `<LineChart>` — JSX, no imperative canvas)
- SVG output — no canvas permission concerns in Electron sandbox
- Responsive via `<ResponsiveContainer>`
- 180 KB gzipped — acceptable for a desktop Electron app
- No canvas dependency, unlike Chart.js

Alternatives rejected:
- **Chart.js / react-chartjs-2**: canvas-based; adds canvas IPC concern in Electron renderer
- **Victory**: heavier (300 KB+), less maintained
- **Pure CSS** (current): not viable for area charts or donut charts at the required fidelity

### 2.2 Dashboard Layout

Six panels arranged in a responsive grid (`1200 px max-width`):

```
┌─────────────────────────────────────────────────┐
│  [App Inventory v2]    │  [OS Version Distribution] │  Row 1 (2-col)
├─────────────────────────────────────────────────┤
│  [Device Health v2]                              │  Row 2 (full width)
├─────────────────────────────────────────────────┤
│  [Security Posture]    │  [Windows Update Compliance] │  Row 3 (2-col)
├─────────────────────────────────────────────────┤
│  [App Install Health]  │  [UEA Performance Scores]  │  Row 4 (2-col)
├─────────────────────────────────────────────────┤
│  [Enrollment Events]   │  [Alerts & Attention]      │  Row 5 (2-col)
└─────────────────────────────────────────────────┘
```

Panels that require new permissions or beta endpoints are **progressive** — if the PS script returns `{ success: false, permissionError: true }` the panel renders a "Permission required" banner rather than an error card.

### 2.3 Data Loading

Each panel has its own loading state. All PS calls fire in parallel on mount. This avoids a single long-loading spinner blocking the entire page.

```
Promise.allSettled([
  fetchDevices(),        // existing
  fetchApps(),           // existing
  fetchAppInstallStats(), // new
  fetchUEAScores(),      // new
  fetchUpdateStates(),   // new
  fetchAutopilotEvents() // new
])
```

Auto-refresh remains 60 s for all panels simultaneously.

### 2.4 No New Permissions Required for Phase 1–3

The `14d82eec` Microsoft Graph PowerShell client ID is pre-consented in all M365 tenants. The permissions it has include:

- `DeviceManagementManagedDevices.Read.All` — covers devices, windowsProtectionState
- `DeviceManagementApps.Read.All` — covers mobileApps, deviceStatuses
- `DeviceManagementConfiguration.Read.All` — covers deviceConfigurations

**New permissions needed** (admin consent required, Phase 4+):
- `UserExperienceAnalytics.Read.All` — for UEA scores (Phase 4)
- `DeviceManagementServiceConfig.ReadWrite.All` — for Autopilot events (Phase 5)

These panels render a "Grant Permission" alert when the script returns HTTP 403.

---

## 3. New Data Sources

### 3.1 OS Version Distribution (Phase 1)
**Source:** `managedDevices.osVersion` field — already fetched by `Get-IntuneDevices.ps1`  
**Change required:** None to PS script. Aggregation done in Dashboard component.  
**Visualization:** Horizontal bar chart — top 8 OS version strings, grouped by major build bucket (Win 10 22H2, Win 11 22H2, Win 11 23H2, etc.)

### 3.2 Enrollment Type Distribution (Phase 1)
**Source:** `managedDevices.deviceEnrollmentType` and `managedDevices.joinType`  
**Change required:** Add `deviceEnrollmentType,joinType` to `$select` string in `Get-IntuneDevices.ps1`  
**Visualization:** Donut chart — enrollment type segments (windowsAzureADJoin, windowsBulkAzureDomainJoin, windowsAutoEnrollment, etc.)

### 3.3 Security / Defender Posture (Phase 2)
**Source:** `managedDevices.windowsProtectionState` — already fetched but fields only partially used  
**Change required:** Extract additional fields from `windowsProtectionState` in `Get-IntuneDevices.ps1`:
- `malwareProtectionEnabled`
- `realTimeProtectionEnabled`
- `networkInspectionSystemEnabled`
- `quickScanOverdue`
- `fullScanOverdue`
- `signatureUpdateOverdue`
- `rebootRequired`
- `pendingFullScanCount`
- `pendingRebootCount`

**Visualization:** Security posture summary — 4 stat tiles (Real-time protection OFF count, Scan overdue count, Signature overdue count, Reboot pending count) + device-level table with color-coded status column

### 3.4 App Install Health (Phase 3)
**Source:** `/deviceAppManagement/mobileApps/{appId}/deviceStatuses` + `/installSummary`  
**New PS script:** `Get-AppInstallStats.ps1`  
**Visualization:** Table — columns: App Name, Installed, Failed, Pending, Not Applicable, Success %. Rows sorted by failure count desc. Color-coded % column (green ≥ 90%, yellow 70–90%, red < 70%).

### 3.5 Windows Update Compliance (Phase 3)
**Source:** `/deviceManagement/windowsUpdateStates` (beta endpoint)  
**New PS script:** `Get-UpdateStates.ps1`  
**Visualization:** Stacked bar chart — devices per update state (notStarted, pending, inProgress, completed, failed) + count of devices per OS feature update version. Useful for tracking Windows 11 rollout progress.

### 3.6 User Experience Analytics (Phase 4)
**Source:**
- `/deviceManagement/userExperienceAnalyticsOverview`
- `/deviceManagement/userExperienceAnalyticsDeviceScores`
- `/deviceManagement/userExperienceAnalyticsAppHealthApplicationPerformance`

**New PS script:** `Get-UEAScores.ps1`  
**Permission required:** `UserExperienceAnalytics.Read.All`  
**Visualization:**
- Score ring cards — Startup Performance, App Reliability, Battery Health, Work From Anywhere scores (0–100 with color thresholds)
- App health table — crash rate, hang rate per app, mean time to failure

### 3.7 Autopilot Enrollment Events (Phase 5)
**Source:** `/deviceManagement/autopilotEvents`  
**New PS script:** `Get-AutopilotEvents.ps1`  
**Permission required:** `DeviceManagementServiceConfig.ReadWrite.All`  
**Visualization:** Line chart — daily enrollment count (last 30 days) with success/failure series

---

## 4. New PS Scripts

### 4.1 `Get-AppInstallStats.ps1`

```
Inputs:  none (fetches all published Win32 apps then queries each)
Outputs: RESULT:{ success, apps: [{ id, displayName, installed, failed, pending, notApplicable, successPercent }] }
Errors:  403 → { success: false, permissionError: true }
```

Algorithm:
1. Fetch all published `win32LobApp` IDs from `/deviceAppManagement/mobileApps?$filter=isOf('microsoft.graph.win32LobApp')&$select=id,displayName`
2. For each app (up to 50 to avoid long-running PS), call `/deviceAppManagement/mobileApps/{id}/microsoft.graph.win32LobApp/installSummary`
3. Return aggregated result array

**PS 5.1 compat notes:**
- No `?:` ternary
- `$null` guard all nested property accesses
- UTF-8 BOM required

### 4.2 `Get-UpdateStates.ps1`

```
Inputs:  none
Outputs: RESULT:{ success, states: [{ deviceId, deviceName, osVersion, featureUpdateVersion, status }] }
         RESULT:{ success, summary: { notStarted, pending, inProgress, completed, failed } }
Errors:  403 → { success: false, permissionError: true }
```

Endpoint: `https://graph.microsoft.com/beta/deviceManagement/windowsUpdateStates?$top=999`

### 4.3 `Get-UEAScores.ps1`

```
Inputs:  none
Outputs: RESULT:{ success, overview: { startupScore, appReliabilityScore, batteryHealthScore, workFromAnywhereScore },
                  deviceScores: [...], appHealth: [...] }
Errors:  403 → { success: false, permissionError: true }
```

### 4.4 `Get-AutopilotEvents.ps1`

```
Inputs:  none
Outputs: RESULT:{ success, events: [{ id, deviceRegisteredDateTime, enrollmentState, enrollmentFailureDetails }] }
Errors:  403 → { success: false, permissionError: true }
```

---

## 5. IPC Changes

### 5.1 `src/types/ipc.ts` additions

```typescript
// App install health
export interface AppInstallStat {
  id: string
  displayName: string
  installed: number
  failed: number
  pending: number
  notApplicable: number
  successPercent: number
}
export interface AppInstallStatsRes {
  success: boolean
  apps: AppInstallStat[]
  permissionError?: boolean
  error?: string
}

// Windows Update states
export interface UpdateStateSummary {
  notStarted: number
  pending: number
  inProgress: number
  completed: number
  failed: number
}
export interface UpdateStateDevice {
  deviceId: string
  deviceName: string
  osVersion: string
  featureUpdateVersion: string
  status: string
}
export interface UpdateStatesRes {
  success: boolean
  summary: UpdateStateSummary
  states: UpdateStateDevice[]
  permissionError?: boolean
  error?: string
}

// UEA scores
export interface UEAOverview {
  startupScore: number
  appReliabilityScore: number
  batteryHealthScore: number
  workFromAnywhereScore: number
}
export interface UEAAppHealth {
  appName: string
  appPublisher: string
  crashCount: number
  hangCount: number
  crashRate: number
}
export interface UEAScoresRes {
  success: boolean
  overview: UEAOverview | null
  appHealth: UEAAppHealth[]
  permissionError?: boolean
  error?: string
}

// Autopilot events
export interface AutopilotEvent {
  id: string
  deviceRegisteredDateTime: string
  enrollmentState: string
  enrollmentFailureDetails: string | null
}
export interface AutopilotEventsRes {
  success: boolean
  events: AutopilotEvent[]
  permissionError?: boolean
  error?: string
}

// Extended DeviceItem (additions to existing interface)
// Add to DeviceItem:
//   deviceEnrollmentType: string
//   joinType: string
//   malwareProtectionEnabled: boolean
//   realTimeProtectionEnabled: boolean
//   signatureUpdateOverdue: boolean
//   quickScanOverdue: boolean
//   rebootRequired: boolean
```

### 5.2 `src/lib/ipc.ts` additions

```typescript
export const ipcPsGetAppInstallStats = (): Promise<AppInstallStatsRes> =>
  api.invoke('ipc:ps:get-app-install-stats')

export const ipcPsGetUpdateStates = (): Promise<UpdateStatesRes> =>
  api.invoke('ipc:ps:get-update-states')

export const ipcPsGetUEAScores = (): Promise<UEAScoresRes> =>
  api.invoke('ipc:ps:get-uea-scores')

export const ipcPsGetAutopilotEvents = (): Promise<AutopilotEventsRes> =>
  api.invoke('ipc:ps:get-autopilot-events')
```

### 5.3 `electron/ipc/ps-bridge.ts` additions

Four new `ipcMain.handle` registrations following the existing pattern:
- `ipc:ps:get-app-install-stats` → `Get-AppInstallStats.ps1`
- `ipc:ps:get-update-states` → `Get-UpdateStates.ps1`
- `ipc:ps:get-uea-scores` → `Get-UEAScores.ps1`
- `ipc:ps:get-autopilot-events` → `Get-AutopilotEvents.ps1`

---

## 6. Dashboard.tsx Changes

### 6.1 New imports

```typescript
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import {
  ipcPsGetAppInstallStats,
  ipcPsGetUpdateStates,
  ipcPsGetUEAScores,
  ipcPsGetAutopilotEvents,
} from '../lib/ipc'
```

### 6.2 New state

```typescript
const [osDistribution, setOsDistribution] = useState<Array<{ version: string; count: number }>>([])
const [enrollmentTypes, setEnrollmentTypes] = useState<Array<{ name: string; value: number }>>([])
const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null)
const [appInstallStats, setAppInstallStats] = useState<AppInstallStat[]>([])
const [updateStates, setUpdateStates] = useState<UpdateStatesRes | null>(null)
const [ueaScores, setUEAScores] = useState<UEAScoresRes | null>(null)
const [autopilotEvents, setAutopilotEvents] = useState<AutopilotEvent[]>([])

// Per-panel loading/permission states
const [loadingApps, setLoadingApps] = useState(false)
const [loadingDevices, setLoadingDevices] = useState(false)
const [loadingInstallStats, setLoadingInstallStats] = useState(false)
const [loadingUpdateStates, setLoadingUpdateStates] = useState(false)
const [loadingUEA, setLoadingUEA] = useState(false)
const [loadingAutopilot, setLoadingAutopilot] = useState(false)
```

### 6.3 OS Distribution derivation

After `fetchSummary()` processes devices, derive OS distribution in-component (no new PS call):

```typescript
// Group by major OS build bucket
const buckets = new Map<string, number>()
for (const d of devs) {
  const bucket = parseOsBucket(d.osVersion) // e.g. "Windows 11 23H2"
  buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
}
const dist = Array.from(buckets.entries())
  .map(([version, count]) => ({ version, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 8)
setOsDistribution(dist)
```

`parseOsBucket` maps raw osVersion strings like `10.0.22631.4751` → `Windows 11 23H2` using known build number ranges.

### 6.4 Visualization components

#### `OsDistributionChart`
`<ResponsiveContainer height={180}><BarChart horizontal data={osDistribution} ...></BarChart></ResponsiveContainer>`

#### `EnrollmentDonut`
`<PieChart><Pie data={enrollmentTypes} cx="50%" cy="50%" innerRadius={40} outerRadius={70} ...></Pie></PieChart>`

#### `SecurityPosturePanel`
Four `StatCard` tiles showing real-time protection OFF count, scan overdue, signature overdue, reboot pending. Plus a sortable mini-table of top 10 devices needing attention with a color-coded status badge.

#### `AppInstallHealthTable`
Sortable table (by failed count desc). Columns: Name, Installed, Failed, Pending, Success%. Color-code Success% cell: green ≥ 90, amber 70–90, red < 70.

#### `UpdateComplianceChart`
Stacked `<BarChart>` with bars per featureUpdateVersion, colored by status (completed = green, pending = amber, failed = red).

#### `UEAScoreCards`
Four large score rings using SVG arc. Score 0–100, color: green ≥ 70, amber 50–70, red < 50.

#### `EnrollmentTrendChart`
`<LineChart>` — x-axis = date (last 30 days), two series: success and failure. Derived by bucketing `AutopilotEvent.deviceRegisteredDateTime` by calendar day.

---

## 7. Recharts Dependency

```
npm install recharts
npm install --save-dev @types/recharts   # if not bundled
```

Recharts ships its own TypeScript declarations since v2.10. No `@types/recharts` needed.

Verify no Electron-Vite bundling issues with the SVG icon imports in Recharts (known clean — SVG is inlined, not a separate file).

---

## 8. Permission Handling Pattern

Any panel whose PS script returns `{ permissionError: true }` renders:

```tsx
<div style={permissionBannerStyle}>
  <span>Permission required: {permName}</span>
  <span style={{ fontSize: 12, color: 'var(--text-400)' }}>
    Ask your tenant admin to grant consent for this permission.
  </span>
</div>
```

This prevents confusing error messages and guides the admin on what to do.

---

## 9. Phases and Priority

| Phase | Panels | New PS | New Permission | Effort |
|-------|--------|--------|----------------|--------|
| 1 | OS Version Distribution, Enrollment Type Donut | None (derive from existing data) | None | S |
| 2 | Security Posture (Defender fields) | None (extend Get-IntuneDevices.ps1) | None | S |
| 3 | App Install Health, Windows Update Compliance | Get-AppInstallStats.ps1, Get-UpdateStates.ps1 | None | M |
| 4 | UEA Performance Scores | Get-UEAScores.ps1 | UserExperienceAnalytics.Read.All | M |
| 5 | Autopilot Enrollment Events | Get-AutopilotEvents.ps1 | DeviceManagementServiceConfig.ReadWrite.All | M |

Phase 1 and 2 can be shipped without any tenant re-consent. They use data the app already has.

---

## 10. Files to Create / Modify

| File | Action |
|------|--------|
| `IntuneManagerUI/src/pages/Dashboard.tsx` | Major refactor — add 6 new panels, Recharts charts |
| `IntuneManagerUI/src/types/ipc.ts` | Add 5 new response interfaces + DeviceItem extensions |
| `IntuneManagerUI/src/lib/ipc.ts` | Add 4 new IPC wrapper functions |
| `IntuneManagerUI/electron/ipc/ps-bridge.ts` | Add 4 new ipcMain.handle registrations |
| `IntuneManagerUI/electron/ps-scripts/Get-AppInstallStats.ps1` | Create |
| `IntuneManagerUI/electron/ps-scripts/Get-UpdateStates.ps1` | Create |
| `IntuneManagerUI/electron/ps-scripts/Get-UEAScores.ps1` | Create |
| `IntuneManagerUI/electron/ps-scripts/Get-AutopilotEvents.ps1` | Create |
| `IntuneManagerUI/electron/ps-scripts/Get-IntuneDevices.ps1` | Extend $select + extract Defender fields |
| `package.json` | Add `recharts` dependency |

---

## 11. Out of Scope

- Per-device drill-down pages (those belong on `/devices`)
- Real-time streaming / SignalR push (not available from Graph)
- Historical trend storage (Graph has no time-series API; Autopilot events are the only exception)
- PDF/Excel export of dashboard data
