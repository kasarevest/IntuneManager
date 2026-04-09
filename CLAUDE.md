# CLAUDE.md — IntuneManager

> AI-powered Intune management tool. Electron + React desktop app / containerised Express + React web app.
> Full project context: `docs/PROJECT_OVERVIEW.md` | Workflow rules: `docs/WORKFLOW.md`

---

## Quick Orientation

| Component | Path | Runtime |
|-----------|------|---------|
| React UI | `IntuneManagerUI/src/` | Vite + React 18 |
| Express server (web) | `IntuneManagerUI/server/` | Node 20 + Prisma + Azure SQL |
| Electron shell (desktop) | `IntuneManagerUI/electron/` | Electron 32, Win32 only |
| PS bridge scripts | `IntuneManagerUI/electron/ps-scripts/` | pwsh 7 (Linux) / powershell.exe 5.1 (Win) |
| PS module library | `IntuneManager/Lib/` | Used by scripts via `Import-Module` |
| Deployed URL | `https://ca-intunemanager-prod.yellowforest-c85ceb60.eastus.azurecontainerapps.io` | Azure Container Apps |

**Two build targets:**
- `npm run build` → Electron desktop (Windows)
- `npm run build:web` → Express + React SPA (Docker/Linux)

CI/CD: push to `master` → GitHub Actions → Docker build → GHCR → `prisma db push` → Container Apps update.

---

## PS Bridge Protocol

All PowerShell scripts communicate with Node via stdout conventions. **Never break this contract.**

```
LOG:[INFO] Some message      → forwarded to job event stream
LOG:[ERROR] Failure detail   → forwarded as error log
RESULT:{"success":true,...}  → terminal JSON return value (one line, at end)
```

- Scripts **must** emit exactly one `RESULT:` line as their last meaningful output.
- `runPsScript()` in `server/services/ps-bridge.ts` parses these; other output is silently ignored.
- Always pass `-AccessToken` to Graph scripts — server injects the token via `getAccessToken()` before calling the script; the script **does not do its own auth**.
- Kill on cancellation: `taskkill /pid /f /t` (Win32) or `kill -9` (Linux). Already handled in `ps-bridge.ts`.
- **Timeout:** `runPsScript()` accepts `timeoutMs` (default 60 000 ms). Always add `-TimeoutSec` to `Invoke-RestMethod` calls inside scripts (20 s for reads, 30 s for writes) or Envoy proxy will kill the connection with a 503 before Node does.

---

## Key Patterns & Gotchas

### CSS Global Override — `width: 100%` on all inputs
`src/styles/global.css` applies `width: 100%` to every `input`, `select`, and `textarea`. Any inline flex row containing a checkbox or select **must** override with `style={{ width: 'auto', flexShrink: 0 }}` or the element expands to fill the row and hides everything after it.

### Envoy Proxy 503 — "upstream connect error"
Azure Container Apps' Envoy proxy cuts connections before Express responds when a PS script hangs. Always:
1. Set `runPsScript(..., timeoutMs)` to something shorter than the proxy timeout (~60 s).
2. Add `-TimeoutSec` to `Invoke-RestMethod` inside the PS script.
3. Wrap route handlers in `try/catch` and return JSON errors, not unhandled promise rejections.

### Graph API — Batch Assignments
Use the `/assign` action for Intune app group assignments. A single POST with all assignments is faster and avoids N sequential calls timing out:
```
POST /beta/deviceAppManagement/mobileApps/{appId}/assign
Body: { mobileAppAssignments: [ { @odata.type, intent, target: { @odata.type, groupId } } ] }
```

### Graph API — OAuth Scopes
Adding a new Graph operation requires adding its scope to `server/services/graph-auth.ts` `SCOPES` array **and** the user must re-authenticate. Current required scopes are documented in that file.

### PS Scripts — `New-Win32App.ps1`
Does NOT use `ConvertTo-Json` or CLI arg passing for the request body. It reads JSON from a temp file and POSTs raw UTF-8 bytes via `[System.Net.HttpWebRequest]`. Reason: PS 5.1 CLI arg mangling + single-element array collapse. Do not change this pattern.

### `Promise.allSettled` vs `Promise.all`
When loading from multiple sources where one can fail independently (e.g., Graph API + local DB for recent groups), use `Promise.allSettled`. `Promise.all` silently prevents the fulfilled results from being set if any one source rejects.

### Non-JSON Responses (parseJson helper)
Azure proxy can return plain text `"upstream connect error..."` where JSON is expected. Use the `parseJson<T>` helper in `src/lib/api.ts` (reads as text first, then parses) rather than `.json()` directly.

### WinTuner Deploy Pattern
WinTuner scripts use `Connect-WtWinTuner -Token $AccessToken` for auth, not PS module MSAL. Each WinTuner operation is a single call, not a multi-step pipeline. Do not replicate N-sequential-call patterns for WinTuner.

---

## File Map (Key Files)

```
IntuneManagerUI/
├── electron/ps-scripts/         ← All PS bridge scripts (18+). Deployed into Docker container.
├── server/
│   ├── services/
│   │   ├── ps-bridge.ts         ← runPsScript() — spawn PS, parse LOG/RESULT, timeout, kill
│   │   ├── graph-auth.ts        ← getAccessToken(), SCOPES, token refresh, OAuth flows
│   │   └── cache.ts             ← Prisma key-value cache (replaces SQLite in web mode)
│   ├── routes/
│   │   ├── ps.ts                ← All PS proxy endpoints (inject -AccessToken before each call)
│   │   └── ai.ts                ← AI agent endpoints + SSE job streaming
│   └── prisma/schema.prisma     ← SQL Server schema (binaryTargets: native + debian-openssl-3.0.x)
├── src/
│   ├── lib/
│   │   ├── api.ts               ← All frontend API calls (includes parseJson<T> helper)
│   │   └── sse.ts               ← SSE subscription helpers (onJobComplete, onJobLog, etc.)
│   ├── types/ipc.ts             ← All IPC request/response types
│   ├── styles/global.css        ← CRITICAL: sets width:100% on all input/select/textarea
│   └── pages/
│       ├── Deploy.tsx           ← Job execution + AssignmentModal trigger after success
│       └── AppCatalog.tsx       ← Discovery + deploy modal launch
└── components/
    └── AssignmentModal.tsx      ← Group search/select/assign (post-deploy)
```

---

## Workflow Orchestration

### 1. Adaptive Planning & Context Guardrails
- **3-Step Trigger:** Enter Plan Mode for any task involving 3+ steps or architectural decisions.
- **Context Pruning:** Explicitly list irrelevant files/modules before starting to prevent context drift.
- **The Pivot Rule:** If a plan requires >2 on-the-fly adjustments, STOP. Re-map the dependency graph and re-plan.
- **Verification Specs:** Write specs upfront that include *how* to verify, not just *what* to build.

### 2. Peer Reviewer Pattern
- Assign one subagent to implement, a second independent subagent to critique.
- Subagents report results in structured JSON/Markdown to keep the main context clean.
- One task per subagent.

### 3. Automated Self-Improvement Loop
- After any correction, update `tasks/lessons.md` with the Anti-Pattern and the Heuristic.
- Query `lessons.md` for relevant keywords at the start of every session.
- If a bug recurs, perform a "5 Whys" analysis before implementing the fix.

### 4. Continuous Verification
- **Side-Effect Audit:** For every change, list three potential downstream breakages.
- **The Staff Engineer Bar:** Ask — will this require a comment to explain why it's not a bug?
- **Evidence of Correctness:** Provide logs, diffs, or stdout proving the change works.

### 5. Pragmatic Elegance
- Copy code twice? Fine. Third time: abstract.
- If a hacky fix is necessary, document the trade-off inline.
- Self-challenge: find a more elegant solution before presenting. Skip over-engineering for simple fixes.

---

## Task Management — Flight Checklist

| Phase | Action | Requirement |
|-------|--------|-------------|
| **Pre-Flight** | Plan First | Write plan to `tasks/todo.md` with checkable items and risk assessment |
| **In-Flight** | Atomic Updates | Mark items complete and provide high-level summaries at each step |
| **Verification** | Verify Plan | Check in with the user before starting heavy implementation |
| **Post-Flight** | Document Results | Add a review section to `tasks/todo.md` and demonstrate correctness |
| **Debrief** | Capture Lessons | Update `tasks/lessons.md` with the specific heuristic learned |

---

## Core Principles

- **Simplicity First:** Make every change as simple as possible. Impact minimal code.
- **No Ghost Fixes:** Never fix a bug without identifying the root cause. If you can't explain why it broke, you haven't fixed it.
- **Readability is a Feature:** Optimize for the next developer.
- **Zero Context Switching:** Resolve bugs autonomously using logs and failing tests. Do not ask for hand-holding.
- **Total Ownership:** A fix that breaks a downstream dependency is a failure, not a completion.

---

## Deployment Checklist (Web Mode)

Before pushing to `master`:
1. New PS script? Verify it ends with `RESULT:` line and has `-TimeoutSec` on all `Invoke-RestMethod` calls.
2. New Prisma model? Verify `schema.prisma` has `binaryTargets = ["native", "debian-openssl-3.0.x"]`.
3. New Graph operation? Add required scope to `graph-auth.ts` SCOPES.
4. New route? Add `try/catch` and return `res.json({ success: false, error: ... })` on failure, not unhandled rejection.
5. New input/checkbox/select in a flex row? Add `style={{ width: 'auto' }}` to override the global CSS.
