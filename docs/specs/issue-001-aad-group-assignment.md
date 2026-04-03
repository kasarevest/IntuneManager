# Issue #001: AAD Group Assignment UI

**Priority:** CRITICAL (Workflow)  
**Status:** Not Started  
**Created:** 2026-04-02

## Problem Statement

Apps deployed to Intune are not assigned to any AAD group. After every deployment, admins must manually go into the Intune portal to add assignments. This makes the tool feel incomplete and creates manual overhead for every single deployment.

## Current Behavior

1. User deploys an app via IntuneManager
2. AI agent packages the app and uploads to Intune successfully
3. App appears in Intune portal but has **0 assignments**
4. Admin must manually:
   - Open Intune portal
   - Navigate to Apps → Windows
   - Find the app
   - Click Properties → Assignments
   - Add Required/Available assignments
   - Save

**Impact:** Eliminates 80% of the time savings the tool provides. Every deployment requires portal work.

## Desired Behavior

1. During or after deployment, user can assign the app to AAD groups
2. Common assignment types supported:
   - **Required** — Force install to devices/users
   - **Available** — Show in Company Portal
   - **Uninstall** — Remove from devices/users
3. User can select from their tenant's AAD groups
4. Assignments are created via Graph API automatically

## Technical Design

### Graph API Endpoints

**Fetch AAD Groups:**
```
GET https://graph.microsoft.com/v1.0/groups?$filter=securityEnabled eq true
```

**Create Assignment:**
```
POST https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/{appId}/assignments
Body:
{
  "@odata.type": "#microsoft.graph.mobileAppAssignment",
  "intent": "required",  // or "available", "uninstall"
  "target": {
    "@odata.type": "#microsoft.graph.groupAssignmentTarget",
    "groupId": "{groupId}"
  },
  "settings": null
}
```

### UI Flows

#### Option A: Post-Deployment Modal (Recommended)

After `job:complete` event:
1. Show modal: "App deployed successfully! Assign to groups now?"
2. Display multi-select list of AAD groups
3. Radio buttons: Required / Available / Uninstall
4. "Assign" button → calls Graph API
5. "Skip" button → closes modal (can assign later in portal)

#### Option B: Pre-Deployment Step

Add "Assignments" step to the Deploy page workflow:
1. Package Only → Review → **Assign Groups** → Upload to Intune
2. Checkbox list of groups with intent dropdown per group

### PowerShell Bridge Script

**New file:** `electron/ps-scripts/Set-IntuneAppAssignments.ps1`

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$AppId,
    [Parameter(Mandatory)] [string]$AssignmentsJsonPath  # Array of {groupId, intent}
)

# Read assignments from temp JSON file
$assignments = Get-Content $AssignmentsJsonPath | ConvertFrom-Json

foreach ($a in $assignments) {
    $body = @{
        '@odata.type' = '#microsoft.graph.mobileAppAssignment'
        intent = $a.intent
        target = @{
            '@odata.type' = '#microsoft.graph.groupAssignmentTarget'
            groupId = $a.groupId
        }
        settings = $null
    } | ConvertTo-Json -Depth 10

    Invoke-GraphRequest -Method POST `
        -Endpoint "deviceAppManagement/mobileApps/$AppId/assignments" `
        -Body $body
}

Write-Output "RESULT:{`"success`":true}"
```

**New file:** `electron/ps-scripts/Get-AadGroups.ps1`

```powershell
[CmdletBinding()]
param()

$groups = Invoke-GraphRequest -Method GET `
    -Endpoint 'groups?$filter=securityEnabled eq true&$select=id,displayName,description&$top=999'

Write-Output "RESULT:{`"success`":true,`"groups`":$($groups | ConvertTo-Json -Compress)}"
```

### IPC Layer

**New handlers in `ps-bridge.ts`:**
```typescript
ipcMain.handle('ipc:ps:get-aad-groups', async () => {
  return await runPsScript('Get-AadGroups.ps1', [])
})

ipcMain.handle('ipc:ps:set-app-assignments', async (_event, req: {
  appId: string
  assignments: Array<{ groupId: string; intent: 'required' | 'available' | 'uninstall' }>
}) => {
  const tmpPath = path.join(require('os').tmpdir(), `assignments-${Date.now()}.json`)
  fs.writeFileSync(tmpPath, JSON.stringify(req.assignments), 'utf8')
  try {
    return await runPsScript('Set-IntuneAppAssignments.ps1', [
      '-AppId', req.appId,
      '-AssignmentsJsonPath', tmpPath
    ])
  } finally {
    fs.unlinkSync(tmpPath)
  }
})
```

### React Component

**New component:** `src/components/AssignmentModal.tsx`

```typescript
interface AssignmentModalProps {
  appId: string
  appName: string
  onClose: () => void
}

export default function AssignmentModal({ appId, appName, onClose }: AssignmentModalProps) {
  const [groups, setGroups] = useState<Array<{ id: string; displayName: string }>>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [intent, setIntent] = useState<'required' | 'available'>('required')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    ipcPsGetAadGroups().then(res => {
      if (res.success) setGroups(res.groups)
    })
  }, [])

  const handleAssign = async () => {
    setAssigning(true)
    await ipcPsSetAppAssignments({
      appId,
      assignments: selectedGroups.map(groupId => ({ groupId, intent }))
    })
    setAssigning(false)
    onClose()
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 600 }}>
        <h2>Assign {appName}</h2>
        {/* Group multi-select list */}
        {/* Intent radio buttons */}
        {/* Assign + Skip buttons */}
      </div>
    </div>
  )
}
```

## Acceptance Criteria

- [ ] After successful deployment, user sees assignment modal
- [ ] Modal shows list of AAD security groups from tenant
- [ ] User can select multiple groups
- [ ] User can choose Required, Available, or Uninstall intent
- [ ] "Assign" button calls Graph API and creates assignments
- [ ] "Skip" button closes modal without assigning
- [ ] Success toast shows "Assigned to N group(s)"
- [ ] Error handling: displays Graph API errors in modal
- [ ] TypeScript: 0 compile errors
- [ ] Peer review: PASS

## Testing Plan

1. Deploy an app via AI agent
2. When job completes, verify assignment modal appears
3. Select 2 AAD groups, choose "Required"
4. Click "Assign"
5. Verify Graph API POST succeeds
6. Open Intune portal → check app has 2 Required assignments
7. Test "Skip" button → modal closes, no assignments created
8. Test with 0 groups selected → show validation error

## Dependencies

- Graph API permissions: `Group.Read.All`, `DeviceManagementApps.ReadWrite.All`
- User must have Intune Administrator or Application Administrator role

## Out of Scope

- Custom install time filters (e.g. "only install during maintenance window")
- Dependency management (e.g. "install WebView2 before this app")
- Assignment editing (delete/modify existing assignments)

## References

- [Graph API: mobileAppAssignment](https://learn.microsoft.com/en-us/graph/api/resources/intune-apps-mobileappassignment)
- [Intune Assignment Target Types](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-deviceandappmanagementassignmenttarget)
