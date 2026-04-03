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

### Infrastructure Choice: Azure Web PubSub + Azure Functions

The relay layer is implemented using two fully managed Azure services. No server code is deployed, maintained, or operated:

| Service | Role | Cost estimate |
|---------|------|--------------|
| **Azure Web PubSub** (Standard_S1) | Managed WebSocket hub — holds all device and admin connections, routes messages | ~$50/month (1,000 concurrent units) |
| **Azure Functions** (Consumption plan) | Serverless hub server — issues access tokens, validates auth, routes messages via Web PubSub REST API | ~$0–2/month (first 1M executions free) |
| **Azure Table Storage** | Session registry — maps device IDs and admin usernames to Web PubSub connection IDs | ~$0/month (pennies for this volume) |

This eliminates all container operations, TLS certificate management, and relay uptime responsibility. Microsoft operates the WebSocket infrastructure.

### Full Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  IntuneManager App (Electron)                                │
│                                                              │
│  Devices page                                                │
│    ├── [Connect PS] button per device                        │
│    └── [Remote Desktop] button per device                    │
│                                                              │
│  /remote-terminal?deviceId=                                  │
│    └── xterm.js terminal                                     │
│                                                              │
│  /remote-desktop?deviceId=                                   │
│    └── noVNC canvas                                          │
│                                                              │
│  electron/relay/relay-client.ts                              │
│    1. POST /api/negotiate?role=admin   ─────────────────┐   │
│    2. Connect WSS to returned URL  ─────────────────┐   │   │
│    3. Send/receive JSON messages                │   │   │   │
└────────────────────────────────────────────────│───│───┘   │
                                                 │   │
                                    ┌────────────▼───▼──────────────┐
                                    │  Azure Functions App           │
                                    │  (Consumption Plan)            │
                                    │                                │
                                    │  POST /api/negotiate           │
                                    │    Validate token              │
                                    │    Issue Web PubSub JWT        │
                                    │    Return WSS endpoint URL     │
                                    │                                │
                                    │  onConnected handler           │
                                    │    Register in Table Storage   │
                                    │                                │
                                    │  onDisconnected handler        │
                                    │    Remove from Table Storage   │
                                    │                                │
                                    │  onMessage handler             │
                                    │    Look up target connection   │
                                    │    Call Web PubSub REST API    │
                                    │    → SendToConnection(id, msg) │
                                    └─────────────┬─────────────────┘
                                                  │
                                    ┌─────────────▼─────────────────┐
                                    │  Azure Web PubSub              │
                                    │  (Standard_S1)                 │
                                    │                                │
                                    │  hub: "agentHub"               │
                                    │  All WebSocket connections      │
                                    │  held here. Microsoft          │
                                    │  manages TLS, scaling,         │
                                    │  reconnects.                   │
                                    └─────────────┬─────────────────┘
                                                  │ WSS (TLS 1.3)
                                                  │ *.webpubsub.azure.com
┌─────────────────────────────────────────────────▼────────────────┐
│  Managed Device (Windows 10/11)                                  │
│                                                                  │
│  IntuneAgent Windows Service                                     │
│    ├── RelayConnection.cs — negotiate + WebSocket connect        │
│    ├── ShellSession.cs    — PS runspace + stdout streaming       │
│    └── VncSession.cs      — TightVNC lifecycle + RFB proxy       │
│                                                                  │
│  Registry: HKLM\SOFTWARE\IntuneAgent                            │
│    ├── DeviceToken (DPAPI-encrypted HMAC token)                  │
│    └── NegotiateUrl (Azure Functions /api/negotiate endpoint)    │
└──────────────────────────────────────────────────────────────────┘
```

### Connection Sequence

```
Device startup:
  1. Agent reads NegotiateUrl + DeviceToken from registry
  2. POST {NegotiateUrl}?role=device  with Authorization: Bearer {DeviceToken}
  3. Azure Functions validates HMAC token, registers device in Table Storage
  4. Returns: { url: "wss://<hub>.webpubsub.azure.com/client/hubs/agentHub?access_token=<jwt>" }
  5. Agent connects WebSocket to returned URL
  6. Web PubSub triggers onConnected → Functions registers connectionId

Admin session:
  1. electron/relay/relay-client.ts calls ipc:agent:connect-relay
  2. electron/ipc/agent.ts: POST {NegotiateUrl}?role=admin  with local session token
  3. Azure Functions validates session, returns Web PubSub client URL
  4. relay-client.ts connects WebSocket to returned URL
  5. Admin is now connected to Web PubSub; can send messages to devices
```

### Component Inventory

| Component | Language | Location | New / Modified |
|-----------|----------|----------|----------------|
| Azure Web PubSub resource | Azure (managed) | Azure Portal / Bicep | Provisioned |
| Azure Functions app | TypeScript (Node.js 20) | `RelayFunctions/` | New project |
| Azure Table Storage | Azure (managed) | Same storage account as Functions | Provisioned |
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
| Unauthorized admin connects to a device | Azure Functions `negotiate` validates the IntuneManager session token before issuing a Web PubSub JWT; JWT includes role claim checked on every message route |
| Device connects using a forged token | Device token is HMAC-SHA256 signed with `NEGOTIATE_SECRET`; Functions verifies HMAC before issuing Web PubSub access token |
| Man-in-the-middle on relay traffic | All traffic is WSS to `*.webpubsub.azure.com` — Microsoft-managed CA-signed TLS 1.3; no custom cert management needed |
| Device token exfiltrated from registry | Token stored DPAPI-encrypted (`ProtectedData.Protect`, `LocalMachine` scope); readable only by SYSTEM or admin-level processes |
| Replay attack using captured Web PubSub JWT | Web PubSub access tokens have a configurable TTL (set to 15 minutes); expired tokens are rejected by Web PubSub |
| Admin impersonates another admin's session | Each Web PubSub JWT contains the admin's `username` claim; the Functions message handler verifies the sender's identity before routing |
| Lateral movement via PS runspace | PS runs as the service account (SYSTEM by default, configurable); no network credentials forwarded to the runspace |
| VNC screen exposure to Azure (relay operator) | VNC stream is AES-256-GCM end-to-end encrypted with a session key established via ECDH P-256; Azure Web PubSub routes opaque ciphertext and cannot decrypt frames |
| Prompt injection via malicious PS output | xterm.js renders output as plain text only; no HTML/script evaluation |
| `NEGOTIATE_SECRET` exposure in agent package | Secret is stored AES-256-CBC encrypted in IntuneManager `app_settings`; passed to install script as a PowerShell `-NegotiateSecret` parameter at packaging time; never written to `PACKAGE_SETTINGS.md` |

### Token Scheme

**Device HMAC Token**
```
deviceToken = HMAC-SHA256(NEGOTIATE_SECRET, deviceId + ":" + installTimestamp)
```
- Generated by `Install-IntuneAgent.ps1` at install time
- Stored DPAPI-encrypted at `HKLM\SOFTWARE\IntuneAgent\DeviceToken`
- Permanent; Azure Functions can revoke by blocking the deviceId in Table Storage

**Web PubSub Client JWT (issued by Azure Functions)**
```json
{
  "aud": "https://<hub>.webpubsub.azure.com/client/hubs/agentHub",
  "sub": "device:{deviceId}",          // or "admin:{username}"
  "role": ["webpubsub.sendToGroup.all", "webpubsub.joinLeaveGroup.all"],
  "iat": 1743600000,
  "exp": 1743600900
}
```
- Signed with the Web PubSub resource's access key (held only by Azure Functions)
- 15-minute TTL; agents and admin clients request a new JWT before expiry

**VNC Session Key**
```
ECDH P-256 ephemeral key pair per VNC session
Derived shared secret → HKDF-SHA256 → AES-256-GCM session key
```
- Negotiated in the `vnc:start` / `vnc:session-key` message exchange
- Azure Web PubSub routes the key exchange messages but cannot derive the session key

---

## 4. Azure Functions Hub Specification

### Technology

- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript
- **Framework:** Azure Functions v4 (`@azure/functions`)
- **Web PubSub SDK:** `@azure/web-pubsub` (server-side REST API calls)
- **Table Storage:** `@azure/data-tables` (session/device registry)
- **Auth:** `jsonwebtoken` (validate IntuneManager session tokens), `crypto` (HMAC verify)
- **Deployment:** Azure Functions Consumption plan (serverless, ~$0/month)

### Azure Functions File Structure

```
RelayFunctions/
├── src/
│   ├── functions/
│   │   ├── negotiate.ts        — POST /api/negotiate (token issuance)
│   │   ├── onConnected.ts      — Web PubSub system event handler
│   │   ├── onDisconnected.ts   — Web PubSub system event handler
│   │   └── onMessage.ts        — Web PubSub user event handler (message router)
│   ├── auth.ts                 — HMAC device token verify; session token verify
│   ├── registry.ts             — Azure Table Storage CRUD for connection registry
│   └── types.ts                — Message type definitions
├── host.json
├── local.settings.json         — (gitignored) local dev config
├── package.json
└── tsconfig.json
```

### Function: `POST /api/negotiate`

**Purpose:** Exchange a device token or admin session token for a Web PubSub client access URL.

**Request:**
```
POST /api/negotiate?role=device
Authorization: Bearer <deviceHmacToken>
Body: { "deviceId": "...", "hostname": "...", "osVersion": "..." }

POST /api/negotiate?role=admin
Authorization: Bearer <intuneManagerSessionToken>
Body: { "username": "..." }
```

**Logic:**
1. If `role=device`: verify HMAC token using `NEGOTIATE_SECRET`; reject if invalid
2. If `role=admin`: verify the IntuneManager session token against the shared `SESSION_HMAC_SECRET`
3. Generate Web PubSub client access URL via `WebPubSubServiceClient.getClientAccessToken()`
4. Register the connection metadata in Table Storage (pending, will be confirmed with connectionId in `onConnected`)
5. Return `{ url: "wss://..." }`

**Response:**
```json
{ "url": "wss://<hub>.webpubsub.azure.com/client/hubs/agentHub?access_token=<jwt>" }
```

### Function: `onConnected` (Web PubSub system event)

**Trigger:** Azure Web PubSub calls this via HTTP when a client completes its WebSocket handshake.

**Logic:**
1. Receive `{ connectionId, userId }` from Web PubSub
2. Look up pending registration in Table Storage by `userId`
3. Store `connectionId` in the registry row
4. If role=device: mark device as online; add to group `devices`
5. If role=admin: add to group `admins`
6. Broadcast `device:online` message to all admins (if role=device)

### Function: `onDisconnected` (Web PubSub system event)

**Trigger:** Azure Web PubSub calls this via HTTP when a WebSocket connection drops.

**Logic:**
1. Look up connection by `connectionId` in Table Storage
2. Remove the registry row
3. If role=device: broadcast `device:offline` message to all admins
4. If there are active shell/VNC sessions for this device: emit `shell:exit` / `vnc:stop` to the relevant admin connections

### Function: `onMessage` (Web PubSub user event)

**Trigger:** Azure Web PubSub calls this via HTTP when any client sends a message.

**Logic — admin→device routing:**
```
Receive message from admin connection
  → Read deviceId from message
  → Look up device connectionId in Table Storage
  → If device not online: send error back to admin
  → Else: call WebPubSubServiceClient.sendToConnection(deviceConnectionId, strippedMessage)
     (strip deviceId field; device only needs sessionId + command)
```

**Logic — device→admin routing:**
```
Receive message from device connection
  → Read sessionId from message
  → Look up which admin has an active session for this sessionId in Table Storage
  → Call WebPubSubServiceClient.sendToConnection(adminConnectionId, enrichedMessage)
     (add deviceId field so admin knows which device it's from)
```

**Active session registry (Table Storage):**

| Table | PartitionKey | RowKey | Fields |
|-------|-------------|--------|--------|
| `connections` | `device` or `admin` | connectionId | userId, hostname, osVersion, connectedAt |
| `sessions` | sessionId | `"session"` | deviceConnectionId, adminConnectionId, type (shell/vnc), startedAt |

### Azure App Settings (Functions)

| Setting | Description |
|---------|-------------|
| `WEBPUBSUB_CONNECTION_STRING` | Azure Web PubSub connection string (from Azure Portal) |
| `STORAGE_CONNECTION_STRING` | Azure Storage connection string for Table Storage |
| `NEGOTIATE_SECRET` | 256-bit hex string used to verify device HMAC tokens |
| `SESSION_HMAC_SECRET` | Shared secret used to verify IntuneManager session tokens sent to the negotiate endpoint |
| `WEBPUBSUB_HUB` | Hub name — `agentHub` |

---

## 5. Message Protocol

All messages are JSON. Every message has a `type` field.
The protocol is identical to what the Functions relay between clients — Web PubSub is transparent to the message contents.

### Device → Admin (via Functions router)

| Type | Fields | Description |
|------|--------|-------------|
| `shell:output` | `sessionId`, `data` (string), `isStderr` (bool) | Streamed PS output line |
| `shell:exit` | `sessionId`, `exitCode` | PS runspace closed |
| `vnc:ready` | `sessionId`, `width`, `height` | VNC server started |
| `vnc:frame` | `sessionId`, `data` (base64 AES-GCM ciphertext) | Encrypted RFB frame chunk |
| `vnc:session-key` | `sessionId`, `publicKey` (base64 ECDH public key) | Device's ECDH public key |

### Admin → Device (via Functions router)

| Type | Fields | Description |
|------|--------|-------------|
| `shell:start` | `deviceId`, `sessionId`, `command` | Open PS runspace |
| `shell:input` | `deviceId`, `sessionId`, `data` | Send stdin to PS runspace |
| `shell:kill` | `deviceId`, `sessionId` | Kill PS runspace |
| `vnc:start` | `deviceId`, `sessionId` | Start TightVNC server |
| `vnc:session-key` | `deviceId`, `sessionId`, `publicKey` | Admin's ECDH public key |
| `vnc:input` | `deviceId`, `sessionId`, `event` | Mouse/keyboard event |
| `vnc:stop` | `deviceId`, `sessionId` | Stop VNC session |

### Functions → Admin (system notifications)

| Type | Fields | Description |
|------|--------|-------------|
| `device:online` | `deviceId`, `hostname`, `osVersion` | Device connected |
| `device:offline` | `deviceId` | Device disconnected |
| `devices:list` | `devices[]` | Response to admin connect (list of currently online devices) |
| `error` | `code`, `message` | Routing error (e.g., device not online) |

---

## 6. IntuneAgent Windows Service Specification

### Technology

- **Runtime:** .NET 8.0 (self-contained, no runtime installation needed on device)
- **Service framework:** `Microsoft.Extensions.Hosting.WindowsServices`
- **PS integration:** `Microsoft.PowerShell.SDK` NuGet package
- **WebSocket:** `System.Net.WebSockets.ClientWebSocket` (built-in)
- **HTTP client:** `System.Net.Http.HttpClient` (for negotiate call)
- **Crypto:** `System.Security.Cryptography` + `System.Security.Cryptography.ProtectedData`

### Agent File Structure

```
IntuneAgent/
├── IntuneAgent.csproj
├── Program.cs                — Host builder, Windows service registration
├── AgentService.cs           — IHostedService; orchestrates RelayConnection + sessions
├── RelayConnection.cs        — negotiate() → WebSocket connect; reconnect loop; message dispatch
├── ShellSession.cs           — PowerShell runspace lifecycle; async output streaming
├── VncSession.cs             — TightVNC process management; RFB proxy; frame encryption
├── SessionKeyExchange.cs     — ECDH P-256 key pair; shared secret derivation; AES-256-GCM
├── RegistryHelper.cs         — DPAPI read/write for DeviceToken; read NegotiateUrl, DeviceId
├── AgentConfig.cs            — Configuration model
├── Assets/
│   └── TightVNC/             — tvnserver.exe + tvnserver.ini (loopback-only config)
└── appsettings.json          — NegotiateUrl placeholder (overwritten at install time)
```

### Agent Startup Sequence

```
1. Read NegotiateUrl, DeviceId from registry
2. DPAPI-decrypt DeviceToken from registry
3. Enter reconnect loop:
   a. POST {NegotiateUrl}?role=device
      Body: { deviceId, hostname: $env:COMPUTERNAME, osVersion }
      Authorization: Bearer {DeviceToken}
   b. If HTTP 401/403: log to Windows Event Log; stop reconnecting
   c. If HTTP 200: parse { url } from response
   d. Connect ClientWebSocket to url
   e. Enter message receive loop → dispatch to ShellSession or VncSession handlers
4. On disconnect: exponential backoff (5s → 10s → 20s → ... max 5min); restart from step 3a
```

### Shell Session (`ShellSession.cs`)

- On `shell:start`: create `PowerShell` runspace; invoke command with `BeginInvoke`
- Stream `PSDataStreams.Output` and `.Error` via callbacks; each item → `shell:output` message
- On `shell:kill` or natural completion: dispose runspace; send `shell:exit`
- Max 5 concurrent sessions (configurable); reject `shell:start` if at limit

### VNC Session (`VncSession.cs`)

1. On `vnc:start`:
   - Start `tvnserver.exe -service` from `Assets/TightVNC/`; TightVNC config enforces `allowLoopback=1`, `loopbackOnly=1`
   - Generate ECDH P-256 key pair; send `vnc:session-key` with device public key
2. On `vnc:session-key` from admin (key exchange complete):
   - Derive shared secret; HKDF → AES-256-GCM session key
   - Connect local `TcpClient` to `127.0.0.1:5900`
   - Start read loop: read RFB frames → encrypt with AES-256-GCM → send `vnc:frame`
3. On `vnc:input`: decrypt event bytes; inject into RFB input stream via local TCP write
4. On `vnc:stop`: close TcpClient; stop `tvnserver.exe`; send no further frames

### Agent Install Package (`Source/IntuneAgent/`)

**`Install-IntuneAgent.ps1`** — PS 5.1 compatible

1. Verify `IntuneAgent.exe` SHA256 matches manifest
2. Create `C:\Program Files\IntuneAgent\` and copy all files
3. Generate `DeviceToken`:
   ```powershell
   $hmac = [System.Security.Cryptography.HMACSHA256]::new(
       [System.Text.Encoding]::UTF8.GetBytes($NegotiateSecret))
   $input = [System.Text.Encoding]::UTF8.GetBytes("$DeviceId`:$InstallTimestamp")
   $token = [Convert]::ToBase64String($hmac.ComputeHash($input))
   ```
4. DPAPI-encrypt `DeviceToken`; write to `HKLM:\SOFTWARE\IntuneAgent\DeviceToken`
5. Write `DeviceId` to `HKLM:\SOFTWARE\IntuneAgent\DeviceId`
6. Write `NegotiateUrl` to `HKLM:\SOFTWARE\IntuneAgent\NegotiateUrl`
7. Configure TightVNC registry settings (`allowLoopback=1`, `loopbackOnly=1`)
8. Create and start Windows service:
   ```powershell
   New-Service -Name "IntuneAgent" `
     -BinaryPathName '"C:\Program Files\IntuneAgent\IntuneAgent.exe"' `
     -StartupType Automatic -DisplayName "IntuneManager Remote Agent"
   Start-Service "IntuneAgent"
   ```
9. Write detection key: `HKLM:\SOFTWARE\IntuneAgentInstaller\Version = "1.0.0"`
10. Exit 0

**`Detect-IntuneAgent.ps1`**
- Registry `HKLM:\SOFTWARE\IntuneAgentInstaller\Version` equals `"1.0.0"` AND
- `Get-Service IntuneAgent -ErrorAction SilentlyContinue` returns `Status = Running`

**`Uninstall-IntuneAgent.ps1`**
1. `Stop-Service IntuneAgent -Force -ErrorAction SilentlyContinue`
2. `sc.exe delete IntuneAgent`
3. `Stop-Process -Name tvnserver -Force -ErrorAction SilentlyContinue`
4. `Remove-Item "C:\Program Files\IntuneAgent" -Recurse -Force`
5. `Remove-Item HKLM:\SOFTWARE\IntuneAgent -Recurse -Force`
6. `Remove-Item HKLM:\SOFTWARE\IntuneAgentInstaller -Recurse -Force`

**`PACKAGE_SETTINGS.md`** — standard format; `install_command_line` includes `-NegotiateSecret` and `-NegotiateUrl` parameters. **These parameters contain secrets and must not be committed to public repositories.**

---

## 7. IntuneManager Changes

### New Settings Fields

Three new fields in `AppSettings` and `app_settings` DB table:

| Field | DB Key | Description |
|-------|--------|-------------|
| `negotiateUrl` | `relay_negotiate_url` | HTTPS URL of the Azure Functions `/api/negotiate` endpoint |
| `negotiateSecret` | `relay_negotiate_secret_encrypted` | `NEGOTIATE_SECRET` used to sign device HMAC tokens at agent packaging time. AES-256-CBC encrypted at rest. |
| `sessionHmacSecret` | `relay_session_hmac_secret_encrypted` | `SESSION_HMAC_SECRET` used to sign the admin session token sent to the negotiate endpoint. AES-256-CBC encrypted at rest. |

Displayed in Settings → General under a new **Remote Agent** card.

### New IPC Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `ipc:agent:connect-relay` | invoke | Negotiate + connect admin WebSocket to Web PubSub |
| `ipc:agent:disconnect-relay` | invoke | Disconnect from Web PubSub |
| `ipc:agent:get-online-devices` | invoke | Request `devices:list` from Functions |
| `ipc:agent:shell-start` | invoke | Send `shell:start` to device via relay |
| `ipc:agent:shell-input` | invoke | Send `shell:input` to device via relay |
| `ipc:agent:shell-kill` | invoke | Send `shell:kill` to device via relay |
| `ipc:agent:vnc-start` | invoke | Send `vnc:start` to device via relay |
| `ipc:agent:vnc-stop` | invoke | Send `vnc:stop` to device via relay |
| `ipc:agent:vnc-input` | invoke | Send `vnc:input` to device via relay |
| `ipc:agent:build-package` | invoke | Build `.intunewin` agent package with embedded secrets |
| `agent:shell-output` | event → renderer | Streamed PS output line |
| `agent:shell-exit` | event → renderer | PS session ended |
| `agent:device-online` | event → renderer | Device connected to relay |
| `agent:device-offline` | event → renderer | Device disconnected from relay |
| `agent:vnc-ready` | event → renderer | VNC session started on device |
| `agent:vnc-frame` | event → renderer | Decrypted VNC frame chunk (ready for noVNC) |

### New Pages

**`/remote-terminal?deviceId=&deviceName=&sessionId=`**
- Full-screen dark terminal using `@xterm/xterm` + `@xterm/addon-fit`
- Topbar: device name, relay connection indicator, Kill Session button, Back to Devices
- On mount: `ipc:agent:shell-start`; subscribe to `agent:shell-output` / `agent:shell-exit`
- User keystrokes → `ipc:agent:shell-input`
- On unmount / Kill: `ipc:agent:shell-kill`

**`/remote-desktop?deviceId=&deviceName=&sessionId=`**
- noVNC canvas (bundled at `electron/novnc/` — no CDN dependency)
- Topbar: device name, frame latency (ms), Disconnect, Back to Devices
- On mount: `ipc:agent:vnc-start` + ECDH key exchange; subscribe to `agent:vnc-frame`
- Decrypted RFB data piped to noVNC canvas
- Mouse/keyboard events → `ipc:agent:vnc-input`
- On unmount / Disconnect: `ipc:agent:vnc-stop`

### Devices Page Changes

| Addition | Detail |
|----------|--------|
| Relay status indicator in topbar | Green dot = connected to Web PubSub; Red = disconnected (separate from Intune tenant status) |
| Connect PS button per row | Enabled when device `deviceId` appears in the online devices list from relay; navigates to `/remote-terminal` |
| Remote Desktop button per row | Same enablement logic; navigates to `/remote-desktop` |

---

## 8. Agent Packaging via IntuneManager

The IntuneAgent is packaged and deployed using IntuneManager's own packaging pipeline.

### Build Flow

1. Admin opens Settings → General → Remote Agent
2. Enters `Negotiate URL` (Azure Functions endpoint), `Negotiate Secret`, and `Session HMAC Secret`
3. Clicks **Build Agent Package**
4. `ipc:agent:build-package` handler in Electron:
   - Reads pre-built `IntuneAgent.exe` release binary (bundled with IntuneManager or downloaded)
   - Copies agent files to `Source/IntuneAgent/`
   - The install command line in `PACKAGE_SETTINGS.md` embeds the `-NegotiateUrl` and `-NegotiateSecret` parameters
5. Runs `IntuneWinAppUtil.exe` → `Output/Install-IntuneAgent.intunewin`
6. Package appears in Deploy page "Ready to Deploy" list
7. Admin clicks Deploy → IntuneAgent uploaded to Intune and assigned to all devices

---

## 9. Azure Provisioning

### Required Azure Resources

```
Resource Group: rg-intunemanager-relay
  ├── Azure Web PubSub: wps-intunemanager (Standard_S1)
  │     Hub: agentHub
  │     Event handler URL: https://<functions>.azurewebsites.net/api/webpubsub
  │
  ├── Azure Functions App: func-intunemanager-relay (Consumption, Node 20, Windows)
  │     App Settings: WEBPUBSUB_CONNECTION_STRING, STORAGE_CONNECTION_STRING,
  │                   NEGOTIATE_SECRET, SESSION_HMAC_SECRET, WEBPUBSUB_HUB
  │
  └── Azure Storage Account: stintunemanagerrelay (LRS, Standard)
        Table: connections
        Table: sessions
```

### Bicep Template (`RelayFunctions/deploy/main.bicep`)

Provisions all three resources in one deployment. Parameters: `location`, `negotiateSecret` (secure string), `sessionHmacSecret` (secure string).

### Estimated Monthly Cost

| Resource | SKU | Estimated cost |
|----------|-----|---------------|
| Azure Web PubSub | Standard_S1 (1 unit = 1,000 concurrent connections) | $49/month |
| Azure Functions | Consumption | $0–2/month |
| Azure Table Storage | LRS | < $0.10/month |
| **Total** | | **~$50/month** |

> For dev/test: Web PubSub Free_F1 tier (20 concurrent connections, 20,000 messages/day) costs $0/month.

---

## 10. Data Flows

### PS Terminal Session (Happy Path)

```
1.  Admin clicks [Connect PS] on device row
2.  App navigates to /remote-terminal?deviceId=DEVICE-001&sessionId=sess-uuid
3.  RemoteTerminal mounts → ipc:agent:shell-start { deviceId, sessionId, command: "" }
4.  electron/ipc/agent.ts sends { type:"shell:start", deviceId, sessionId } via Web PubSub
5.  Web PubSub → onMessage Function
6.  Function looks up device connectionId in Table Storage
7.  Function: WebPubSubClient.sendToConnection(deviceConnId, { type:"shell:start", sessionId })
8.  Web PubSub delivers to device
9.  IntuneAgent.ShellSession opens PS runspace
10. PS prompt outputs "PS C:\> " → shell:output message
11. Web PubSub → onMessage Function → routes to admin connection → Web PubSub → admin
12. electron/ipc/agent.ts emits agent:shell-output to renderer
13. xterm.js renders "PS C:\> "

14. User types "Get-Process" + Enter
15. xterm.js → ipc:agent:shell-input → relay → device
16. Device executes in runspace; streams each output line as shell:output → relay → admin → xterm.js
17. shell:exit emitted when command completes

18. Admin closes terminal → ipc:agent:shell-kill → relay → device → runspace disposed
```

### VNC Session (Happy Path)

```
1.  Admin clicks [Remote Desktop]
2.  App navigates to /remote-desktop?deviceId=DEVICE-001&sessionId=sess-uuid
3.  RemoteDesktop mounts → ipc:agent:vnc-start { deviceId, sessionId }
4.  electron/ipc/agent.ts generates ECDH P-256 key pair (adminPrivKey, adminPubKey)
5.  Sends { type:"vnc:start", deviceId, sessionId, publicKey: adminPubKeyBase64 } via relay

6.  Device receives vnc:start
7.  IntuneAgent starts tvnserver.exe on localhost:5900
8.  Generates own ECDH key pair; derives shared secret from adminPubKey
9.  Sends { type:"vnc:session-key", sessionId, publicKey: devicePubKeyBase64 }

10. electron/ipc/agent.ts receives vnc:session-key
11. Derives shared secret from devicePubKey + adminPrivKey → AES-256-GCM session key
12. Both sides now hold the same session key; Azure never saw it

13. Agent connects to tvnserver on localhost:5900; reads RFB frames
14. Encrypts each frame chunk with AES-256-GCM → sends vnc:frame
15. Relay routes opaque ciphertext to admin
16. electron/ipc/agent.ts decrypts chunk → emits agent:vnc-frame to renderer
17. RemoteDesktop.tsx feeds decrypted RFB bytes to noVNC canvas
18. Admin sees live device screen

19. Admin moves mouse → noVNC captures event
20. RemoteDesktop → ipc:agent:vnc-input → relay → device
21. Device decrypts input event → injects into RFB TCP stream → TightVNC acts on it
```

---

## 11. Known Constraints and Limitations

| Constraint | Impact | Notes |
|-----------|--------|-------|
| Azure Web PubSub Standard_S1 required for production | ~$50/month new Azure spend | Free_F1 tier available for dev/test |
| Device must be powered on and agent service running | PS/RDP only works if device is online | Agent reconnects automatically on boot |
| VNC performance depends on relay + device bandwidth | Screen updates may lag on constrained connections | noVNC supports quality and compression tuning |
| TightVNC license is GPLv2 | Distributable for free; source of bundled binary must be disclosed | Document in PACKAGE_SETTINGS.md |
| PS sessions run as SYSTEM by default | Some user-context operations won't work | Service account configurable at install time |
| No file transfer | Cannot copy files to/from device | Phase 3 feature |
| Session not resumed on relay disconnect | If Web PubSub connection drops mid-session, session terminates | Admin must reconnect and start a new session |

---

## 12. Out of Scope (Future Phases)

| Feature | Phase |
|---------|-------|
| Multi-monitor support | 3 |
| File transfer (drag-and-drop) | 3 |
| Session recording (PS log + VNC replay) | 3 |
| PS command allowlist / Constrained Language Mode | 3 |
| Bicep one-click Azure deployment from within IntuneManager | 3 |
| Multi-admin viewing same device | 4 |
