# IntuneManagerUI — Multi-Viewpoint Peer Review

**Date:** 2026-03-30
**Scope:** IntuneManagerUI (Electron + React + TypeScript) — complete codebase review
**Reviewer perspectives:** (1) Endpoint Admin, (2) Senior Systems Developer, (3) Security Engineer, (4) UI/UX Developer

---

## Viewpoint 1 — Endpoint Administrator

*How does the system behave from the perspective of a Vestmark IT admin who deploys apps to Intune?*

### Strengths

**The packaging + deploy split is exactly right.**
After clicking Deploy on an app card, the system packages the `.intunewin` first and only then asks "Do you want to deploy to Intune?" This two-step design lets an admin review what was created before it lands in production. No other free tool does this.

**Update detection works without manual effort.**
On the Dashboard, each app shows a "Latest Available" column populated from winget. If the Intune version is behind, an amber "Update" button appears. The admin doesn't have to manually look up versions — the system does it reactively as the catalog loads.

**"Update All" handles batch work.**
The Update All button queues all outdated apps and runs them sequentially with a progress badge ("2 of 5: Google Chrome"). This is a significant time-saver compared to doing each app individually.

**Silent refresh means the admin rarely sees a login screen.**
Connect-Tenant.ps1 tries `Get-CachedToken` (MSAL silent refresh via refresh token) before triggering a browser popup. In practice, an admin connected yesterday will reconnect silently today.

### Issues Found

**CRITICAL (Workflow) — There is no way to deploy to an *assignment group* from the UI.**
The system creates the Intune app record and uploads the package, but it does not assign the app to any AAD group. An admin must go into the Intune portal after every deployment to manually add assignments. This is the most common post-deployment step and its absence makes the tool feel incomplete.
- Recommendation: Add an "Assignments" step to the wizard or upload-only flow. At minimum, document this gap prominently in the UI.

**MAJOR (Usability) — Errors from Claude's packaging pipeline surface as raw log entries.**
When the AI tool fails (e.g. download URL wrong, SHA256 mismatch), the error appears in the log panel as a technical message. An admin who doesn't read PowerShell logs will not know what happened or what to do next.
- Recommendation: Parse terminal errors from the log (lines containing `FATAL:` or `ERROR`) and display a plain-English summary above the log panel.

**MAJOR (Usability) — After "Update All" finishes, the user is left on the Deploy page with no path back.**
The completion message says "All N updates deployed!" but the only navigation options are "New Deployment" and "Dashboard". If any app failed mid-queue, there is no summary of which apps succeeded and which failed.
- Recommendation: Add a post-queue summary card listing each app with its result (success/failed/skipped).

**MINOR — The "checking..." spinner appears for apps that will never have a winget ID (e.g. internal LOB apps).**
The system sets `versionChecking: true` for every app on load, then resolves it to false once it determines there's no PACKAGE_SETTINGS.md match. For a catalog with 111 apps, many rows flash "checking..." for several seconds before settling to "—".
- Recommendation: Consider pre-filtering apps that have no local source folder before initiating winget calls.

**MINOR — Settings → Paths requires absolute paths.**
The paths for IntuneWinAppUtil, Source Root, and Output Folder must be absolute. There is no in-app validation — if the admin enters a relative path or a path that doesn't exist, the error surfaces later during a build job.
- Recommendation: Validate paths when the user leaves the field (or on Save) and show a green checkmark or red warning inline.

**INFO — No "test detection" capability.**
After deploying an app, there is no way to verify that the detection script would pass on a test machine from inside the tool. The admin must use Intune portal or manually run the script.

---

## Viewpoint 2 — Senior Systems Developer

*Code architecture, patterns, correctness, maintainability, and technical debt.*

### Strengths

**The IPC architecture is clean and type-safe.**
Every channel has a typed wrapper in `src/lib/ipc.ts`, a matching interface in `src/types/ipc.ts`, and a handler in `electron/ipc/`. The discipline of keeping these three layers in sync is good engineering.

**The three-tier pipeline separation is correct and principled.**
`runDeployJob` (12 steps) / `runPackageOnlyJob` (10 steps) / `runUploadOnlyJob` (2 steps) are separate functions with separate system prompts and tool lists. This prevents the upload-only path from accidentally re-running packaging.

**`packageResultRef` race condition fix is the correct solution.**
Using `useRef` for cross-event data handoff between `onJobPackageComplete` and `onJobComplete` is the right choice. `setState` is async-by-contract; refs are synchronous. The pattern is documented in Lesson 005 and should be applied consistently anywhere two near-simultaneous IPC events hand off data.

**Two-phase catalog loading respects UI responsiveness.**
Phase 1 renders Intune apps immediately. Phase 2 runs concurrent winget lookups and updates rows reactively. This is correct — users should never wait for secondary enrichment data before seeing their primary dataset.

**Module-level recommendation cache survives page remounts.**
`let cachedRecommendations: AppRecommendation[] | null = null` outside the hook is the right scope for session-level cache that shouldn't be tied to component lifecycle.

### Issues Found

**BLOCKING — `runPsScript` does not have a timeout.**
In `electron/ipc/ps-bridge.ts`, if a PowerShell script hangs (network issue, modal dialog, UAC prompt), the IPC call never resolves. The job will stay in "running" state indefinitely. There is no upper bound.
- Recommendation: Add a configurable per-script timeout (default 300s for downloads, 60s for queries) using `setTimeout` + `child.kill()`. Emit `job:error` on timeout.

**BLOCKING — `runDeployJob` and `runPackageOnlyJob` have a 20-iteration cap but no recovery.**
If Claude uses all 20 iterations without completing (e.g. due to a persistent tool error), the job throws `'Maximum tool iterations reached (20). Deployment may be incomplete.'`. The `.intunewin` may or may not have been built. The partial state (downloaded files, written scripts) is left on disk with no cleanup.
- Recommendation: Log the final Claude message before throwing, so the admin knows where the job stopped. Consider a "resume from checkpoint" pattern.

**MAJOR — `executeToolCall`'s `generate_install_script` writes to `sourceFolder` from Claude's input without path validation.**
Claude provides `source_folder` in its tool call. This value is written directly via `fs.writeFileSync` without verifying that it resolves within the configured `sourceRoot`. A malformed or adversarially crafted response from Claude could write files outside the intended directory.
- Recommendation: Validate that `path.resolve(sourceFolder).startsWith(path.resolve(sourceRoot))` before any `fs.writeFileSync`.

**MAJOR — The `activeJobs` Map is module-level and never cleaned up on app restart.**
On app restart the map is empty but the DB's `app_deployments` table may still have rows with `status = 'running'`. On next launch these will show incorrectly.
- Recommendation: On app startup, run `UPDATE app_deployments SET status = 'failed', error_message = 'App restarted while job was running' WHERE status IN ('running', 'pending')`.

**MAJOR — `app_deployments` table is never written to by the AI agent.**
The schema has `app_deployments` with full deployment tracking (job_id, app_name, status, performed_by, etc.) but `ai-agent.ts` never inserts or updates this table. All deployment history is lost when the log panel is cleared.
- Recommendation: Insert a row when a job starts and update it on complete/error. This enables audit history and restart recovery.

**MAJOR — `compareVersions` silently returns `'unknown'` for non-semver versions.**
Apps with date-based versions (e.g. `20241201.1`) or build-stamp versions (e.g. `1.0.0.12345-beta`) will return `'unknown'` and never show an "Update Available" badge, even when they are genuinely outdated.
- Recommendation: Improve the comparison to handle common non-semver patterns. At minimum, log a warning so the admin knows a version comparison failed.

**MINOR — `useAppCatalog` fires N concurrent winget calls.**
With 111 apps, `Promise.all` will spawn 111 concurrent `ipcPsGetPackageSettings` calls, then up to 111 `ipcPsGetLatestVersion` calls. Each of these spawns a new `powershell.exe` process. On lower-spec machines this can cause resource exhaustion.
- Recommendation: Use a concurrency limiter (e.g. 5 concurrent at a time using a semaphore pattern).

**MINOR — `preload.ts` exposes all IPC channels with no whitelist.**
The `api.invoke(channel, data)` and `api.on(channel, callback)` wrappers accept any channel string. A renderer-side script (or XSS) could invoke any registered IPC handler by name without restriction.
- Recommendation: Add a channel allowlist to `preload.ts`: only channels defined in a static array should be passable to `ipcRenderer.invoke` and `ipcRenderer.on`.

**MINOR — Session token stored in `sessionStorage` only.**
`sessionStorage` is cleared when the Electron window is closed. On every app restart the user must re-enter their username and password. This is by design for security, but it is undocumented and may confuse admins who expect persistent sessions.
- Recommendation: Document this behavior explicitly on the login screen ("Session ends when window closes").

**MINOR — `DevTools` auto-opened in dev mode via `window.webContents.openDevTools()`.**
This is fine for development. Verify `electron-builder.yml` sets `asar: true` and does not ship the dev server URL in production.

**INFO — No TypeScript strict null checks on PS bridge result parsing.**
Many handlers do `result.result ?? { success: false }` without asserting the type. If a PS script returns malformed JSON, `result.result` could be any shape. Consider Zod or similar runtime validation on PS output.

---

## Viewpoint 3 — Security Engineer

*Authentication, authorization, data protection, attack surface, and compliance.*

### Strengths

**Electron security defaults are correctly set.**
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in the `BrowserWindow` options is the correct hardened configuration. `contextBridge` is used for all renderer ↔ main communication.

**Claude API key is encrypted at rest.**
The key is stored as AES-256-CBC ciphertext using a machine-derived key (SHA256 of Windows `MachineGuid`). It is never stored in plaintext in `app_settings`.

**MSAL token cache is DPAPI-protected.**
The `IntuneManager\Lib\Auth.psm1` uses `ProtectedData` (DPAPI `CurrentUser` scope) to encrypt the token cache blob. Tokens are not accessible to other users on the same machine.

**bcrypt cost factor 12 for password hashing.**
This is a defensible choice for an internal tool. OWASP recommends cost 10–12 for interactive logins; 12 is appropriate.

**HTTPS enforced for all Graph API calls.**
The PS modules use `Invoke-RestMethod` which defaults to HTTPS. No HTTP fallback exists.

### Issues Found

**CRITICAL — The machine-key encryption for the Claude API key is tied to `MachineGuid`.**
`MachineGuid` is readable by any process running as the current user (`HKLM\SOFTWARE\Microsoft\Cryptography`). An attacker who gains user-level code execution can derive the same key and decrypt the stored API key. This is equivalent to "light obfuscation" rather than strong encryption.
- Recommendation: Use Windows DPAPI (`ProtectedData.Protect` with `CurrentUser` scope) for API key storage, the same mechanism used for MSAL tokens. This ties the key to the user's Windows credentials rather than a static registry value.

**CRITICAL — No channel whitelist in `preload.ts`.**
Any string can be passed to `api.invoke(channel)` and `api.on(channel)`. If the renderer is ever compromised (XSS via a malicious `winget.exe` output, or prototype pollution), an attacker can invoke any IPC handler — including `ipc:auth:create-user`, `ipc:settings:save`, or `ipc:ai:deploy-app`.
- Recommendation: Define a static `ALLOWED_CHANNELS` array in preload.ts and throw if an unlisted channel is requested.

**MAJOR — Claude tool input (`source_folder`, `output_path`) is used in `fs.writeFileSync` without path validation.**
Claude's responses are passed directly to `executeToolCall`. If Claude's model output is manipulated (prompt injection via a malicious winget search result) or if the model produces an unexpected path, files could be written outside the intended directories.
- Recommendation: Validate all file system paths from tool inputs against the configured `sourceRoot` and `outputFolder` before any disk write or read.

**MAJOR — PowerShell scripts are spawned without argument escaping validation.**
`runPsScript` builds an args array and calls `spawn('powershell.exe', ['-File', scriptPath, ...args])`. If any `arg` contains PowerShell special characters (e.g. backtick, semicolon, ampersand derived from Claude's tool input), they could be interpreted as code in some PS call patterns.
- Recommendation: Validate that AI-generated string arguments (app names, install commands, paths) contain no shell metacharacters before passing them to PS scripts. For `install_command_line` and `uninstall_command_line` specifically, reject backtick characters as noted in the risk assessment.

**MAJOR — `ipc:auth:create-user` requires only a valid session token, not `superadmin` role.**
Looking at `auth.ts`, the `create-user` handler checks `sessionToken` but the role check (`superadmin`) may not be enforced for all admin operations. If a viewer-role user escalates their session token, they may be able to create new users.
- Recommendation: Verify that every user-management IPC handler performs an explicit role check (not just session validity) before executing privileged operations.

**MAJOR — `download_app` tool accepts any HTTPS URL from Claude.**
Claude resolves the download URL from winget/chocolatey manifest data. If a manifest entry is compromised or if Claude produces an incorrect URL, the tool will download and execute an untrusted installer.
- Recommendation: Validate that the download URL's hostname matches a known-good list (e.g. `*.microsoft.com`, `*.github.com`, `github.com`, `*.7-zip.org`). This is a defense-in-depth measure, not a full solution, but it reduces the blast radius of a bad URL.

**MINOR — `app.getPath('userData')` for the SQLite database is in `%AppData%\Roaming`.**
This is the correct location for user-scoped data on Windows. However, `%AppData%\Roaming` is sometimes redirected to a network share in managed enterprise environments. The database contains session tokens and tenant config. If the network share is compromised, so is this data.
- Recommendation: Document the database location and consider offering a setting to override it to a local path.

**MINOR — Sessions are not invalidated on password change.**
If an admin changes a user's password (`ipc:auth:change-password`), existing sessions for that user in the `sessions` table are not deleted. A compromised session remains valid until it naturally expires (8 hours).
- Recommendation: `DELETE FROM sessions WHERE user_id = ?` on successful password change.

**MINOR — `tokenExpiry` is not stored in the `tenant_config` table.** *(RESOLVED 2026-03-31)*
The `tenant_config` table had no `token_expiry` column. Token expiry was recalculated in memory from `connected_at` using an assumed 1-hour MSAL access token lifetime.
- Fix applied: `token_expiry TEXT` column added to `db/schema.sql`; `ALTER TABLE` migration added to `electron/main.ts` for existing DBs. `Connect-Tenant.ps1` now passes `tokenExpiry` from the MSAL result; stored on every connect. This fix also resolved the root cause of the "Not connected" Dashboard bug — the missing column caused the entire `INSERT OR REPLACE INTO tenant_config` to throw silently, leaving the table empty.

**INFO — DevTools auto-opens in dev mode.**
Confirmed as a dev-only pattern. Verify `process.env.NODE_ENV !== 'production'` guard is in place (it is: `if (process.env.VITE_DEV_SERVER_URL) win.webContents.openDevTools()`).

**INFO — The Microsoft Graph PowerShell client ID (`14d82eec`) is a shared public client.**
This is a pragmatic choice (no app registration needed), but it means the application relies on Microsoft not revoking or modifying this client's permissions. Document a migration path for organizations that want to use their own registered app.

---

## Viewpoint 4 — UI/UX Developer

*Component design, visual consistency, accessibility, responsiveness, and developer ergonomics.*

### Strengths

**Dark-theme design is consistent and professional.**
CSS custom properties (`--bg-800`, `--surface-100`, `--primary`, `--accent`, `--warning`, `--error`) are used consistently across all components. The dark palette is appropriate for a tool used by IT admins in potentially low-light server rooms or during incident response.

**Status badges communicate state clearly.**
`badge-success` (Current), `badge-warning` (Update), `badge-neutral` (Cloud Only) are distinct enough to scan quickly in a table.

**Two-state loading (skeleton → data) is implemented correctly.**
The Deploy page shows 12 skeleton cards while recommendations load. The Dashboard table shows a "Loading apps from Intune..." state. Neither blocks on secondary data.

**The job panel design works well.**
Progress stepper + phase label + log panel + Cancel/Clear buttons give the admin everything they need to monitor a running job in one card.

**`AppCard` handles long descriptions gracefully.**
`WebkitLineClamp: 2` limits card descriptions to two lines. The Details modal shows the full content. This is the correct pattern for variable-length content in a grid.

### Issues Found

**MAJOR — No accessible focus management.**
No component sets `aria-label`, `role`, or `aria-live` attributes. The log panel updates asynchronously but has no `aria-live="polite"` to announce new entries to screen readers. Status badges have no accessible text alternatives (they rely solely on color and text visible on screen, but color-blind users relying on assistive technology will not get status information).
- Recommendation: Add `aria-label` to all icon-only buttons, `aria-live="polite"` to the log panel container, and `role="status"` to the phase label.

**MAJOR — No keyboard navigation for app cards.**
The recommendations grid renders `<div>` cards with buttons inside, but the card itself is not keyboard-navigable. Tab order goes button-to-button within the card, but there is no way to navigate between cards using keyboard arrows or home/end.
- Recommendation: Make each card focusable with `tabIndex={0}` and `onKeyDown` handling for Enter (trigger deploy) and Space (toggle details).

**MAJOR — Modal (AppCard details) has no focus trap.**
When the Details modal opens, focus stays on the previously-focused element. A keyboard user can tab past the modal into the background content. The modal also has no `role="dialog"` or `aria-modal="true"`.
- Recommendation: Use a focus trap on modal open/close (move focus to first interactive element in modal, restore on close). Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the modal title.

**MAJOR — The log panel has no scroll-to-bottom behavior on new entries.**
`LogPanel` receives new log entries but there is no `scrollTop = scrollHeight` call when entries are appended. On a long job, the admin must manually scroll to see the latest log line.
- Recommendation: Add a `useEffect` that scrolls the log container to the bottom whenever `logs` length increases, with an opt-out ("Pause scroll") for when the admin is reviewing earlier entries.

**MINOR — Inline styles (`style={{...}}`) used extensively instead of CSS classes.**
Almost all component styling is done via the `styles: Record<string, React.CSSProperties>` pattern. This means:
- No CSS media queries (no responsive behavior)
- No `:hover` pseudo-class on table rows (row hover style is defined but uses `transition: background 0.1s` without a hover state — this never triggers)
- Style objects are re-created on every render

Recommendation: Move stable layout styles to a global CSS file or CSS modules. Keep only truly dynamic styles as inline objects.

**MINOR — The table row `transition: background 0.1s` has no hover state.**
In `AppCatalogTable.tsx`, `styles.row` has `transition: 'background 0.1s'` but there is no hover background change defined (inline styles cannot use `:hover`). The transition is never triggered.
- Recommendation: Add a `className="table-row"` and define `:hover` background in global CSS.

**MINOR — Font stack not specified.**
No `font-family` is defined in the global CSS or `<html>` element. The app inherits the Electron WebView default (usually system-ui or Arial), which can vary between Windows versions. Enterprise Windows machines often have unusual system fonts.
- Recommendation: Add `font-family: 'Segoe UI', system-ui, sans-serif` to the `:root` CSS rule.

**MINOR — The topbar is duplicated between `Dashboard.tsx` and `Deploy.tsx`.**
Both pages define their own `topbar`, `brand`, `nav`, and connection status markup. These are structurally identical with only one difference (which nav button is "active").
- Recommendation: Extract a `<AppShell>` layout component wrapping the page content. Pass `activePage` as a prop to highlight the correct nav button.

**MINOR — No empty state illustration on the recommendations grid.**
When recommendations fail to load, the error message is plain text: "Could not load recommendations: [error]". When loading succeeds but returns 0 items, the message is: "No recommendations available. Use the search bar." Neither has an illustration or clear recovery action.
- Recommendation: Add a retry button on the error state and an icon/illustration to empty states.

**INFO — `letter-spacing` and `text-transform: uppercase` in inline styles.**
`AppCatalogTable` uses `textTransform: 'uppercase'` and `letterSpacing: '0.05em'` in column headers via inline styles. These work correctly but would be cleaner in a global `.table-header` CSS class.

---

## Summary Scorecard

| Viewpoint | CRITICAL | MAJOR | MINOR | INFO |
|-----------|----------|-------|-------|------|
| Endpoint Admin | 1 | 2 | 2 | 1 |
| Systems Developer | 2 | 5 | 4 | 2 |
| Security Engineer | 2 | 4 | 3 | 2 |
| UI/UX Developer | 0 | 4 | 5 | 1 |
| **Total** | **5** | **15** | **14** | **6** |

## Top 5 Items to Address First

| Priority | Issue | Rationale |
|----------|-------|-----------|
| 1 | IPC channel whitelist in preload.ts (Security CRITICAL + Dev MINOR) | Closes the largest attack surface expansion; low effort |
| 2 | Path validation for Claude tool inputs (Security MAJOR + Dev MAJOR) | Prevents directory traversal from AI-generated paths |
| 3 | `runPsScript` timeout (Dev BLOCKING) | Prevents jobs hanging indefinitely; every admin will hit this |
| 4 | Log panel auto-scroll to bottom (UI MAJOR) | Most visible UX defect during active job monitoring |
| 5 | Group assignment missing from deploy flow (Admin CRITICAL) | Every deployment requires a manual Intune portal step after |

---

*Peer review complete — 2026-03-30*
