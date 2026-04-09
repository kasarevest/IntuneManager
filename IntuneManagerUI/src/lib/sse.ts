/**
 * sse.ts — Server-Sent Events subscriptions (replaces api.on() / api.once() in ipc.ts)
 *
 * The server pushes all events on a single GET /api/events SSE stream.
 * Each event payload is JSON: { channel: string, data: unknown }
 * Subscribers filter by channel name.
 *
 * Usage mirrors the old Electron IPC on() pattern:
 *   const unsub = onJobLog(handler)   // returns cleanup function
 *   unsub()                           // removes listener
 */

import type { LogEntry } from '../types/app'
import type { IntuneAppsRes, GetDevicesRes, AppInstallStatsRes, UpdateStatesRes, UEAScoresRes, AutopilotEventsRes, GetRecommendationsRes } from '../types/ipc'

type Listener = (data: unknown) => void

// ─── Singleton SSE connection ─────────────────────────────────────────────────

let eventSource: EventSource | null = null
const listeners = new Map<string, Set<Listener>>()

function getEventSource(): EventSource {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return eventSource

  eventSource = new EventSource('/api/events')

  eventSource.onmessage = (e: MessageEvent) => {
    try {
      const { channel, data } = JSON.parse(e.data as string) as { channel: string; data: unknown }
      const channelListeners = listeners.get(channel)
      if (channelListeners) {
        for (const fn of channelListeners) fn(data)
      }
    } catch { /* ignore malformed events */ }
  }

  eventSource.onerror = () => {
    // Browser will auto-reconnect on error — no action needed
  }

  return eventSource
}

function subscribe(channel: string, callback: Listener): () => void {
  getEventSource() // ensure connection is open

  if (!listeners.has(channel)) listeners.set(channel, new Set())
  listeners.get(channel)!.add(callback)

  return () => {
    listeners.get(channel)?.delete(callback)
  }
}

// ─── Job events ───────────────────────────────────────────────────────────────

export const onJobLog = (callback: (data: LogEntry) => void): (() => void) =>
  subscribe('job:log', callback as Listener)

export const onJobPhaseChange = (callback: (data: { jobId: string; phase: string; label: string }) => void): (() => void) =>
  subscribe('job:phase-change', callback as Listener)

export const onJobComplete = (callback: (data: { jobId: string; appId?: string }) => void): (() => void) =>
  subscribe('job:complete', callback as Listener)

export const onJobError = (callback: (data: { jobId: string; error: string; phase: string }) => void): (() => void) =>
  subscribe('job:error', callback as Listener)

export const onJobPackageComplete = (callback: (data: { jobId: string; intunewinPath: string | null; packageSettings: Record<string, unknown> | null }) => void): (() => void) =>
  subscribe('job:package-complete', callback as Listener)

// ─── Cache update events (background refresh notifications) ───────────────────

export const onCacheAppsUpdated = (cb: (data: IntuneAppsRes) => void): (() => void) =>
  subscribe('ipc:cache:apps-updated', cb as Listener)

export const onCacheDevicesUpdated = (cb: (data: GetDevicesRes) => void): (() => void) =>
  subscribe('ipc:cache:devices-updated', cb as Listener)

export const onCacheInstallStatsUpdated = (cb: (data: AppInstallStatsRes) => void): (() => void) =>
  subscribe('ipc:cache:install-stats-updated', cb as Listener)

export const onCacheUpdateStatesUpdated = (cb: (data: UpdateStatesRes) => void): (() => void) =>
  subscribe('ipc:cache:update-states-updated', cb as Listener)

export const onCacheUEAScoresUpdated = (cb: (data: UEAScoresRes) => void): (() => void) =>
  subscribe('ipc:cache:uea-scores-updated', cb as Listener)

export const onCacheAutopilotEventsUpdated = (cb: (data: AutopilotEventsRes) => void): (() => void) =>
  subscribe('ipc:cache:autopilot-events-updated', cb as Listener)

export const onRecommendationsUpdated = (cb: (data: GetRecommendationsRes) => void): (() => void) =>
  subscribe('recommendations-updated', cb as Listener)
