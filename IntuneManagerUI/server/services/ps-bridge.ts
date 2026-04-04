import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import type { Database } from 'better-sqlite3'

// server/ is a sibling to electron/ inside IntuneManagerUI/
const PS_SCRIPTS_DIR = path.join(__dirname, '..', 'electron', 'ps-scripts')

// ─── Core PS runner ───────────────────────────────────────────────────────────

export interface PsResult {
  exitCode: number
  result: Record<string, unknown> | null
  logLines: Array<{ level: string; message: string }>
  rawStdout: string[]
  rawStderr: string[]
}

export function runPsScript(
  scriptName: string,
  args: string[],
  onLogLine?: (line: string, level: string) => void,
  signal?: AbortSignal,
  interactive?: boolean
): Promise<PsResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PS_SCRIPTS_DIR, scriptName)
    // Do NOT pass -NonInteractive for scripts that open a browser (MSAL interactive login)
    const psArgs = interactive
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]

    const proc: ChildProcess = spawn('powershell.exe', psArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })

    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const logLines: Array<{ level: string; message: string }> = []
    let resultJson: Record<string, unknown> | null = null
    let stdoutBuffer = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        stdoutLines.push(line)

        if (line.startsWith('RESULT:')) {
          try { resultJson = JSON.parse(line.slice(7)) } catch { /* ignore */ }
        } else if (line.startsWith('LOG:')) {
          const match = line.slice(4).match(/^\[(\w+)\]\s+(.*)/)
          const level = match?.[1] ?? 'INFO'
          const message = match?.[2] ?? line.slice(4)
          logLines.push({ level, message })
          onLogLine?.(message, level)
        }
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean)
      stderrLines.push(...lines)
      for (const line of lines) onLogLine?.(line, 'DEBUG')
    })

    proc.on('close', code => resolve({
      exitCode: code ?? -1,
      result: resultJson,
      logLines,
      rawStdout: stdoutLines,
      rawStderr: stderrLines
    }))

    proc.on('error', err => reject(new Error(`Failed to spawn powershell.exe: ${err.message}`)))

    signal?.addEventListener('abort', () => {
      try {
        proc.kill()
        spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true })
      } catch { /* ignore */ }
    })
  })
}

// ─── DB cache helpers ─────────────────────────────────────────────────────────

export function getCached(db: Database, key: string): Record<string, unknown> | null {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined
    if (!row?.value) return null
    return JSON.parse(row.value) as Record<string, unknown>
  } catch { return null }
}

export function saveCache(db: Database, key: string, data: Record<string, unknown>): void {
  try {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(data))
  } catch { /* non-fatal */ }
}
