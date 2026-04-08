# Lessons Learned

> Query this file at the start of each session using keywords from the current task (e.g., "Intune", "MSI", "detection", "registry").

---

## Lesson 001 — Camtasia Package (2026-03-25)

### Keywords
`intune`, `msi`, `camtasia`, `detection`, `registry`, `peer-review`, `enhanced-workflow`

### What Happened
Built an Intune Win32 package for Camtasia without following the Enhanced Workflow. Skipped Pre-Flight planning, did not enter Plan Mode, started downloading a 305 MB file and creating scripts without user sign-off, used no peer reviewer, and wrote no post-flight documentation.

### Anti-Pattern (Why It Happened)
**Workflow steps were treated as optional overhead rather than mandatory checkpoints.**

The 3-step trigger ("enter Plan Mode for any task with 3+ steps") was ignored because the task felt familiar and routine. The result was shipping v1.0 scripts with 4 BLOCKING and 17 MAJOR issues — including a path traversal vulnerability, no SHA256 verification, inconsistent registry naming, no downgrade protection, and no reboot code propagation in the uninstall script.

The root cause is: **skipping planning does not save time — it front-loads defects that are more expensive to fix later.**

### Heuristic (Prevention)
**The Enhanced Workflow is not optional for tasks with 3+ steps. No exceptions.**

Specific enforcement rules:
1. Before ANY download or file creation: write `tasks/todo.md` with checklist and risk assessment.
2. Before heavy implementation (downloads, installs, bulk file writes): check in with the user.
3. For every new package: spawn a peer-review subagent before producing the final `.intunewin`.
4. After every task: update `tasks/todo.md` with post-flight review and update this file.

### Technical Patterns Established (apply to all future packages)

| Pattern | Implementation |
|---------|----------------|
| Script structure | `[CmdletBinding()]` + `param()` on every script |
| Write-Log signature | `[Parameter(Mandatory)] [ValidateNotNullOrEmpty()]` |
| Log directory validation | Create dir, then write/delete test file before proceeding |
| Installer path safety | `[IO.Path]::GetFullPath()` + `StartsWith()` check to prevent traversal |
| Installer integrity | SHA256 hash verified against known-good value at runtime |
| Version check | Check existing install: skip if same, skip if newer (no downgrade), upgrade if older |
| Post-install validation | Check for exe on disk + Add/Remove Programs entry |
| Error logging | Always log `$_.Exception.GetType().FullName` in catch blocks |
| Detect script catch | Silently `exit 1` — never `Write-Host` on failure path |
| Detect version comparison | Broad minimum version (e.g., `>= 26.0.0.0`) — document the intent |
| Uninstall reboot codes | Track `$rebootRequired`; propagate `exit 3010` at end |
| Uninstall dir cleanup | After MSI uninstall, check and remove known install dirs |
| Registry naming | `HKLM:\SOFTWARE\[AppName]Installer` (e.g., `CamtasiaInstaller`) |
| PACKAGE_SETTINGS.md | Must include: dependency versions + registry keys, licensing options, post-deploy validation, troubleshooting table |

### Pattern for Future MSI Packages (Retry Logic)
The peer reviewer correctly noted that Python has `Invoke-WithRetry` for network operations. For **download-at-install-time** packages (like Python), this is critical. For **bundled MSI** packages (like Camtasia, Chrome, Firefox), the MSI is pre-included in the `.intunewin` — no retry needed for the installer itself. Apply retry only when the script fetches content from the internet at install time.

---

## Lesson 002 — Edge WebView2 Runtime Package (2026-03-25)

### Keywords
`intune`, `exe`, `webview2`, `evergreen`, `detection`, `registry`, `chromium`, `uninstall`, `dynamic-path`, `peer-review`, `enhanced-workflow`

### What Happened
Built a complete Intune Win32 package for Microsoft Edge WebView2 Runtime (v146.0.3856.78) as a dependency for Camtasia. This time the Enhanced Workflow was followed correctly from the start: Plan Mode entered, user clarifying questions asked before implementation, peer-review subagent run before packaging.

Peer-review returned PASS WITH REQUIRED FIXES (0 BLOCKING, 4 MAJOR). All 4 MAJOR issues were fixed before the `.intunewin` was built.

### Key Difference from MSI Packages
WebView2 is an **EXE bootstrapper** (Chromium), not a WiX MSI. This changes several patterns:
- Install command: `/silent /install --system-level --verbose-logging` (not `msiexec /i /qn`)
- Detection: NOT in Add/Remove Programs (`SystemComponent = 1`); must use EdgeUpdate registry `pv` value
- Uninstall path: **dynamic and versioned** — path contains version number that changes after every auto-update
- Evergreen model: after initial install, Edge Update service silently keeps WebView2 current; no redeployment needed

### Anti-Pattern Caught by Peer Review

**Stale-first detection ordering:**
The v1.0 detect script checked the custom detection registry (set by the install script) as Method 1, and the EdgeUpdate registry as Method 2. After an auto-update, the custom registry holds the originally-installed version while EdgeUpdate always reflects the current installed version. Checking stale data first is a correctness risk.

**Fix:** For evergreen apps, always check the authoritative live source first. Detection priority should mirror the reliability of the data source, not the order it was written.

**Version-agnostic fallback in uninstall:**
The v1.0 uninstall fallback picked the most-recently-modified `setup.exe` if the uninstall registry key was missing. After an auto-update, multiple versioned setup.exe copies may exist. The most-recent isn't necessarily the right one for the currently-registered version.

**Fix:** When searching for a versioned binary, prefer a path containing the detected version string (`$pvValue`) before falling back to recency sort.

### Heuristic (Prevention)

**For evergreen apps:** Detection priority = most authoritative live source first. Custom registry values set at install time go last — they are stale after auto-update.

**For versioned uninstall paths:** Never rely on file recency alone when version-specific paths exist. Use the detected version string to select the matching binary first.

### Technical Patterns Established (EXE / Chromium bootstrapper packages)

| Pattern | Implementation |
|---------|----------------|
| EXE silent install | `Start-Process` with `/silent /install --system-level --verbose-logging`; **not** `msiexec` |
| Timeout handling | Manual polling loop (`while (-not $proc.HasExited)`) with `$proc.Kill()` on timeout |
| Evergreen detection strategy | Any installed version satisfies requirement; no minimum version check |
| SystemComponent detection | Cannot use Add/Remove Programs — must use EdgeUpdate registry `pv` value |
| EdgeUpdate GUID (WebView2) | `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` at `HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` |
| Dynamic uninstall path | Read `UninstallString` from `HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView` |
| Versioned uninstall fallback | Prefer `setup.exe` path containing `$pvValue`; warn if falling back to most-recent |
| Return value on helper functions | Always check bool return from helper functions that write to registry; log warning if false |
| SHA256 update documentation | PACKAGE_SETTINGS.md must include step-by-step SHA256 update procedure for EXE packages |
| No redeployment needed for updates | Document in PACKAGE_SETTINGS.md: Edge Update handles ongoing version updates automatically |

---

## Lesson 003 — IntuneManager PowerShell + WPF Application (2026-03-25)

### Keywords
`intune`, `powershell`, `wpf`, `msal`, `graph-api`, `runspace`, `dispatcher`, `ps51`, `xaml`, `azure-blob`, `upload`, `winget`, `peer-review`, `enhanced-workflow`

### What Happened
Built a complete PowerShell + WPF desktop application (IntuneManager) for managing Intune Win32 apps. The application authenticates via MSAL.NET, discovers apps from the Intune tenant via Graph API, and supports creating and updating apps including full chunked Azure Blob upload.

Enhanced Workflow was followed correctly. Plan Mode was entered, user requirements were confirmed, peer review was run, all MINOR issues were fixed. Final state: 16 PS files, 0 parse errors, peer review PASS.

### Critical Dependency: MSAL.NET Version Pin

**MSAL 4.47.x fails on PowerShell 5.1 / .NET Framework.**

MSAL 4.47.x introduced a dependency on `Microsoft.IdentityModel.Abstractions` (v6.22.0+) which is not included in the NuGet package and is not available in .NET Framework / PS 5.1 runtimes. Attempting to `Add-Type` 4.47.x produces:

```
Could not load file or assembly 'Microsoft.IdentityModel.Abstractions, Version=6.22.0.0'
```

**Fix:** Pin to **MSAL 4.43.2 net461 build**. This is the last version before the IdentityModel dependency was introduced. It loads cleanly in PS 5.1 with no transitive dependencies.

**Download:** `https://www.nuget.org/packages/Microsoft.Identity.Client/4.43.2` → extract `lib\net461\Microsoft.Identity.Client.dll`

### PS 5.1 Compatibility Gotchas

| Gotcha | Symptom | Fix |
|--------|---------|-----|
| `??` null-coalescing operator | `Unexpected token '??'` at parse time | Use `if ($x) { $x } else { $y }` |
| `?.` null-conditional operator | Same parse error | Use `if ($x) { $x.Prop }` |
| UTF-8 chars without BOM | Multi-byte characters (em dash `—`, arrow `→`) corrupt as ANSI | Always save PS files with UTF-8 BOM: `[System.Text.UTF8Encoding]::new($true)` |
| `|` pipe inside method call arg | `Missing ')'` parse error | Extract the piped expression to a separate variable before passing to the method |
| `$var` in switch hashtable string | Variable not expanded in double-quoted string inside switch block value | Use `$($var)` for interpolation |

### WPF + Runspace Architecture Patterns

| Pattern | Implementation |
|---------|----------------|
| STA thread requirement | Auto-relaunch: `if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { powershell.exe -STA -File $path; exit }` |
| Background work | `[RunspaceFactory]::CreateRunspace()` with `ApartmentState = MTA`; pass `$SharedState` via `SetVariable` |
| UI update from background | `$SharedState.Dispatcher.Invoke([System.Action]{ ... })` -- always via Dispatcher, never direct |
| Shared mutable state | `[hashtable]::Synchronized(@{...})` passed into every runspace |
| XAML code-behind | No `x:Class` -- all event wiring done in `.xaml.ps1` via `$window.FindName('ControlName')` |
| ObservableCollection DataGrid | `[System.Collections.ObjectModel.ObservableCollection[PSCustomObject]]::new()` -- all `.Add()/.Clear()` inside `Dispatcher.Invoke` |
| No XAML `x:Class` | WPF compilation requires C#; PS-only projects must omit `x:Class` entirely |

### Graph API Win32 App Upload Sequence (exact order)

```
1. POST  /deviceAppManagement/mobileApps                          -> appId
2. POST  /mobileApps/{appId}/.../contentVersions                  -> contentVersionId
3. Extract EncryptionInfo from Detection.xml inside .intunewin ZIP
4. POST  /mobileApps/{appId}/contentVersions/{id}/files           -> fileEntry (azureStorageUri, fileId)
5. PUT   {sasUri}&comp=block&blockid={id}  (one call per 5 MB chunk)
6. PUT   {sasUri}?comp=blocklist           (XML block list to finalize blob)
7. POST  /files/{fileId}/commit            with fileEncryptionInfo body
8. GET   /files/{fileId}  (poll until uploadState = 'commitFileSuccess', max 120s)
9. PATCH /mobileApps/{appId}              body: { committedContentVersion: '{contentVersionId}' }
```

Azure Blob steps (5, 6) use the SAS URI directly -- **no bearer token**. The SAS URI is self-authorizing. If a PUT returns 403 after ~8 min, re-request the file entry to get a fresh SAS URI.

### "Install Latest Stable Version" Pattern

For apps with a known Winget ID, version can be deferred to upload time:
1. Store `WingetId` and `UseLatestVersion = $true` in wizard state
2. At build+upload time (not at wizard open): call `Get-LatestWingetVersion -WingetId $id`
3. Parse `winget.exe show $id --accept-source-agreements` output for `Version:` field
4. Update `AppVersion` before building the Graph app body

This ensures the `displayVersion` in Intune always reflects the actual installed version, not a stale value from PACKAGE_SETTINGS.md.

### Update All Queue Pattern

When a "Update All" feature calls a view that navigates away on completion, a simple `foreach` loop doesn't work -- the loop fires all `Show-X` calls immediately and only the last navigation survives.

**Fix:** Use a queue stored in SharedState:
```powershell
# Dashboard: enqueue all pending items, dequeue first
$queue = [System.Collections.Generic.Queue[PSCustomObject]]::new()
foreach ($row in $outdated) { $queue.Enqueue($row) }
(Get-SharedState)['UpdateQueue'] = $queue
Show-UpdateView -AppRow ($queue.Dequeue())

# UpdateView OnComplete: chain to next item
$queue = (Get-SharedState)['UpdateQueue']
if ($queue -and $queue.Count -gt 0) {
    Show-UpdateView -AppRow ($queue.Dequeue())
} else {
    (Get-SharedState)['UpdateQueue'] = $null
    Show-Dashboard
}
```

This pattern applies whenever a sequential workflow must chain through a navigation-based UI.

---

## Lesson 004 — IntuneManager Runtime Fixes (2026-03-26)

### Keywords
`wpf`, `xaml`, `dotnet-framework`, `ps51`, `scope`, `msal`, `msal-client-id`, `sta`, `mta`, `runspace`, `AcquireTokenInteractive`, `event-handler`, `dot-source`

### What Happened
First launch of IntuneManager produced three categories of runtime failures:
1. **XAML crash** on startup: `StackPanel.Spacing`, `TextBox.PlaceholderText`, `TextBlock.TextTransform`, `TextBlock.LetterSpacing` — all .NET 5 WPF-only properties, not present in .NET Framework 4.x (which PS 5.1 uses)
2. **WPF event scope failure**: `The term 'Start-Login' is not recognized` — functions defined via dot-sourcing `.xaml.ps1` files were not accessible from WPF button click handlers
3. **MSAL auth failure**: `AADSTS700016 — Application d1ddf0e4 not found in directory` — the Microsoft Intune PowerShell client ID requires per-tenant admin consent; `AcquireTokenInteractive` was also being called from an MTA runspace, causing silent failure

### Anti-Pattern (Why It Happened)

**XAML properties:** Peer review flagged `Spacing="8"` but accepted it under the assumption that "all Win10/11 machines ship .NET 4.7.2+." This was a category error — `Spacing` is a .NET **5** WPF property, not a .NET Framework 4.x property at any version. The two runtimes are completely separate, not a version progression.

**WPF event scope:** `function Foo { }` declared inside a dot-sourced file exists only in the call-stack scope at the moment of dot-sourcing. WPF event handlers (button clicks) fire in their own scope context that does not inherit from the original dot-source call. This is an inherent PS+WPF integration constraint that is not documented clearly.

**MSAL client ID + STA:** The `d1ddf0e4` client ID was documented as the "Microsoft Intune PowerShell" client, which sounded globally available. In reality it requires explicit admin consent per tenant. Additionally, `AcquireTokenInteractive` was called inside `Invoke-BackgroundOperation` (MTA runspace) to avoid blocking the UI — but MSAL requires STA for interactive login; on MTA it fails silently.

### Heuristic (Prevention)

**XAML runtime audit (add to every WPF build checklist):**
```
grep -r "Spacing=" *.xaml
grep -r "PlaceholderText=" *.xaml
grep -r "TextTransform=" *.xaml
grep -r "LetterSpacing=" *.xaml
grep -r "RevealMode=" *.xaml
```
These are ALL .NET 5+ / UWP only. None are available in .NET Framework WPF (PS 5.1 runtime).

**WPF event handlers — mandatory pattern:** Every function that will be called from a WPF event handler MUST be a `$script:` scoped scriptblock variable. Functions defined with `function` are invisible to WPF closures.
```powershell
# WRONG -- invisible to WPF events:
function Do-Thing { ... }

# CORRECT -- accessible from any WPF event handler:
$script:ViewName_DoThing = { ... }
# Call site:
$btnFoo.Add_Click({ & $script:ViewName_DoThing })
```

**MSAL client IDs for Intune apps:**

| Client ID | Name | Consent model |
|---|---|---|
| `d1ddf0e4-d672-4dae-b554-9d5bdfd93547` | Microsoft Intune PowerShell | Requires per-tenant admin consent |
| `14d82eec-204b-4c2f-b7e8-296a70dab67e` | Microsoft Graph PowerShell | Pre-consented in all M365 tenants ✅ |
| `04b07795-8ddb-461a-bbee-02f9e1bf7b46` | Microsoft Azure CLI | Pre-consented in all M365 tenants ✅ |

Use `14d82eec` (Microsoft Graph PowerShell) for any app that needs Intune/Graph access without requiring the user/admin to register an Azure app.

**STA/MTA threading rule for MSAL:**
- `AcquireTokenInteractive` → **MUST run on STA UI thread**. Call it directly in the WPF button click handler.
- `AcquireTokenWithDeviceCode` → Can run in an MTA background runspace (non-interactive; user authenticates in a separate browser).
- `AcquireTokenSilent` → Can run in any thread.

**Auth should use `common` authority** (not tenant-specific) when users log in with their own accounts:
```powershell
$builder = $builder.WithAuthority('https://login.microsoftonline.com/common')
```
TenantId is then extracted from `$result.TenantId` after login — the user doesn't need to supply it.

### Technical Patterns Established

| Pattern | Implementation |
|---|---|
| WPF .NET Framework compat | No `Spacing=`, `PlaceholderText=`, `TextTransform=`, `LetterSpacing=` in XAML. Use `Margin` on child elements instead of `Spacing`. |
| WPF event handler functions | `$script:Prefix_FunctionName = { }` always. Never `function`. |
| MSAL client for Intune | `14d82eec-204b-4c2f-b7e8-296a70dab67e` (Graph PowerShell) — no registration needed |
| MSAL authority | `https://login.microsoftonline.com/common` — no tenant ID from user |
| Interactive login thread | `AcquireTokenInteractive` on STA UI thread only — directly in click handler |
| System browser | `.WithUseEmbeddedWebView($false)` on `AcquireTokenInteractive` builder — avoids WebView2 parenting issues |
| Parent HWND (CRITICAL) | `.WithParentActivityOrWindow($hwnd)` is MANDATORY on .NET Framework. Without it, `AcquireTokenInteractive` hangs silently with no error. Get HWND via `(New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle` |
| Auth test mandate | Test `Connect-IntuneManager` against the actual target tenant before marking Auth phase complete |

---

## Lesson 005 — IntuneManagerUI Deploy Page + IPC Race Conditions (2026-03-30)

### Keywords
`electron`, `react`, `ipc`, `race-condition`, `useRef`, `state`, `job-queue`, `winget-version`, `two-phase-loading`, `upload-only`, `package-only`, `deploy`

### What Happened
Three related features were built for the Electron + React UI: (1) a redesigned Deploy page with AI recommendations and decoupled package/deploy workflow; (2) live winget version checking per app in the Dashboard; (3) a sequential Update All queue. Two significant runtime bugs were discovered and fixed:

**Bug 1 — "Deploy to Intune" re-downloaded and re-packaged the app**
After the package-only job completed, clicking "Yes, Deploy to Intune" was calling `ipcAiDeployApp` with the original text request. Claude then re-ran the full 12-step pipeline from scratch (search → download → package → create → upload) instead of just uploading the already-built `.intunewin`.

**Bug 2 — Clicking "Deploy to Intune" did nothing**
`job:package-complete` and `job:complete` are emitted back-to-back from the main process. `onJobPackageComplete` set `deployPrompt` via `setState`, but `onJobComplete` immediately called `clearSubs()`. Because both IPC messages arrive nearly simultaneously and React batches state updates, the prompt state was not reliably committed before the component re-rendered — so the button either didn't appear or clicking it had no effect.

### Anti-Pattern (Why It Happened)

**Bug 1:** The "deploy" step simply re-used the full deploy IPC handler (`ipcAiDeployApp`) because no separate "upload only" path existed. The fix required a dedicated `ipc:ai:upload-only` handler that takes `intunewinPath` + `packageSettings` (captured during packaging) and executes only steps 11-12 directly — no Claude loop, no re-download.

**Bug 2:** Using `setState` to pass data between two near-simultaneous IPC event handlers is unsafe. React batches state updates; the second handler (`onJobComplete`) runs before the first handler's state commit is visible to the component.

### Heuristic (Prevention)

**Decoupled pipeline pattern — always capture metadata at tool-call time:**
```typescript
// In the packaging loop, capture metadata into module-level variables:
if (block.name === 'generate_package_settings') {
  capturedPackageSettings = block.input as Record<string, unknown>
}
if (block.name === 'build_package') {
  if (r.success && r.intunewinPath) builtIntunewinPath = r.intunewinPath
}
// Emit both on completion:
sendEvent('job:package-complete', { jobId, intunewinPath, packageSettings })
```

**IPC event ordering — use refs for cross-event data handoff:**
When two IPC events fire in rapid succession and the second event needs data written by the first:
```typescript
// WRONG — setState is async, data may not be committed when second event fires:
onJobPackageComplete(data => {
  setDeployPrompt({ intunewinPath: data.intunewinPath, ... })  // may not commit in time
})
onJobComplete(data => {
  clearSubs()  // runs before setState above committed
})

// CORRECT — write to ref (synchronous), read from ref in second handler:
const packageResultRef = useRef(null)

onJobPackageComplete(data => {
  packageResultRef.current = { intunewinPath: data.intunewinPath, packageSettings: data.packageSettings }
})
onJobComplete(data => {
  const pkg = packageResultRef.current
  if (pkg) setDeployPrompt({ ..., ...pkg })  // safe — ref is already written
  clearSubs()
})
```

**Upload-only vs full deploy — always have separate IPC channels:**
- `ipc:ai:deploy-app` → full 12-step Claude loop (new deployment from scratch)
- `ipc:ai:package-only` → steps 1-10 only (build the `.intunewin`, no upload)
- `ipc:ai:upload-only` → steps 11-12 only (create Intune record + upload existing `.intunewin`)

Never reuse the full deploy handler when the user has already built the package.

### Technical Patterns Established

| Pattern | Implementation |
|---|---|
| Two-phase catalog loading | Phase 1: render Intune apps immediately (`setApps`, `setLoading(false)`). Phase 2: `Promise.all` concurrent winget lookups, `setApps(prev => prev.map(...))` per result. Never block initial render on slow PS calls. |
| Reactive per-row version checking | Set `versionChecking: true` on all rows initially; update individual rows to `versionChecking: false` + `latestVersion` as each winget call resolves. UI shows `checking...` inline. |
| Semver comparison | `v.split('.').map(n => parseInt(n) || 0)` + element-by-element comparison. Catch non-semver versions (date-based, etc.) and return `'unknown'` rather than throwing. |
| Update All sequential queue | Serialize updatable apps as JSON in `?updateAll=` query param. On Deploy page mount, load into `updateQueueRef`. After each deploy's `onJobComplete`, advance `updateQueueIndexRef` and call `startPackageJob` for next item. Never chain from render — chain from the completion handler. |
| Query param cleanup | `setSearchParams({}, { replace: true })` immediately after reading params on mount — prevents re-triggering on back navigation. |
| Module-level recommendation cache | `let cachedRecommendations: AppRecommendation[] | null = null` outside the hook function. On mount: if cache populated, use it; otherwise fetch and populate. Prevents re-calling Claude API on every page remount. |
| PACKAGE_SETTINGS.md parsing | Add new fields by extending the regex pattern in `Get-PackageSettings.ps1`. Always return partial results (never throw on missing fields) — use `$null` for missing values. |
| IPC wrapper type discipline | Every new IPC channel needs: (1) interface in `src/types/ipc.ts`; (2) typed wrapper in `src/lib/ipc.ts`; (3) handler in `electron/ipc/`. Never use `unknown` return types on wrappers that callers act on. |

---

## Lesson 006 — Graph API create_intune_app Failures (2026-03-30)

### Keywords
`graph-api`, `ps51`, `powershell`, `json`, `arg-mangling`, `spawn`, `child-process`, `hashtable`, `array`, `single-element`, `sas-uri`, `upload`, `content-file`, `polling`, `httprequest`, `electron`, `create-intune-app`

### What Happened

Three separate bugs caused `create_intune_app` (step 11) and `upload_to_intune` (step 12) to fail. All three required separate investigation sessions because each fix exposed the next bug.

**Bug 1 — `minimumSupportedWindowsRelease` wrong enum format**
Graph beta API rejected `W10_21H2` with `"Unknown MinimumSupportedWindowsRelease: W10_21H2"`. The correct value is `windows10_21H2`. All `W10_*`/`W11_*` prefixed values are invalid for the beta endpoint.

**Bug 2 — PS 5.1 JSON argument mangling (CLI → child_process)**
Node.js `spawn('powershell.exe', [..., '-BodyJson', jsonString])` passes the JSON string as a command-line argument. PowerShell 5.1 converts the argument from JSON string notation to its internal hashtable representation before the script receives it. The script received `{@odata.type:#microsoft.graph.win32LobApp,...}` instead of `{"@odata.type":"#microsoft.graph.win32LobApp",...}`. This triggered `ConvertFrom-Json` error: `Invalid object passed in, ':' or '}' expected`.

**Bug 3 — `ConvertTo-Hashtable` single-element array collapse**
After fixing arg mangling via temp file, still got HTTP 400. The PS script read JSON from file, called `ConvertFrom-Json` → `ConvertTo-Hashtable` → stored in hashtable → `ConvertTo-Json` to send to Graph. During this round-trip, a single-element array `detectionRules: [{...}]` became a plain object `detectionRules: {...}`. PS 5.1 serializes single-element arrays as bare objects when they pass through hashtable storage. Graph API requires an array and rejected the request with 400.

**Bug 4 — SAS URI not yet available after New-ContentFile POST (upload step 12)**
After app creation succeeded, upload failed with `"SAS URI not returned from Graph API for file entry <id>"`. The Graph API creates file entries asynchronously — immediately after `POST .../contentVersions/{id}/files`, the response contains an `id` but `azureStorageUri` is empty. The code immediately checked for the SAS URI and threw. The fix is to poll `GET .../files/{fileId}` until `azureStorageUri` is populated (up to 60 seconds) before proceeding to the blob upload.

### Anti-Pattern (Why It Happened)

**Bugs 1-3:** The entire `create_intune_app` code path was never exercised against the live Graph API endpoint before the app was deployed to users. The `minimumSupportedWindowsRelease` enum values were taken from docs/examples without empirical validation. The PS 5.1 argument-passing and hashtable round-trip bugs are not obvious from reading the code — they only manifest at runtime.

**Bug 4:** The Graph API documentation describes `azureStorageUri` as returned by the POST, but the real behavior is async provisioning. The previous WPF implementation used a short `Start-Sleep` after the file creation call, which masked the timing issue. The Electron rewrite omitted this timing requirement.

### Heuristic (Prevention)

**Test the live Graph API for every new endpoint before shipping.** Use a standalone PS test script that constructs and sends the exact same request body the production code will send. Run it against the real tenant.

**Never pass JSON as a CLI argument from Node.js → PowerShell.** JSON strings contain `{ } : [ ] "` characters that PS 5.1 transforms. Always write to a temp file and pass the file path.

**Never round-trip JSON through `ConvertTo-Hashtable → ConvertTo-Json` when the original JSON structure must be preserved exactly.** Use `[System.Net.HttpWebRequest]` with the raw JSON bytes, or use `Invoke-RestMethod` with `-Body $jsonString -ContentType 'application/json'` directly.

**After creating a Graph API file entry, poll until the SAS URI is populated before attempting the upload.** The `azureStorageUri` field is provisioned asynchronously. Poll `GET .../files/{id}` with a 5-second interval, up to 60 seconds.

### Technical Patterns Established

| Pattern | Implementation |
|---------|----------------|
| `minimumSupportedWindowsRelease` valid beta enum values | Windows 10: `windows10_21H2`, `windows10_22H2`, `2H20`, `2004`, `1903`, `1809`, `1607`. Windows 11: `Windows11_21H2`, `Windows11_22H2`, `Windows11_23H2`, `Windows11_24H2`. Never use `W10_*` or `W11_*` prefix format. |
| Node.js → PS JSON arg passing | Write JSON to temp file with `fs.writeFileSync(tmpPath, json, 'utf8')`, pass `-BodyJsonPath tmpPath`. Clean up in `finally` block. |
| PS → Graph API: preserve JSON structure | Use `[System.Net.HttpWebRequest]` with `$req.GetRequestStream()` to POST raw bytes. No `ConvertTo-Hashtable → ConvertTo-Json` round-trip. |
| Graph file entry SAS URI | After `POST .../files`, poll `GET .../files/{id}` until `azureStorageUri` is non-empty (5s interval, 60s max). Throw if not populated. |
| Graph error details via PS | `Invoke-RestMethod` swallows response bodies on error. Use `[System.Net.HttpWebRequest]` + `$_.Exception.Response.GetResponseStream()` via `StreamReader` to capture the full error JSON from Graph. |

---

## Lesson 007 — Deploy Page Refactor: PS Filename→Folder Matching + PACKAGE_SETTINGS.md Format Variance (2026-03-30)

### Keywords
`powershell`, `ps51`, `markdown`, `package-settings`, `filename-matching`, `fuzzy-match`, `deploy-button`, `null-guard`, `ui-feedback`, `enhanced-workflow`

### What Happened
Built `List-IntunewinPackages.ps1` to scan the output folder for `.intunewin` files and match each to its `PACKAGE_SETTINGS.md`. The script shipped with exact string matching. At runtime: (1) the Deploy button did nothing for all 16 packages — root cause was a null guard in `startUploadOnlyJob` silently returning when `packageSettings` was null, because no PACKAGE_SETTINGS.md was being found; (2) PACKAGE_SETTINGS.md was not being found because app names parsed from filenames (`Notepad++`, `FigmaSetup`) didn't exactly match source folder names (`NotepadPlusPlus`, `Figma`); (3) even when the folder was found, fields weren't parsed from WSL's `PACKAGE_SETTINGS.md` which uses `| **Field** |` bold formatting.

### Anti-Pattern (Why It Happened)
**Silent failure with no UI feedback.** The function returned `null` when settings weren't found, the null guard in the job function silently returned with no error, and the button appeared enabled but clicked to nothing. The user had no way to know the settings lookup was failing.

**Exact matching without testing against real data.** The PS script was written with `$appName -eq $folderName` without first checking what actual folder names exist in the Source directory. A one-minute `Get-ChildItem` call would have revealed the mismatch immediately.

### Heuristic (Prevention)

**Always run new PS scripts against the actual data directory before shipping.** For any script that maps filenames to folder names: run it with real paths and log which items matched and which didn't. Never assume names will be consistent.

**When a button's action can silently no-op, surface the reason in the UI.** A disabled button with a tooltip ("No PACKAGE_SETTINGS.md found — cannot deploy") is always better than an enabled button that does nothing.

**PACKAGE_SETTINGS.md format is not standardized across packages.** When parsing markdown tables from files generated by different tools/people, always handle both `| Field |` and `| **Field** |` variants. Strip `**` before using the parsed value.

### Technical Patterns Established

| Pattern | Implementation |
|---------|----------------|
| Filename → folder fuzzy matching (PS) | `Find-SourceFolder`: 4 levels — exact case-insensitive → normalized (strip spaces/hyphens/dots/+) → normalized prefix → normalized substring |
| Normalize function (PS) | `($s.ToLower() -replace '[\s\-_\.\+]', '')` — strips common separators before comparing |
| Markdown bold field parsing | `Parse-MdField` regex: `\|\s*\*{0,2}$escaped\*{0,2}\s*\|` — matches both plain and bold; `Strip-MdBold` strips `**` from parsed value |
| Silent null guard → UI disabled | When a function silently returns on null input, mirror that condition as a `disabled` prop on the button with a `title` tooltip explaining why |
| Real data test before shipping | For any PS script that does file/folder matching: test with `-OutputFolder` and `-SourceRootPath` pointing at actual project directories before committing |

---

## Lesson 008 — SQLite Schema/Code Mismatch: Silent DB Write Failure (2026-03-31)

### Keywords
`electron`, `sqlite`, `better-sqlite3`, `schema`, `migration`, `tenant-config`, `isconnected`, `silent-failure`, `catch-non-fatal`, `token-expiry`, `dashboard`, `react-context`

### What Happened

Dashboard showed "Not connected" after every page navigation despite the user having successfully authenticated. Two rounds of React-layer fixes (TenantContext polling interval, removed stale refs) confirmed the source code was correct, yet the bug persisted.

Root cause: the `tenant_config` table in `db/schema.sql` was **missing the `token_expiry` column**. The IPC handler for `ipc:ps:connect-tenant` ran:

```sql
INSERT OR REPLACE INTO tenant_config
  (id, tenant_id, username, token_expiry, connected_at, updated_at)
  VALUES (1, ?, ?, ?, ...)
```

`better-sqlite3` throws `SqliteError: table tenant_config has no column named token_expiry`. This was caught by `catch { /* non-fatal */ }` — so the entire INSERT was silently discarded. The DB row was never written.

On every navigation, `TenantContext.refreshStatus()` polled the DB, found an empty `tenant_config` table, and returned `{ isConnected: false }`. The 60-second polling interval that was supposed to fix the issue was now actively confirming "Not connected" every 60 seconds.

Why first-load appeared to work: `connect()` in `TenantContext` sets React state directly from the PS script response — it doesn't read the DB. So the Dashboard immediately after login showed "Connected." But any subsequent navigation caused a DB read → empty → "Not connected."

### Anti-Pattern (Why It Happened)

**Schema and calling code were written in separate sessions with no cross-validation.** The `connect-tenant` handler was written knowing it needed to persist `token_expiry`, but the schema was written without it. The `catch { /* non-fatal */ }` wrapper on the INSERT was meant to handle transient DB errors — it inadvertently masked a structural schema bug.

**The React-layer fix was applied first without fully tracing the data path.** The polling interval in `TenantContext` was a valid fix for a stale-state issue, but it didn't surface the underlying DB problem because the error was silent.

### Heuristic (Prevention)

**When a DB write is wrapped in `catch { /* non-fatal */ }`, add at minimum a `console.error` or log so schema mismatches are visible immediately:**
```typescript
try {
  db.prepare('INSERT INTO ... (col1, col2) VALUES (?, ?)').run(...)
} catch (e) {
  console.error('[db] connect-tenant write failed:', e)  // catches schema bugs immediately
}
```

**When debugging a UI state bug that involves persisted data, check the DB layer first** — before touching React state, refs, or effects. The fastest diagnosis path is: "Can I see the DB row that should exist?" If the row is absent, the bug is in the write path, not the read path.

**Always cross-validate INSERT column lists against the current schema** before writing any IPC handler that persists data. A `SELECT * FROM sqlite_master WHERE type='table' AND name='...'` check during development takes 30 seconds and would catch this class of bug immediately.

**Schema changes to existing tables require migrations.** `CREATE TABLE IF NOT EXISTS` does not add new columns to an existing table. Any time a column is added to `schema.sql`, a corresponding `ALTER TABLE ... ADD COLUMN` migration must be run at startup:

```typescript
// In createDatabase():
const cols = db.prepare("PRAGMA table_info(your_table)").all() as Array<{ name: string }>
if (!cols.some(c => c.name === 'new_column')) {
  db.exec("ALTER TABLE your_table ADD COLUMN new_column TEXT")
}
```

### Technical Patterns Established

| Pattern | Implementation |
|---------|----------------|
| DB write error visibility | Never use bare `catch { /* non-fatal */ }` on INSERT/UPDATE statements. Always log: `catch (e) { console.error('[db] write failed:', e) }` |
| Schema migration pattern | After `database.exec(schema)`, run `PRAGMA table_info(tablename)` and `ALTER TABLE ... ADD COLUMN` for each column that may be missing in existing DBs |
| State bug diagnosis order | For "shows wrong value after navigation" bugs: (1) check DB row exists; (2) check IPC handler returns correct value; (3) check React context reads it; (4) check component re-renders on change. Start at layer 1. |
| `CREATE TABLE IF NOT EXISTS` limitation | This DDL statement only creates the table if absent. It does NOT add missing columns to an existing table. Schema changes to deployed tables always require `ALTER TABLE`. |
| Electron `userData` path | `app.getPath('userData')` returns `%APPDATA%\<appName>` where `appName` is the `name` field in `package.json`. For `"name": "intune-manager-ui"`, DB is at `C:\Users\<user>\AppData\Roaming\intune-manager-ui\intunemanager.db`. |

---

## Lesson 009 — DB Cache-First Pattern for Electron IPC (2026-04-02)

### Keywords
`electron`, `ipc`, `sqlite`, `cache`, `setImmediate`, `background-refresh`, `useCallback`, `pendingRefreshes`, `win.isDestroyed`, `sendToRenderer`, `peer-review`

### What Happened
Implemented DB caching for all 6 Intune data fetches (Dashboard + App Catalog). Each IPC handler returns SQLite-cached data immediately, then fires a `setImmediate` background PS refresh that emits an IPC update event when done. Dashboard subscribes to the 6 events and applies fresh data live.

Peer review found 2 genuine blocking bugs before the implementation went to production:
1. `sendToRenderer` called inside `setImmediate` callbacks without guarding against window destruction — would throw an unhandled error if the app closed during a background PS refresh.
2. `pendingCacheRefreshes.current = cacheHits` overwrote the counter instead of accumulating — corrupted the "Refreshing..." spinner state when `fetchSummary` was called twice in quick succession (e.g., manual refresh + 60s interval overlap).

### Anti-Pattern (Why It Happened)
**setImmediate callbacks are fire-and-forget — the handler has already returned by the time they run.** The window could be destroyed at any point after the handler returns. Any reference to `win` inside a `setImmediate` is a use-after-free risk unless guarded.

**Shared mutable counters with assignment semantics (`=`) instead of accumulation (`+=`) break under concurrent callers.** Multiple calls to the same function within a short window (interval timer + user click) will overwrite each other's state. Always use `+=` when a counter tracks in-flight operations.

### Heuristic (Prevention)

**Always guard `sendToRenderer` (or any `win.webContents.*` call) that runs inside `setImmediate`, `setTimeout`, or an async callback:**
```typescript
// WRONG — throws if window closed before callback fires:
setImmediate(async () => {
  sendToRenderer('channel', data)  // win may be destroyed
})

// CORRECT — check first:
const sendToRenderer = (channel: string, data: unknown) => {
  if (!win.isDestroyed()) win.webContents.send(channel, data)
}
```
Put the guard in `sendToRenderer` itself so every call site is automatically protected.

**Use `+=` for any ref/state tracking concurrent in-flight operations:**
```typescript
// WRONG — second call overwrites first:
pendingRefreshes.current = newCount

// CORRECT — accumulates across concurrent callers:
pendingRefreshes.current += newCount
```

**The cache-first + background refresh pattern for Electron IPC:**
```typescript
// Main process handler:
ipcMain.handle('ipc:ps:get-devices', async () => {
  const cached = getCached(db, 'cache_db_devices')
  if (cached) {
    setImmediate(async () => {
      try {
        const r = await runPsScript('Get-IntuneDevices.ps1', [])
        const fresh = r.result ?? { success: false, devices: [] }
        if ((fresh as any).success) saveCache(db, 'cache_db_devices', fresh)
        sendToRenderer('ipc:cache:devices-updated', fresh)  // guarded
      } catch (e) {
        sendToRenderer('ipc:cache:devices-updated', { success: false, error: String(e) })
      }
    })
    return { ...cached, fromCache: true }
  }
  const result = await runPsScript('Get-IntuneDevices.ps1', [])
  const data = result.result ?? { success: false, devices: [] }
  if ((data as any).success) saveCache(db, 'cache_db_devices', data)
  return data
})

// Renderer — result processors as stable useCallbacks:
const applyDevicesResult = useCallback((data: GetDevicesRes) => {
  if (!data.success) return
  setDeviceSummary(...)  // process data
}, [])  // stable — only closes over setState functions

// Renderer — detect cache hits and subscribe to refresh events:
// In fetchSummary, after Promise.allSettled:
const cacheHits = results.filter(r => r.status === 'fulfilled' && (r.value as any).fromCache).length
if (cacheHits > 0) { pendingCacheRefreshes.current += cacheHits; setRefreshing(true) }

// In a separate useEffect:
const unsubs = [
  onCacheDevicesUpdated(data => { if (data.success) applyDevicesResult(data); decrement() }),
  // ... one per data type
]
return () => unsubs.forEach(fn => fn())
```

**The `applyXxxResult` pattern — share processing logic between initial fetch and cache update events:**
Extracting result processing into stable `useCallback` functions avoids duplicating 200+ lines of processing logic between `fetchSummary` and event handlers. Since these functions only close over `setState` functions (which are stable), they can have empty dependency arrays and stay stable across renders.

### Technical Patterns Established

| Pattern | Implementation |
|---------|----------------|
| `sendToRenderer` window guard | `if (!win.isDestroyed()) win.webContents.send(channel, data)` — in the function body, not at call sites |
| Pending in-flight counter | `pendingRef.current += n` (not `= n`); decrement on each event; `setSpinner(false)` when counter reaches 0 |
| Cache key convention | `cache_db_<datatype>` in `app_settings` table — all cleared together via `WHERE key LIKE 'cache_db_%'` |
| Result processor pattern | `const applyFooResult = useCallback((data: FooRes) => { if (!data.success) return; setState... }, [])` — stable, reusable in both fetchSummary and event handlers |
| Background refresh emit rule | Always emit event (even on failure) so `decrement()` fires and spinner clears; apply functions ignore failures safely |
| TypeScript fromCache? | Add to all affected response interfaces; use `(value as unknown as Record<string, unknown>).fromCache` to avoid type overlap error in mixed union arrays |

---

## Lesson 010 — Stale Compiled .js Files Shadowing TypeScript Source (2026-04-02)

### Keywords
`vite`, `typescript`, `tsc`, `noEmit`, `js files`, `shadow`, `compiled artifacts`, `extension resolution`, `electron`, `build script`

### What Happened
Multiple sessions of TypeScript changes (Dashboard v2, caching, new user setup) appeared to have no effect when running the app. Root cause: `package.json` build script ran a bare `tsc` command (no `--noEmit`, no `outDir` in `tsconfig.json`), which emitted compiled `.js` files directly into `src/` alongside the `.tsx` source files. Vite resolves `.js` before `.tsx` in its default extension resolution order (`['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', ...]`), so ALL TypeScript changes were silently ignored — the app ran the old stale compiled `.js` files throughout.

### Anti-Pattern (Why It Happened)
`tsconfig.json` had no `outDir` and no `noEmit`, so TypeScript defaulted to emitting next to source files. The build script intended `tsc` as a type-check step only, but without `--noEmit`, it emitted `.js` artifacts. The `.js` files were committed to the repo (no `.gitignore`), and over time became stale relative to the `.tsx` source.

**The silent failure mode is particularly dangerous:** Vite loads the stale `.js` file without warning. The app runs, just without any of your recent changes.

### Heuristic (Prevention)

1. **Always add `"noEmit": true` to `tsconfig.json`** for any project where Vite (or another bundler) handles the build. TypeScript should only type-check; the bundler bundles.
2. **Always use `tsc --noEmit` in build scripts**, never bare `tsc`, unless you explicitly want `.js` output to a separate `outDir`.
3. **Add `src/**/*.js` to `.gitignore`** (when `src/` contains only `.ts`/`.tsx` source files) to prevent compiled artifacts from being committed.
4. **If a code change appears to have no effect**, immediately check for `.js` shadow files with the same basename as your `.ts`/`.tsx` files.

### Technical Patterns Established

| Pattern | Rule |
|---------|------|
| tsconfig.json for Vite projects | Always include `"noEmit": true` |
| build script type-check | Use `tsc --noEmit` not `tsc` |
| Extension shadowing diagnosis | Run `find src -name "*.js"` and compare to `.tsx` counterparts when changes have no effect |
| Cleanup command | `find src -name "*.js" -exec rm {} \;` (after adding noEmit to prevent regeneration) |

---

## Lesson 011 — Azure Container Apps Deployment: Provisioning & CI/CD Anti-Patterns (2026-04-06)

### Keywords
`azure`, `app-service`, `container-apps`, `quota`, `serverless`, `docker`, `prisma`, `provisioning`, `pivot-rule`, `github-actions`, `ghcr`, `buildx`, `npm-ci`, `dockerignore`, `key-vault`, `rbac`, `sql-server`, `database-url`, `p1000`, `pwsh`

### What Happened

Deployed IntuneManager as a containerised web application on Azure Container Apps. The path from plan to running container involved 12+ corrective adjustments across Azure provisioning, Dockerfile authoring, and GitHub Actions pipeline configuration.

**Provisioning failures (5 iterations before architecture pivot):**
1. `--is-windows` flag: not recognised by installed Azure CLI version
2. `--os-type Windows`: also not recognised
3. P2v3 App Service quota = 0 (UK South)
4. S2 Standard quota = 0 (UK South + East US)
5. B1 Basic quota = 0 everywhere → Pivot to Azure Container Apps (Consumption)

**Provisioning failures (post-pivot):**
6. Key Vault `MissingSubscriptionRegistration` — provider not registered
7. Key Vault `az keyvault set-policy` rejected — RBAC mode; must use `az role assignment create`
8. Key Vault `ForbiddenByRbac` seeding secrets — role not propagated yet; must wait ~30 seconds
9. Azure SQL blocked in East US + East US 2 — moved to West US 2

**Dockerfile / GitHub Actions failures:**
10. GHA Docker cache backend fails without Buildx (`docker/setup-buildx-action@v3` missing)
11. `npm ci` fails — project has no `package-lock.json`; must use `npm install`
12. `electron/ps-scripts/` excluded by `.dockerignore` `electron/` rule — needs `!electron/ps-scripts/` exception
13. `DATABASE_URL` empty string in GitHub Actions — secret not yet added
14. `P1000: Authentication failed` — `DATABASE_URL` secret has wrong password for `intuneadmin`

The Pivot Rule was triggered after adjustment #2 but not acted on until adjustment #4 — two pivots too late.

### Anti-Pattern (Why It Happened)

**Tactical fixes without strategic re-evaluation.** Each quota failure prompted a narrow fix (different SKU, different region) rather than stepping back to ask "Is App Service right at all?" A quota of 0 across 3 tiers and 2 regions is a signal to abandon the service class, not retry it.

**Region not a pre-flight decision.** Provisioning started in UK South when East US was the requirement. The region should be locked before writing the first command.

**`$ErrorActionPreference = "Stop"` treats az CLI warnings as fatal.** Azure CLI emits deprecation warnings on stderr. With Stop mode enabled, these become terminating errors in PowerShell, aborting provisioning at unrelated cleanup steps. Use `Continue` for cleanup phases.

**Em dash `—` (U+2014) in PowerShell scripts without UTF-8 BOM.** PS reads files without BOM as Windows-1252 ANSI, which misinterprets multi-byte characters and breaks string parsing. Always use plain ASCII in PS scripts; if Unicode is needed, save with UTF-8 BOM.

**DATABASE_URL built during provisioning prompt may not match what was actually committed.** The SQL Server and the DATABASE_URL secret were provisioned in separate steps with separate password prompts. Mismatched passwords are not caught until prisma db push runs in CI/CD.

### Heuristic (Prevention)

1. **Region is a pre-flight decision.** Lock the target region before writing the first provisioning command.
2. **Quota = 0 on first attempt → stop and re-evaluate the service.** Do not retry the same service class with a different tier or region.
3. **New Azure Key Vaults default to RBAC mode.** Never use `az keyvault set-policy` — use `az role assignment create --role "Key Vault Secrets Officer/User"` instead.
4. **After granting RBAC roles, wait 30 seconds before using them.** Role propagation is asynchronous; immediate use returns `ForbiddenByRbac`.
5. **Check for `package-lock.json` before using `npm ci` in Dockerfiles.** Projects without lock files must use `npm install`. `npm ci` exits 1 immediately with no lock file.
6. **Add `docker/setup-buildx-action@v3` before `docker/build-push-action`.** The GHA cache backend (`type=gha`) requires the `docker-container` Buildx driver; the default `docker` driver doesn't support cache export.
7. **Test `.dockerignore` exceptions with real paths.** `electron/` excludes everything including subdirs. `!electron/ps-scripts/` re-includes only that subtree. Test with `docker build --dry-run` or check layer contents.
8. **After provisioning, verify DATABASE_URL auth independently** before adding it to GitHub Secrets. Run `sqlcmd -S <server> -U intuneadmin -P <pwd> -Q "SELECT 1"` or use Azure portal to confirm credentials work.
9. **To recover from wrong DATABASE_URL password:** `az sql server update --name <server> --resource-group <rg> --admin-password <new>`, then update the GitHub secret and re-run the workflow.

### Technical Patterns Established

| Pattern | Rule |
|---|---|
| Azure CLI flag validation | Run `az <command> --help` before using any non-standard flag in a script |
| Serverless-first for new subscriptions | Free/trial Azure subscriptions have near-zero compute quotas. Default to Container Apps (Consumption) + SQL Serverless for all new deployments |
| Key Vault access control | Use `az role assignment create` with "Key Vault Secrets Officer" (admin) and "Key Vault Secrets User" (MI). Never `az keyvault set-policy` on RBAC-enabled vaults |
| RBAC propagation wait | `Start-Sleep -Seconds 30` after `az role assignment create` before first use of the granted permission |
| PS `$ErrorActionPreference` | Use `Stop` for provisioning steps; use `Continue` for cleanup sections where az CLI warnings are expected |
| Dockerfile path resolution | Replicate dev directory structure in Docker (`server/dist/` at sub-path) so `__dirname`-relative paths resolve identically in dev and container |
| Prisma in Docker | `binaryTargets = ["native", "debian-openssl-3.0.x"]` for `node:20-slim`. Run `npx prisma generate` in the builder stage |
| Prisma on fresh database | No `prisma/migrations/` = use `prisma db push --skip-generate --accept-data-loss`. Switch to `prisma migrate deploy` after generating migrations locally |
| PS bridge cross-platform | `process.platform === 'win32' ? 'powershell.exe' : 'pwsh'` — never hardcode `powershell.exe` in server-side code |
| GHA Docker cache | Always include `docker/setup-buildx-action@v3` before `docker/build-push-action@v5` |
| npmci vs npm install | `npm ci` requires `package-lock.json` or `yarn.lock`. If the project has no lock file, use `npm install` in Dockerfiles and CI steps |
| DATABASE_URL validation | After provisioning SQL Server, independently verify the admin credentials before storing in GitHub Secrets |

---

## Lesson 012 — Phase 3: MSAL.NET → @azure/msal-node OAuth2 Migration (2026-04-07)

### Keywords
`azure`, `msal-node`, `oauth2`, `authorization-code-flow`, `device-code-flow`, `token-encryption`, `graph-api`, `powershell-token-injection`, `phase3`, `container-apps`, `linux`, `dpapi`

### What Happened

Replaced PS-based MSAL.NET tenant authentication with server-side `@azure/msal-node` OAuth2 to fix tenant auth in the Linux Docker container. The root cause of the original failure: `Microsoft.Identity.Client.dll` (MSAL 4.43.2) targets `.NET Framework 4.6.1` — it cannot be loaded by `pwsh` on Linux which uses `.NET Core`. DPAPI (used for token cache encryption in `Auth.psm1`) is also Windows-only.

The Phase 3 solution keeps PS scripts for Graph API calls but removes MSAL from their responsibility entirely. The server fetches tokens via `@azure/msal-node` and injects them into each PS script call.

### Anti-Pattern (Why It Happened)

**The PS script layer was responsible for both authentication and data fetching.** This works on Windows (PS 5.1 + MSAL.NET + DPAPI), but the tight coupling makes auth impossible to fix without touching every script. Separating auth (server) from data fetching (PS) at Phase 2 would have been cleaner, but was deferred as technical debt.

**DPAPI is a Windows-only API.** Any token cache that uses DPAPI is silently non-functional on Linux. There is no DPAPI equivalent on Linux — token persistence must use a different mechanism (here: AES-256-CBC with app secret + DB storage).

### Heuristic (Prevention)

1. **When targeting Linux/cross-platform, never use DPAPI or .NET Framework DLLs for token caching.** Use a database or file with AES encryption keyed by an env var secret.
2. **Authentication should be a server-layer concern, not a script concern.** Scripts should receive a pre-validated token as a parameter, not manage their own auth lifecycle.
3. **Check DLL target frameworks before deploying PS modules to Linux.** `[System.Reflection.Assembly]::LoadFile('path.dll').ImageRuntimeVersion` returns `v4.0.30319` for .NET Framework, which fails on Linux `pwsh`.
4. **`acquireTokenByDeviceCode` is blocking — it polls until the user completes auth or the code expires.** Wrap it in a Promise that resolves immediately with the code info (resolving from the `deviceCodeCallback`), then lets the token acquisition continue in the background.

### Technical Patterns Established

| Pattern | Implementation |
|---------|----------------|
| MSAL ConfidentialClientApplication setup | `new msal.ConfidentialClientApplication({ auth: { clientId, authority: 'https://login.microsoftonline.com/organizations', clientSecret } })` — use `organizations` authority for multi-tenant delegated access |
| OAuth2 Authorization Code Flow | `getAuthCodeUrl({ scopes, redirectUri, state })` → redirect browser → `acquireTokenByCode({ code, scopes, redirectUri })` |
| Device code flow (non-blocking return) | Resolve the outer Promise inside `deviceCodeCallback` with `{ userCode, verificationUri, message }`; let `acquireTokenByDeviceCode` polling continue async; save tokens in `.then()` |
| Token refresh pattern | Check `token_expiry` from DB; if >5 min remaining, decrypt and return; else call `acquireTokenByRefreshToken({ refreshToken, scopes })` and save new tokens |
| Token storage in DB | `encrypt(accessToken)` + `encrypt(refreshToken)` stored in `tenant_config.access_token` / `tenant_config.refresh_token`; `token_expiry` as ISO string. Use existing `encryption.ts` (AES-256-CBC keyed by `APP_SECRET_KEY`) |
| PS token injection | Server calls `getAccessToken()` before each Graph PS route; passes result as `['-AccessToken', token]` to `runPsScript()` |
| `Set-GraphAccessToken` pattern (PS) | Add `$script:InjectedToken = $null` module variable + `Set-GraphAccessToken` function to `GraphClient.psm1`; in `Invoke-GraphRequest`: `$token = if ($script:InjectedToken) { $script:InjectedToken } else { Get-ValidAccessToken }` |
| PS script backward compatibility | Add `[string]$AccessToken = ''` to each script's `param()` block + `if ($AccessToken) { Set-GraphAccessToken -Token $AccessToken }` after imports — scripts still work on Windows desktop (no token passed) |
| GraphAuthError sentinel | Export a named error class `GraphAuthError extends Error` from `graph-auth.ts`; catch it in routes and return 401 rather than 500 |
| Azure AD App Registration requirement | OAuth2 Authorization Code + Device Code flows require a registered app with a client ID + secret. This is a manual Azure portal step that cannot be automated. Document it prominently as a prerequisite before the first deploy |

### Addendum — AADSTS7000218 and msal-node PKCE Auto-Injection (2026-04-07)

After implementing the above patterns with `@azure/msal-node`, every token exchange returned `AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'` even though the CCA was configured with a `clientSecret`.

**Root cause:** `@azure/msal-node` v2.x `ConfidentialClientApplication.getAuthCodeUrl()` **automatically adds PKCE parameters** (`code_challenge`, `code_challenge_method=S256`) to the authorization URL, even when not explicitly requested and even on confidential clients that should use `client_secret` instead. When `acquireTokenByCode` runs in the subsequent request, it creates a **new CCA instance** (stateless server) that has no knowledge of the PKCE verifier generated in the first instance. Azure AD receives a token request with a `code_challenge` in the auth URL but no `code_verifier` in the token request — and because the PKCE pair is incomplete, MSAL omits `client_secret` entirely, triggering AADSTS7000218.

**Storing the PKCE verifier in the DB and passing it to `acquireTokenByCode` did not resolve the issue** — MSAL's internal state management still caused `client_secret` to be omitted.

**Resolution:** Replaced `@azure/msal-node` entirely with direct HTTP `fetch()` calls to Microsoft's OAuth2 endpoints (`https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` and `.../token`). `getAuthUrl()` builds a plain authorization URL with no PKCE parameters. `handleCallback()` POSTs `client_secret` explicitly in the request body as a `URLSearchParams`. This gives full control over every parameter sent to Azure AD and reliably produces a valid token exchange.

**New heuristic:** When a confidential client (app registration with `client_secret`) needs Authorization Code Flow on a stateless server, **do not use `@azure/msal-node` v2.x** — use direct HTTP to the token endpoint and include `client_secret` explicitly. MSAL's PKCE auto-injection makes stateless confidential client flows unreliable. The public client equivalent (device code flow, `14d82eec` Graph PowerShell ID) avoids this problem entirely because it has no secret.

| Pattern | Implementation |
|---------|----------------|
| Direct HTTP auth URL (no PKCE) | `new URLSearchParams({ client_id, response_type: 'code', redirect_uri, scope, response_mode: 'query', state })` → `${AUTHORITY}/authorize?${params}` |
| Direct HTTP token exchange | POST `${AUTHORITY}/token` with `Content-Type: application/x-www-form-urlencoded`; body includes `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type: 'authorization_code'`, `scope` |
| Direct HTTP refresh | POST `${AUTHORITY}/token` with `client_id`, `client_secret`, `refresh_token`, `grant_type: 'refresh_token'`, `scope` |
| Direct HTTP device code | POST `${AUTHORITY}/devicecode` with `client_id`, `scope` → get `device_code`, `user_code`, `verification_uri`; poll `${AUTHORITY}/token` with `grant_type: urn:ietf:params:oauth:grant-type:device_code` |

---

## Lesson Template (copy for new entries)

```
## Lesson 00X — [App/Task] ([Date])

### Keywords
`keyword1`, `keyword2`

### What Happened
[Description of the mistake or gap]

### Anti-Pattern (Why It Happened)
[Root cause — the "why"]

### Heuristic (Prevention)
[Concrete rule to prevent recurrence]

### Technical Patterns Established
[Any reusable patterns discovered]
```
