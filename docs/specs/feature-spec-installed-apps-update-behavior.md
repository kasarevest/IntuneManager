# Feature Spec: Installed Apps Page Update Behavior

**Status:** ✅ Completed  
**Completed:** 2026-04-10

## Summary

Update the **Installed Apps** page behavior. After WinTuner checks an installed app for available updates, the Installed Apps page should handle update actions based on the age of the available update:

* If the available update is **more than 1 week old**, the app should **auto-update**
* If the available update is **less than 1 week old**, show an **Update App** button and let the user trigger the update manually
* When an app is updated, the new version should **replace the original app** and **retain all existing assignments**
* If an app was auto-updated, show an **Updated** button/state on the Installed Apps page
* Replace the current **cloud-only icon/state** with text-based actions/status:

  * **Update App**
  * **Updated**

---

## Goals

1. Automatically update older app updates without requiring user action
2. Require user confirmation for recently released updates
3. Preserve existing app assignments during replacement
4. Improve clarity of the Installed Apps UI by replacing the cloud-only icon with explicit labels/buttons

---

## Non-Goals

* Redesigning the full Installed Apps page layout
* Changing how WinTuner detects updates
* Changing assignment logic beyond preserving existing assignments during replacement
* Introducing rollback/version history in this phase

---

## User Story

As an admin viewing the Installed Apps page, I want the system to either auto-update or prompt me to update an app depending on how old the available update is, so that older stable updates are applied automatically while newer updates still give me control.

---

## Functional Requirements

### 1. Update Detection

After WinTuner performs an update check for an installed app, the Installed Apps page must receive and display the update state for that app.

For each installed app, the system must determine:

* whether an update is available
* the release date or age of the available update
* whether the update should be auto-applied or manually triggered

---

### 2. Auto-Update Rule

If the available update is **more than 7 days old**, the system must automatically update the installed app.

#### Behavior

* Auto-update begins after update availability is confirmed
* The updated app replaces the currently installed app entry/version
* All existing assignments associated with the original app must be preserved and carried over
* After successful auto-update, the Installed Apps page must show an **Updated** button or status indicator

#### Notes

* “More than 1 week old” means strictly older than 7 days from the update release timestamp
* The exact comparison should use a consistent server-side timestamp

---

### 3. Manual Update Rule

If the available update is **7 days old or newer**, the Installed Apps page must display an **Update App** button.

#### Behavior

* The app is not updated automatically
* The user can click **Update App** to apply the update
* On update success:

  * the updated app replaces the original app
  * all assignments are preserved
  * the UI changes from **Update App** to **Updated**

---

### 4. Assignment Preservation

Whenever an app is updated, whether automatically or manually:

* the new app version must replace the original app
* all app assignments from the original app must remain intact
* no reassignment should be required from the user

This includes any group, device, or policy associations currently attached to the original app, depending on how assignments are defined in the product.

---

### 5. Installed Apps Page UI Changes

#### Replace Cloud-Only Icon

The existing cloud-only icon/state should be removed or replaced for update-related actions/status.

#### New Labels / States

Use explicit text-based actions/status instead:

* **Update App**
  Shown when an update is available and is less than 1 week old

* **Updated**
  Shown after an app has been auto-updated or manually updated successfully

#### Recommended UI State Table

| App State                              | Condition                          | UI                        |
| -------------------------------------- | ---------------------------------- | ------------------------- |
| No update available                    | App is current                     | No update action shown    |
| Update available, less than 1 week old | Manual update required             | **Update App** button     |
| Update available, more than 1 week old | Auto-update completed successfully | **Updated** button/status |
| Manual update completed                | User clicked update successfully   | **Updated** button/status |

---

## Detailed Logic

### Decision Logic

For each installed app after update check:

1. WinTuner detects whether an update is available
2. System reads the release date of the available update
3. Calculate update age:

   * `update_age = current_time - update_release_time`
4. Apply rule:

   * if `update_age > 7 days` → auto-update
   * else → show **Update App**
5. After successful update:

   * replace original app with updated app
   * preserve assignments
   * display **Updated**

---

## Edge Cases

### Update exactly 7 days old

Define expected behavior explicitly:

* Recommended: treat **exactly 7 days old** as **manual update**
* Auto-update only when the update is **older than** 7 days

This aligns best with your wording: “more than 1 week old.”

### Failed Auto-Update

If auto-update fails:

* do not show **Updated**
* retain the original installed app entry
* surface an error state or retry behavior based on existing platform conventions

### Failed Manual Update

If the user clicks **Update App** and the update fails:

* keep the **Update App** button available
* optionally show an inline error/toast message
* do not remove or alter assignments

### Assignment Migration Failure

If the new version is installed but assignments cannot be preserved:

* treat the update as failed
* do not finalize replacement until assignments are confirmed migrated

### Multiple Updates Available

If more than one newer version exists:

* update directly to the latest eligible version according to current product update rules
* preserve assignments across the replacement

---

## UX Requirements

### Button Copy

* Use **Update App** for manual update action
* Use **Updated** for post-update state
* Do not use the cloud-only icon for these states

### Visual Behavior

* **Update App** should appear as an actionable button
* **Updated** can be styled as a disabled button, badge, or non-primary status button, depending on the current design system

### Consistency

The same labels should be used anywhere this update state appears on the Installed Apps page.

---

## Acceptance Criteria

### AC1: Manual Update Button

**Given** an installed app has an available update released less than 7 days ago
**When** the Installed Apps page loads after update check
**Then** the app shows an **Update App** button
**And** the app is not auto-updated

### AC2: Auto-Update for Older Updates

**Given** an installed app has an available update released more than 7 days ago
**When** the Installed Apps page processes the update result
**Then** the app is automatically updated
**And** the updated app replaces the original app
**And** all assignments are preserved
**And** the UI shows **Updated**

### AC3: Manual Update Success

**Given** an installed app shows an **Update App** button
**When** the user clicks **Update App** and the update succeeds
**Then** the updated app replaces the original app
**And** all assignments are preserved
**And** the UI changes to **Updated**

### AC4: No Update Available

**Given** no update is available for an installed app
**When** the Installed Apps page loads
**Then** no **Update App** or **Updated** update-state control is shown

### AC5: Icon Replacement

**Given** an app has an update-related state
**When** the Installed Apps page renders
**Then** the cloud-only icon is not used for that update state
**And** text-based labels are used instead

---

## Open Questions

1. Should **Updated** remain visible permanently, or only for the current session / until next refresh? Until next refresh
2. Should auto-update happen immediately after detection, or during the next sync cycle? Next sync cycle
3. Should users see any distinction between: No

   * manually updated
   * auto-updated
4. Should there be an **Updating** transient state while the update is in progress? yes
5. Should admins get any audit/event log entry when an app auto-updates? Yes

---

## Recommended Implementation Notes

* Evaluate update age on the backend to avoid timezone/client inconsistencies
* Preserve assignment mappings transactionally during replacement
* Only show **Updated** after the replacement and assignment preservation both succeed
* Use explicit state names in code, for example:

  * `NO_UPDATE`
  * `UPDATE_AVAILABLE_MANUAL`
  * `UPDATE_IN_PROGRESS`
  * `UPDATE_COMPLETED`

---


