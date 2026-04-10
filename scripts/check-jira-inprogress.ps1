#Requires -Version 5.1
<#
.SYNOPSIS
  Polls Jira every 2 hours for tickets newly moved to "In Progress".
  Outputs NEW_IN_PROGRESS:<json> when a transition is detected, so Claude
  Code can pick it up and automatically start implementing the ticket.

.REQUIREMENTS
  Set these environment variables before running (or add to .env.jira):
    $env:JIRA_BASE_URL   = "https://yoursite.atlassian.net"
    $env:JIRA_EMAIL      = "you@example.com"
    $env:JIRA_API_TOKEN  = "your-api-token"
    $env:JIRA_PROJECT    = "SCRUM"  (optional, defaults to SCRUM)

.OUTPUT
  NEW_IN_PROGRESS:[{"key":"SCRUM-42","summary":"..."}]  — one or more new tickets
  NO_NEW_TICKETS                                         — no change since last poll
  ERROR:<message>                                        — Jira API call failed
#>

$ErrorActionPreference = 'Stop'

# ── Load optional .env.jira from scripts/ directory ──────────────────────────
$envFile = Join-Path $PSScriptRoot '.env.jira'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+)\s*$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

# ── Validate required env vars ────────────────────────────────────────────────
$JiraBase   = $env:JIRA_BASE_URL
$JiraEmail  = $env:JIRA_EMAIL
$JiraToken  = $env:JIRA_API_TOKEN
$JiraProject = if ($env:JIRA_PROJECT) { $env:JIRA_PROJECT } else { 'SCRUM' }

if (-not $JiraBase -or -not $JiraEmail -or -not $JiraToken) {
    Write-Output "ERROR:Missing required env vars. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (or create scripts/.env.jira)."
    exit 1
}

# ── State file: tracks which keys were already In Progress ───────────────────
$StateFile = "$env:USERPROFILE\.claude\jira-poll-state.json"
$StateDir  = Split-Path $StateFile
if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

$prevKeys = @{}
if (Test-Path $StateFile) {
    try {
        $prevData = Get-Content $StateFile -Raw | ConvertFrom-Json
        foreach ($k in $prevData) { $prevKeys[$k] = $true }
    } catch { $prevKeys = @{} }
}

# ── Query Jira for current In Progress tickets ────────────────────────────────
$authBytes  = [System.Text.Encoding]::ASCII.GetBytes("${JiraEmail}:${JiraToken}")
$authB64    = [Convert]::ToBase64String($authBytes)
$headers    = @{
    Authorization = "Basic $authB64"
    Accept        = 'application/json'
}

$jql = [Uri]::EscapeDataString("project=$JiraProject AND status='In Progress' ORDER BY updated DESC")
$url = "$JiraBase/rest/api/3/search/jql?jql=$jql&maxResults=50&fields=summary,status,priority,description"

try {
    $response = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -TimeoutSec 15
} catch {
    Write-Output "ERROR:Jira API call failed: $($_.Exception.Message)"
    exit 1
}

# ── Compare current vs previous ───────────────────────────────────────────────
$currentKeys = @{}
$currentTickets = @()

foreach ($issue in $response.issues) {
    $key     = $issue.key
    $summary = $issue.fields.summary
    $priority = $issue.fields.priority.name
    $currentKeys[$key] = $true
    $currentTickets += @{ key = $key; summary = $summary; priority = $priority }
}

$newTickets = $currentTickets | Where-Object { -not $prevKeys.ContainsKey($_.key) }

# ── Persist current state ─────────────────────────────────────────────────────
$currentKeys.Keys | ConvertTo-Json -Compress | Out-File -FilePath $StateFile -Encoding utf8 -Force

# ── Output result ─────────────────────────────────────────────────────────────
if ($newTickets.Count -gt 0) {
    $json = $newTickets | ConvertTo-Json -Compress
    Write-Output "NEW_IN_PROGRESS:$json"
} else {
    Write-Output "NO_NEW_TICKETS"
}
