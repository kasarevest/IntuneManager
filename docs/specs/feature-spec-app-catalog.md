1. App Catalog Page

Create a new page called “App Catalog” with the following features:
Move the 
AI-Based Recommendations from deploy to app catalog. 
Deploy action will create the intunewin file and ask the user if he wants to deploy. The intunewin file will now move to deploy page.
Search Functionality will also be moved to app catalog
This page is strictly for discovery and exploration, all deployment will move the app to the deployment page

2. Deployment Page

Refactor the Deployment Page to focus only on deployable assets.

Deployable Apps List
Display a list of applications that are ready for deployment
Source of truth: generated .intunewin files in the output directory
Apps clicked in App catalog for deployment
Each app should be displayed in the same tile/card format:
App logo
App name
Short description
Deploy button
Details button
Deployment Action
Clicking Deploy initiates the deployment process

3. Workflow Separation
Enforce a strict separation of concerns:
App Catalog → discovery, recommendation, and search
Deployment Page → execution of deployments only
.intunewin creation remains a prerequisite step outside the deployment page
Only apps with completed packaging should appear in the Deployment Page
Expected Outcome
A cleaner, more modular system with:
Clear distinction between browsing and deploying apps
Reduced UI complexity
Improved user control over deployment readiness and execution