import { useState, useEffect, useCallback, useRef } from 'react'
import type { LogEntry, DeployJob } from '../types/app'
import { ipcAiDeployApp, ipcAiCancel } from '../lib/api'
import { onJobLog, onJobPhaseChange, onJobComplete, onJobError } from '../lib/sse'

export function useDeployJob() {
  const [job, setJob] = useState<DeployJob | null>(null)
  const unsubsRef = useRef<Array<() => void>>([])

  const clearSubs = () => {
    unsubsRef.current.forEach(fn => fn())
    unsubsRef.current = []
  }

  useEffect(() => {
    return clearSubs
  }, [])

  const start = useCallback(async (userRequest: string, isUpdate = false, existingAppId?: string) => {
    clearSubs()

    // Kick off the job
    const res = await ipcAiDeployApp({ userRequest, isUpdate, existingAppId })

    const jobId: string = res.jobId
    setJob({ jobId, phase: 'analyzing', phaseLabel: 'Analyzing request...', logs: [], status: 'running' })

    unsubsRef.current.push(
      onJobLog((data: LogEntry) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, logs: [...prev.logs, data] } : prev)
      }),
      onJobPhaseChange((data: { jobId: string; phase: string; label: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, phase: data.phase, phaseLabel: data.label } : prev)
      }),
      onJobComplete((data: { jobId: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, status: 'complete', phase: 'done', phaseLabel: 'Complete' } : prev)
        clearSubs()
      }),
      onJobError((data: { jobId: string; error: string; phase: string }) => {
        if (data.jobId !== jobId) return
        setJob(prev => prev ? { ...prev, status: 'error', error: data.error } : prev)
        clearSubs()
      })
    )

    return jobId
  }, [])

  const cancel = useCallback(async () => {
    if (!job) return
    await ipcAiCancel(job.jobId)
    setJob(prev => prev ? { ...prev, status: 'cancelled' } : prev)
    clearSubs()
  }, [job])

  const reset = useCallback(() => {
    clearSubs()
    setJob(null)
  }, [])

  return { job, start, cancel, reset }
}
