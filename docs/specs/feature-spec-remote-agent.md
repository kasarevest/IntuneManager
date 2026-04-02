# Feature Spec: IntuneManager Remote Agent

**Status:** Planned  
**Author:** kasarevest  
**Last Updated:** 2026-04-02  
**Target Milestone:** v2.0

---

## 1. Overview

### Problem

IT administrators managing Vestmark's Intune endpoint fleet have no in-tool way to connect to an individual device for diagnosis or remediation. Current options require either:
- VPN + WinRM (requires network line-of-sight, firewall exceptions, WinRM enabled per device)
- Intune Device Scripts (one-shot, async, no interactive response, 15-min latency minimum)
- Microsoft Remote Help (requires separate paid add-on license)
- RDP via VPN (heavy, slow to set up, requires separate tooling)

### Goal

Deliver two remote management capabilities accessible directly from the IntuneManager `Devices` page:

1. **PowerShell Terminal** — an interactive terminal window inside IntuneManager that streams a live PS session to/from the target device
2. **Remote Desktop** — a VNC-based screen sharing view of the target device, rendered inside IntuneManager

Both capabilities work regardless of whether the admin and device are on the same network, VPN, or internet.

### Non-Goals

- This is NOT a replacement for Microsoft Remote Help (no audio, no UAC elevation prompting, no annotation)
- This is NOT a full RDP implementation (no RemoteFX, no USB redirection, no printer forwarding)
- This does NOT require Domain join or Azure AD join beyond what Intune already requires
- This does NOT expose a general-purpose remote management API to external systems

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  IntuneManager App (Electron)                                │
│                                                              │
│  Devices page                                                │
│    ├── [Connect PS] button per device                        │
│    └── [Remote Desktop] button per device                    │
│                                                              │
│  /remote-terminal?deviceId=                                  │
│    └── xterm.js terminal component                           │
│                                                              │
│  /remote-desktop?deviceId=                                   │
│    └── noVNC WebView component                               │
│                                                              │
│  electron/relay/relay-client.ts                              │
│    └── WebSocket client → Relay Server                       │
│                                                              │
│  electron/ipc/agent.ts                                       │
│    └── IPC handlers for terminal + desktop sessions          │
└──────────────────────────────┬───────────────────────────────┘
                               │ WSS (TLS 1.3)
                    ┌──────────▼──────────┐
                    │   Relay Server       │
                    │   (Node.js/TS)       │
                    │                     │
                    │  /ws/admin           │  ← Admin connects
                    │  /ws/device          │  ← Agent connects
                    │  /api/token          │  ← Token issuance
                    │                     │
                    │  In-memory device    │
                    │  registry            │
                    │  Message router      │
                    └──────────┬──────────┘
                               │ WSS (TLS 1.3)
┌──────────────────────────────▼───────────────────────────────┐
│  Managed Device (Windows 10/11)                              │
│                                                              │
│  IntuneAgent Windows Service                                 │
│    ├── RelayConnection.cs — WebSocket client + reconnect     │
│    ├── ShellSession.cs    — PS runspace + stdout streaming   │
│    └── VncSession.cs      — TightVNC server lifecycle + RFB  │
│                             frame proxy                      │
│                                                              │
│  Registry: HKLM\SOFTWARE\IntuneAgent                        │
│    └── DeviceToken (DPAPI-encrypted)                         │
└──────────────────────────────────────────────────────────────┘
```

### Component Inventory

| Component | Language | Location | New / Modified |
|-----------|----------|----------|----------------|
| Relay Server | TypeScript (Node.js) | `RelayServer/` | New project |
| IntuneAgent Windows Service | C# .NET 8 | `IntuneAgent/` | New project |
| Agent PS install scripts | PowerShell 5.1 | `Source/IntuneAgent/` | New |
| `electron/relay/relay-client.ts` | TypeScript | `IntuneManagerUI/` | New |
| `electron/ipc/agent.ts` | TypeScript | `IntuneManagerUI/` | New |
| `src/pages/RemoteTerminal.tsx` | React/TSX | `IntuneManagerUI/` | New |
| `src/pages/RemoteDesktop.tsx` | React/TSX | `IntuneManagerUI/` | New |
| `src/types/agent.ts` | TypeScript | `IntuneManagerUI/` | New |
| `src/lib/ipc.ts` | TypeScript | `IntuneManagerUI/` | Modified |
| `src/types/ipc.ts` | TypeScript | `IntuneManagerUI/` | Modified |
| `src/pages/Devices.tsx` | React/TSX | `IntuneManagerUI/` | Modified |
| `src/App.tsx` | React/TSX | `IntuneManagerUI/` | Modified |
| `src/settings/GeneralTab.tsx` | React/TSX | `IntuneManagerUI/` | Modified |
| `electron/ipc/settings.ts` | TypeScript | `IntuneManagerUI/` | Modified |
| `db/schema.sql` | SQL | `IntuneManagerUI/` | Modified |

---

## 3. Security Model

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized admin connects to a device | Relay validates admin JWT (signed with `RELAY_SECRET`); admin JWT only issued to users with `admin` or `superadmin` role |
| Agent connects to a spoofed relay server | Agent pins the relay's TLS certificate SHA-256 fingerprint at install time; rejects connections if fingerprint changes |
| Device token exfiltrated from registry | Token stored DPAPI-encrypted (`ProtectedData.Protect`, `LocalMachine` scope); readable only by SYSTEM or admin-level processes |
| Man-in-the-middle on relay traffic | All traffic is WSS (WebSocket over TLS 1.3); relay uses a CA-signed certificate |
| Replay attack using captured admin JWT | Admin JWTs expire after 15 minutes; relay validates `exp` claim |
| Lateral movement via PS runspace | PS runs as the service's account (SYSTEM by default, configurable); no network credentials forwarded |
| VNC screen exposure to relay operator | VNC stream is AES-256-GCM end-to-end encrypted with a session key established via Diffie-Hellman; relay only routes opaque bytes |
| Prompt injection: malicious script output tricks the terminal | Terminal renders output as plain text only (xterm.js with `disableStdin` mode when viewing history); no HTML rendering |
| Admin installs agent on non-Intune device | Agent registration requires a valid Intune device ID verifiable against Graph API (relay checks on first connect) |

### Token Scheme

**Device Token**
```
deviceToken = HMAC-SHA256(RELAY_SECRET, deviceId + ":" + installTimestamp)
```
- Generated by `Install-IntuneAgent.ps1` at install time
- Stored in registry: `HKLM\SOFTWARE\IntuneAgent\DeviceToken` (DPAPI-encrypted)
- Permanent (does not expire); relay can revoke by removing the device registration

**Admin JWT**
```json
{
  "sub": "username",
  "role": "admin",
  "iat": 1743600000,
  "exp": 1743600900
}
```
- Issued by relay's `POST /api/auth/admin-token` endpoint
- Request authenticated by the IntuneManager local session token (bcrypt-validated by the relay calling back to IntuneManager's `ipc:auth:validate-session` equivalent)
- Signed with `RELAY_SECRET` (HS256)
- 15-minute expiry; auto-refreshed while session is active

**VNC Session Key**
```
ECDH P-256 ephemeral key pair negotiated per VNC session
Derived shared secret → HKDF → AES-256-GCM session key
```
- Negotiated inline in the `vnc:start` / `vnc:session-key` handshake
- The relay never sees the plaintext VNC frames

---

## 4. Relay Server Specification

### Technology

- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript
- **Framework:** `ws` (WebSocket library) + `express` (HTTP API)
- **Auth:** `jsonwebtoken` (JWT sign/verify)
- **Crypto:** Node.js built-in `crypto` (HMAC, AES-GCM)
- **Deployment:** Docker container → Azure Container Apps (or any VPS with Docker)

### HTTP API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | None | Liveness probe |
| `POST` | `/api/auth/admin-token` | Session token in body | Issue 15-min admin JWT |
| `GET` | `/api/devices` | Admin JWT header | List online devices |
| `DELETE` | `/api/devices/:deviceId` | Admin JWT header | Revoke device registration |

### WebSocket Endpoints

| Path | Auth | Who connects |
|------|------|-------------|
| `/ws/device` | Device token (query param `?token=`) | IntuneAgent service |
| `/ws/admin` | Admin JWT (query param `?token=`) | IntuneManager Electron app |

### Message Protocol

All messages are JSON. Every message has a `type` field.

#### Device → Relay

| Type | Fields | Description |
|------|--------|-------------|
| `device:register` | `deviceId`, `token`, `hostname`, `osVersion` | First message after WS connect; relay authenticates token |
| `device:heartbeat` | — | Sent every 30 s; relay updates `lastSeen` |
| `shell:output` | `sessionId`, `data` (string), `isStderr` (bool) | Streamed PS output |
| `shell:exit` | `sessionId`, `exitCode` | PS runspace closed |
| `vnc:ready` | `sessionId`, `width`, `height` | VNC server started and listening |
| `vnc:frame` | `sessionId`, `data` (base64 AES-GCM ciphertext) | RFB frame chunk |
| `vnc:session-key` | `sessionId`, `publicKey` (base64 ECDH public key) | Device's ECDH public key for session key derivation |

#### Relay → Device (forwarded from admin)

| Type | Fields | Description |
|------|--------|-------------|
| `shell:start` | `sessionId`, `command` | Open PS runspace, execute command |
| `shell:input` | `sessionId`, `data` | Send stdin to running PS runspace |
| `shell:kill` | `sessionId` | Kill the PS runspace |
| `vnc:start` | `sessionId` | Start TightVNC server |
| `vnc:input` | `sessionId`, `event` | Forward mouse/keyboard event to VNC |
| `vnc:stop` | `sessionId` | Stop TightVNC server |

#### Admin → Relay

| Type | Fields | Description |
|------|--------|-------------|
| `admin:list-devices` | — | Request online device list |
| `shell:start` | `deviceId`, `sessionId`, `command` | Start PS session on device |
| `shell:input` | `deviceId`, `sessionId`, `data` | Send stdin to device PS |
| `shell:kill` | `deviceId`, `sessionId` | Kill PS session on device |
| `vnc:start` | `deviceId`, `sessionId` | Start VNC session on device |
| `vnc:session-key` | `deviceId`, `sessionId`, `publicKey` | Admin ECDH public key |
| `vnc:input` | `deviceId`, `sessionId`, `event` | Forward input to device VNC |
| `vnc:stop` | `deviceId`, `sessionId` | Stop VNC session on device |

#### Relay → Admin

| Type | Fields | Description |
|------|--------|-------------|
| `device:online` | `deviceId`, `hostname`, `osVersion` | Device connected to relay |
| `device:offline` | `deviceId` | Device disconnected |
| `devices:list` | `devices[]` | Response to `admin:list-devices` |
| `shell:output` | `deviceId`, `sessionId`, `data`, `isStderr` | Forwarded from device |
| `shell:exit` | `deviceId`, `sessionId`, `exitCode` | Forwarded from device |
| `vnc:ready` | `deviceId`, `sessionId`, `width`, `height` | Forwarded from device |
| `vnc:frame` | `deviceId`, `sessionId`, `data` | Forwarded (opaque) from device |
| `vnc:session-key` | `deviceId`, `sessionId`, `publicKey` | Device's ECDH public key |
| `error` | `code`, `message` | Relay-level error |

### Relay File Structure

```
RelayServer/
├── src/
│   ├── index.ts           — Express + WS server bootstrap
│   ├── auth.ts            — JWT issuance + HMAC token verification
│   ├── router.ts          — Message routing (device ↔ admin)
│   ├── registry.ts        — In-memory device connection registry
│   ├── api.ts             — HTTP route handlers
│   └── types.ts           — Message type definitions
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

### Relay Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RELAY_SECRET` | Yes | 256-bit random hex string; used for HMAC and JWT signing |
| `PORT` | No (default 8080) | HTTP/WS listen port |
| `TLS_CERT_PATH` | Yes (production) | Path to TLS certificate PEM |
| `TLS_KEY_PATH` | Yes (production) | Path to TLS private key PEM |
| `CERT_FINGERPRINT` | Yes | SHA-256 fingerprint of TLS cert (for agent pinning) |

---

## 5. IntuneAgent Windows Service Specification

### Technology

- **Runtime:** .NET 8.0 (self-contained, no runtime installation needed)
- **Service framework:** `Microsoft.Extensions.Hosting.WindowsServices`
- **PS integration:** `Microsoft.PowerShell.SDK` NuGet package
- **WebSocket:** `System.Net.WebSockets.ClientWebSocket` (built-in)
- **Config:** `appsettings.json` in install directory
- **Crypto:** `System.Security.Cryptography` (built-in) + `System.Security.Cryptography.ProtectedData`

### Agent File Structure

```
IntuneAgent/
├── IntuneAgent.csproj
├── Program.cs              — Host builder, service registration
├── AgentService.cs         — IHostedService implementation; entry point
├── RelayConnection.cs      — WebSocket client; reconnect loop; message dispatch
├── ShellSession.cs         — PowerShell runspace lifecycle; output streaming
├── VncSession.cs           — TightVNC server process management; RFB proxy
├── SessionKeyExchange.cs   — ECDH P-256 key exchange; AES-GCM encrypt/decrypt
├── RegistryHelper.cs       — DPAPI read/write for DeviceToken
├── AgentConfig.cs          — Configuration model
└── appsettings.json        — RelayUrl, CertFingerprint (populated at install time)
```

### Agent Behaviour

**Startup sequence:**
1. Read `RelayUrl` and `CertFingerprint` from `appsettings.json`
2. Read `DeviceToken` from registry (DPAPI-decrypt)
3. Read `DeviceId` from registry (`HKLM\SOFTWARE\Microsoft\Provisioning\OMADM\MDMDeviceID` or Graph-reported Intune ID written at install time)
4. Enter reconnect loop:
   - Connect WebSocket to `RelayUrl/ws/device?token=<DeviceToken>`
   - Validate server TLS certificate fingerprint
   - Send `device:register` message
   - Enter message receive loop

**Reconnect policy:**
- On disconnect: exponential backoff starting at 5 s, max 5 min
- On `device:register` rejection (invalid token): log error, stop reconnecting, write event to Windows Event Log

**Shell session (`ShellSession.cs`):**
- On `shell:start`: create a new `PowerShell` runspace with `RunspaceConfiguration.Create()`
- Execute command asynchronously; stream `PSDataStreams.Output` and `Error` collections
- Each output object: `ToString()` → send `shell:output` message
- On `shell:kill` or runspace completion: send `shell:exit`, dispose runspace
- Max concurrent shell sessions: 5 (configurable)

**VNC session (`VncSession.cs`):**
- On `vnc:start`:
  1. Start `tvnserver.exe -service` (TightVNC bundled in `Assets/TightVNC/`) on `localhost:5900`
  2. Set a one-time session password (random 8 chars)
  3. Send `vnc:session-key` with agent's ECDH public key
  4. After key exchange: derive AES-256-GCM session key
  5. Connect local TCP socket to `127.0.0.1:5900`
  6. Read RFB frames in a loop; encrypt each chunk; send `vnc:frame`
- On `vnc:input`: decrypt event; forward to TightVNC via RFB input injection
- On `vnc:stop`: disconnect from TightVNC; stop `tvnserver.exe` process; send no further frames

**Certificate pinning (`RelayConnection.cs`):**
```csharp
handler.ServerCertificateCustomValidationCallback = (msg, cert, chain, errors) => {
    var fingerprint = cert.GetCertHashString(HashAlgorithmName.SHA256);
    return fingerprint.Equals(config.CertFingerprint, StringComparison.OrdinalIgnoreCase);
};
```

### Agent Install Package

**`Source/IntuneAgent/Install-IntuneAgent.ps1`**

1. Verify `IntuneAgent.exe` SHA256 matches manifest value
2. Create `C:\Program Files\IntuneAgent\` directory
3. Copy all agent files (exe, appsettings.json, TightVNC binaries) to install directory
4. Generate device token: `HMAC-SHA256(RELAY_SECRET_INSTALL_PARAM, DeviceId)`  
   *(The relay secret is passed as an install parameter from IntuneManager — never hardcoded)*
5. DPAPI-encrypt token; write to `HKLM\SOFTWARE\IntuneAgent\DeviceToken`
6. Write `DeviceId` to `HKLM\SOFTWARE\IntuneAgent\DeviceId`
7. Configure TightVNC: set `allowLoopback=1`, `loopbackOnly=1`, `AcceptRfbConnections=1`  
   *(TightVNC only listens on localhost — never exposed directly to the network)*
8. Register and start Windows service: `sc.exe create IntuneAgent binPath= "..." start= auto`
9. Write detection registry key: `HKLM\SOFTWARE\IntuneAgentInstaller\Version`
10. Exit 0

**`Source/IntuneAgent/Detect-IntuneAgent.ps1`**
- Checks `HKLM\SOFTWARE\IntuneAgentInstaller\Version` equals expected version
- Checks service `IntuneAgent` exists and is `Running`

**`Source/IntuneAgent/Uninstall-IntuneAgent.ps1`**
1. Stop service: `Stop-Service IntuneAgent -Force`
2. Delete service: `sc.exe delete IntuneAgent`
3. Stop TightVNC if running: `Stop-Process -Name tvnserver -Force`
4. Remove directory: `Remove-Item "C:\Program Files\IntuneAgent" -Recurse -Force`
5. Remove registry keys: `Remove-Item HKLM:\SOFTWARE\IntuneAgent -Recurse`
6. Remove detection key: `Remove-Item HKLM:\SOFTWARE\IntuneAgentInstaller -Recurse`

**`Source/IntuneAgent/PACKAGE_SETTINGS.md`** — standard format with install parameters documented.

---

## 6. IntuneManager Changes

### New Settings Fields

Two new fields added to `AppSettings` and `app_settings` DB table:

| Field | DB Key | Description |
|-------|--------|-------------|
| `relayServerUrl` | `relay_server_url` | WSS URL of the relay server (e.g. `wss://relay.example.com`) |
| `relaySecret` | `relay_secret_encrypted` | The relay's `RELAY_SECRET` — used to generate device tokens at agent packaging time. Stored AES-256-CBC encrypted. |

Displayed in Settings → General under a new **Remote Agent** card.

### New IPC Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `ipc:agent:connect-relay` | invoke | Connect/reconnect admin WebSocket to relay |
| `ipc:agent:disconnect-relay` | invoke | Disconnect from relay |
| `ipc:agent:get-online-devices` | invoke | Get list of devices currently connected to relay |
| `ipc:agent:shell-start` | invoke | Start PS session on device |
| `ipc:agent:shell-input` | invoke | Send stdin line to PS session |
| `ipc:agent:shell-kill` | invoke | Kill PS session |
| `ipc:agent:vnc-start` | invoke | Start VNC session on device |
| `ipc:agent:vnc-stop` | invoke | Stop VNC session |
| `agent:shell-output` | event (main → renderer) | Streamed PS output line |
| `agent:shell-exit` | event | PS session ended |
| `agent:device-online` | event | Device connected to relay |
| `agent:device-offline` | event | Device disconnected from relay |
| `agent:vnc-ready` | event | VNC session started on device |
| `agent:vnc-frame` | event | Decrypted VNC frame chunk |

### New Pages

**`/remote-terminal?deviceId=&sessionId=`**
- Full-screen dark terminal
- xterm.js (`@xterm/xterm` + `@xterm/addon-fit`)
- Topbar: device name, connection status indicator, Kill Session button, Back to Devices
- On mount: sends `ipc:agent:shell-start`; subscribes to `agent:shell-output` / `agent:shell-exit`
- User input → `ipc:agent:shell-input`
- On unmount: sends `ipc:agent:shell-kill`

**`/remote-desktop?deviceId=&sessionId=`**
- noVNC rendered inside a `<webview>` or `<canvas>`
- noVNC served from `electron/novnc/` (bundled local copy — no CDN dependency)
- Topbar: device name, latency indicator, Disconnect button, Back to Devices
- On mount: sends `ipc:agent:vnc-start`; listens for `agent:vnc-frame` events; feeds frames to noVNC canvas
- On unmount: sends `ipc:agent:vnc-stop`

### Devices Page Changes

Two new buttons per device row:

| Button | Enabled when | Action |
|--------|-------------|--------|
| **Connect PS** | Device is online in relay | Navigate to `/remote-terminal?deviceId=` |
| **Remote Desktop** | Device is online in relay | Navigate to `/remote-desktop?deviceId=` |

Online status is derived by cross-referencing the Intune device list with the relay's `agent:device-online`/`agent:device-offline` events.

A relay connection status indicator is shown in the Devices page topbar (separate from the Intune tenant status).

---

## 7. Agent Packaging via IntuneManager

The IntuneAgent is packaged and deployed using IntuneManager's own packaging pipeline — the system uses itself to distribute its own agent.

### Flow

1. Admin navigates to Settings → General → Remote Agent
2. Enters relay server URL and relay secret
3. Clicks **Build Agent Package**
4. IntuneManager:
   - Compiles `IntuneAgent.csproj` (or uses a pre-built release binary)
   - Writes `appsettings.json` with the configured relay URL and cert fingerprint
   - Runs `IntuneWinAppUtil.exe` on `Source/IntuneAgent/`
   - Saves `Output/Install-IntuneAgent.intunewin`
5. The package appears in the Deploy page's "Ready to Deploy" list
6. Admin clicks Deploy → IntuneAgent is uploaded to Intune
7. Intune pushes the agent to all targeted devices

The relay secret is passed to the install script as a PowerShell parameter (`-RelaySecret`), included in the PACKAGE_SETTINGS.md `install_command_line`. The `.intunewin` package is per-tenant — each tenant builds their own with their own relay secret.

---

## 8. Relay Server Deployment

### Recommended: Azure Container Apps

```yaml
# deploy/azure-container-app.yml
name: intune-relay
containerImage: intunemanager-relay:latest
ingress:
  external: true
  targetPort: 8080
  transport: http2  # enables WebSocket
env:
  - name: RELAY_SECRET
    secretRef: relay-secret
  - name: PORT
    value: "8080"
```

Estimated cost: ~$5-15/month on Azure Container Apps consumption plan for typical usage.

### Alternative: Self-hosted Docker

```bash
docker run -d \
  -e RELAY_SECRET="<256-bit-hex>" \
  -e TLS_CERT_PATH=/certs/cert.pem \
  -e TLS_KEY_PATH=/certs/key.pem \
  -e CERT_FINGERPRINT="<sha256>" \
  -v /etc/letsencrypt/live/relay.example.com:/certs:ro \
  -p 443:8080 \
  intunemanager-relay:latest
```

---

## 9. Data Flows

### PS Terminal Session (Happy Path)

```
1. Admin clicks [Connect PS] on device row (Devices page)
2. App navigates to /remote-terminal?deviceId=DEVICE-001&sessionId=sess-uuid
3. RemoteTerminal.tsx mounts → calls ipc:agent:shell-start
4. electron/ipc/agent.ts:
     a. Ensures admin WS connection to relay is open
     b. Sends { type: "shell:start", deviceId, sessionId, command: "" } to relay
5. Relay forwards to device's WS connection
6. IntuneAgent.ShellSession:
     a. Opens PS runspace
     b. Sends back { type: "vnc:ready" } ... wait, sends { type: "shell:output", data: "PS C:\\> " }
7. Relay forwards shell:output to admin
8. electron/ipc/agent.ts emits agent:shell-output event to renderer
9. xterm.js renders "PS C:\\> " prompt

10. User types "Get-Process" + Enter
11. xterm.js → ipc:agent:shell-input { data: "Get-Process\n" }
12. Relay forwards shell:input to device
13. IntuneAgent.ShellSession executes in runspace, streams output lines
14. Each output line: shell:output → relay → admin → agent:shell-output → xterm.js
15. "shell:exit" when command completes; prompt re-rendered

16. Admin clicks Kill Session / closes terminal
17. ipc:agent:shell-kill sent → relay → device
18. IntuneAgent disposes runspace
```

### VNC Session (Happy Path)

```
1. Admin clicks [Remote Desktop] on device row
2. App navigates to /remote-desktop?deviceId=DEVICE-001&sessionId=sess-uuid
3. RemoteDesktop.tsx mounts → calls ipc:agent:vnc-start
4. electron/ipc/agent.ts generates ECDH P-256 key pair
5. Sends { type: "vnc:start", deviceId, sessionId, publicKey: adminPubKey }
6. Relay forwards to device

7. IntuneAgent.VncSession:
     a. Starts tvnserver.exe on localhost:5900
     b. Generates ECDH P-256 key pair
     c. Sends { type: "vnc:session-key", publicKey: devicePubKey }
8. Relay forwards to admin

9. electron/ipc/agent.ts:
     a. Receives device public key
     b. Derives shared secret → AES-256-GCM session key
     c. Sends { type: "vnc:session-key" confirmed } back to device

10. Both sides have derived the same session key (ECDH)
11. IntuneAgent connects to tvnserver on localhost:5900
12. Reads RFB frames → encrypts with AES-256-GCM → sends vnc:frame
13. Relay forwards opaque ciphertext to admin
14. electron/ipc/agent.ts decrypts → emits agent:vnc-frame to renderer
15. RemoteDesktop.tsx feeds decrypted RFB data to noVNC canvas
16. Admin sees device screen

17. Admin moves mouse → noVNC captures event
18. RemoteDesktop.tsx → ipc:agent:vnc-input { event: { type: "mouse", x, y, buttons } }
19. electron/ipc/agent.ts encrypts event → sends vnc:input to relay
20. Relay → device → IntuneAgent decrypts → injects into RFB input stream → TightVNC
```

---

## 10. Known Constraints and Limitations

| Constraint | Impact | Notes |
|-----------|--------|-------|
| Device must be online and agent running | PS/RDP only works if device has checked in | Agent reconnects automatically on boot; if device is off, it shows as offline |
| Relay server is a new infrastructure dependency | Admin must set up and operate relay | Azure Container Apps reduces ops burden to near zero |
| PS sessions run as SYSTEM by default | Some user-context operations won't work | Configurable at install time — can run as a named service account |
| VNC performance depends on relay bandwidth | Screen updates may lag on slow connections | noVNC supports quality tuning; 1080p is usable at 10 Mbps |
| TightVNC is a third-party binary bundled in the agent | Adds ~5 MB to package size; subject to TightVNC license (GPLv2) | TightVNC is free for commercial use under GPLv2 |
| Agent TLS cert pinning breaks on cert renewal | Agent needs reinstall if relay cert is replaced | Document cert renewal procedure; pin to intermediate CA instead of leaf cert as a long-term improvement |
| No file transfer in Phase 1 | Cannot copy files to/from device via the terminal | File transfer is a Phase 3 feature |

---

## 11. Out of Scope (Future Phases)

| Feature | Phase |
|---------|-------|
| Multi-monitor support in Remote Desktop | 3 |
| File transfer (drag-and-drop to/from device) | 3 |
| Session recording (log PS output + VNC frames to DB) | 3 |
| Multi-admin viewing same device (shared session) | 4 |
| Constrained Language Mode / allowed-command allowlist for PS | 3 |
| Certificate rotation without agent reinstall | 3 |
| Mobile (iOS/Android) IntuneManager client | Future |
