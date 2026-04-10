import { spawn, ChildProcess } from 'child_process'
import path from 'path'

// PS scripts live in server/ps-scripts/ (web app) — copied to dist/ps-scripts/ by Docker
const PS_SCRIPTS_DIR = path.join(__dirname, '..', 'ps-scripts')

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
  interactive?: boolean,
  timeoutMs: number = 60000
): Promise<PsResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PS_SCRIPTS_DIR, scriptName)
    // Do NOT pass -NonInteractive for scripts that open a browser (MSAL interactive login)
    const psArgs = interactive
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]

    // Use 'pwsh' (PowerShell 7, cross-platform) in production Linux containers;
    // fall back to 'powershell.exe' on Windows (local dev / Electron).
    const psBin = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
    const proc: ChildProcess = spawn(psBin, psArgs, {
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

    const killProc = () => {
      try {
        proc.kill()
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true })
        } else {
          spawn('kill', ['-9', String(proc.pid)])
        }
      } catch { /* ignore */ }
    }

    const timer = setTimeout(() => {
      killProc()
      reject(new Error(`Script timed out after ${timeoutMs / 1000}s: ${scriptName}`))
    }, timeoutMs)

    proc.on('close', code => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? -1,
        result: resultJson,
        logLines,
        rawStdout: stdoutLines,
        rawStderr: stderrLines
      })
    })

    proc.on('error', err => {
      clearTimeout(timer)
      reject(new Error(`Failed to spawn powershell: ${err.message}`))
    })

    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      killProc()
    })
  })
}

