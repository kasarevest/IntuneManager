
---

## Feature Spec: Defender for Endpoint Metrics Dashboard

### Overview
Update the application to include a new **Security Dashboard** page. This page will connect to the **Microsoft Defender for Endpoint** (formerly Windows Defender ATP) API to fetch and visualize critical security health and alert metrics for the organization.

### Connection Requirements
The system must support authentication via **Microsoft Entra ID** (formerly Azure AD). 
* **API Resource URI:** `https://api.securitycenter.microsoft.com`.
* **Required Permissions:** `Alert.Read.All`, `Machine.Read.All`.

### Functional Requirements
The dashboard must display the following key metrics:

| Metric Category | Data Points to Display | API Endpoint (Example) |
| :--- | :--- | :--- |
| **Alert Summary** | Total Active Alerts, Count by Severity (High, Medium, Low, Informational) | `/api/alerts` |
| **Machine Health** | Total Onboarded Devices, Inactive/Out-of-date agents | `/api/machines` |
| **Incident Status** | Number of "In Progress" vs "Resolved" incidents | `/api/incidents` |
| **Active Threats** | List of top 5 most recent alerts with Title, Severity, and Impacted Machine | `/api/alerts?$top=5` |
| **Secure score** | List organisations secure score and top recommendations  |  |

### UI & Navigation
* **New Page:** Create a dedicated route (e.g., `/dashboard/defender`).
* **Visual Elements:** Use cards for high-level counts and a data table for the "Active Threats" list.


### Implementation Logic
1.  **Validation:** If the Defender API credentials are not configured in Settings, the Dashboard page should display a "Connection Required" state with a link to the Settings page.
2.  **Data Fetching:** Upon loading the page, the application should request an access token from the Microsoft identity platform using the stored credentials.
3.  **Error Handling:** Handle `401 Unauthorized` (expired secret) and `403 Forbidden` (missing API permissions) errors gracefully with user-friendly prompts.

---
