CRITICAL (Workflow):
  - No AAD group assignment UI — Apps deploy but aren't assigned to any users/devices. Manual portal work required.

  BLOCKING (Technical):
  - No timeout on PowerShell scripts — Hung scripts leave jobs in "running" state indefinitely
  - 20-iteration Claude limit with no recovery — Partial state (files, scripts) left on disk with no cleanup

  MAJOR:
  - Path traversal vulnerability — generate_install_script writes to sourceFolder from Claude without validation
  - app_deployments table unused — No audit trail; all history lost when log cleared
  - Non-semver version comparison fails — Date-based versions never show "Update Available"

Needs Improvement:
  - No PS script timeouts
  - No deployment history persistence
  - Limited input validation on AI-provided paths
  - Settings paths not validated until runtime

Recommendations

  Immediate (BLOCKING):
  1. Add PS script timeouts (300s downloads, 60s queries)
  2. Implement path validation for AI-provided sourceFolder
  3. Add recovery for 20-iteration Claude limit

  High Priority (MAJOR):
  1. Implement AAD group assignment UI
  2. Persist deployment history to app_deployments table
  3. Improve version comparison for non-semver formats

  Medium Priority:
  1. Add settings path validation with inline feedback
  2. Implement startup cleanup of orphaned "running" jobs
  3. Add post-queue summary for Update All