3. Devices Page

Create a separate page called Devices.

Purpose

This page is for reviewing all managed devices from Intune and surfacing device health, update status, and any issues that require attention.

Data Source
Pull all devices from Intune
Required Fields for Each Device

For each device, display the following fields:

Windows Update Status
Possible states:
Needs update
Updated
If the device needs updates, allow the user to click an action to start the update process
Driver Update Status
Same logic as Windows Update Status
Possible states:
Needs update
Updated
If driver updates are needed, allow the user to trigger the update
Diagnostics Downloads
Allow users to download any available diagnostics for the device
Compliance Status
Show whether the device is compliant or non-compliant
Device Review and Attention Logic
Review all devices and identify devices that need attention
Surface warnings or alerts for issues such as:
Pending Windows updates
Pending driver updates
Non-compliance
Available diagnostics indicating possible issues
Clearly highlight devices that need action
UX Expectations
Make it easy to scan device health at a glance
Use clear status indicators, warnings, and action buttons
Prioritize visibility of devices requiring attention

Devices
Intune device inventory
Update and driver status
Diagnostics download
Compliance monitoring
Attention and warning indicators