# Feature Spec: Claude AI Connection Settings

**Status:** ✅ Completed  
**Completed:** 2026-04-10

---

Implementation Prompt:

Update the Settings page to support two Claude connection options:

Direct Claude API configuration
AWS SSO login for AWS Bedrock-based Claude access

Only one connection method is required. The settings form should validate successfully if either the API connection or AWS SSO / Bedrock connection is configured. If neither is present, show an error that at least one Claude connection method is required.

AWS SSO should be treated as an alternative Claude access path using the organization’s AWS Bedrock environment. Make the UI clear that these are two optional connection methods, but at least one must be configured.