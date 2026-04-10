/**
 * sse.ts — Desktop (Electron) version
 *
 * In the web app, event subscriptions use a real SSE stream (EventSource).
 * In the desktop app, they are delivered via Electron IPC events instead.
 * The implementations live in api.ts — this file re-exports them so that
 * all pages importing from '../lib/sse' work unchanged in both builds.
 */

export {
  onJobLog,
  onJobPhaseChange,
  onJobComplete,
  onJobError,
  onJobPackageComplete,
  onCacheAppsUpdated,
  onCacheDevicesUpdated,
  onCacheInstallStatsUpdated,
  onCacheUpdateStatesUpdated,
  onCacheUEAScoresUpdated,
  onCacheAutopilotEventsUpdated,
  onRecommendationsUpdated
} from './api'
