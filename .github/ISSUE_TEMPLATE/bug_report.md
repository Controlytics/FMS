---
name: Bug Report
about: Report a bug in DigiLog for structured tracking and resolution
title: "[BUG] "
labels: bug
assignees: ''
---

## Bug Title
<!-- Clear, concise description of the bug -->

## Module
<!-- Which module is affected? -->
- [ ] Authentication
- [ ] User Management
- [ ] Role Management
- [ ] Entity Management — Templates
- [ ] Entity Management — Instances
- [ ] Entity Management — Relationships
- [ ] Entity Management — Identifiers
- [ ] Configuration
- [ ] Audit Trail
- [ ] Notifications
- [ ] Uploads
- [ ] Backup
- [ ] Frontend — UI/UX
- [ ] Other: ___________

## Severity
- [ ] CRITICAL — System unusable, data loss, security vulnerability
- [ ] HIGH — Major feature broken, no workaround
- [ ] MEDIUM — Feature partially broken, workaround exists
- [ ] LOW — Minor issue, cosmetic, edge case

## Description
<!-- Detailed description of the bug -->

## Steps to Reproduce
1.
2.
3.
4.

## Expected Behavior
<!-- What should happen -->

## Actual Behavior
<!-- What actually happens -->

## Root Cause (after analysis)
<!-- Fill this in after investigating the bug -->

## Environment
- **Browser:**
- **OS:**
- **API Version:**
- **Database:** PostgreSQL 16
- **Deployment:** EC2 / Local Docker

## Screenshots / Logs
<!-- Attach any relevant screenshots, console errors, or API response logs -->

## Additional Context
<!-- Any other relevant information -->

---

### Resolution Checklist (for the fixer)
- [ ] Root cause identified and documented
- [ ] Fix implemented with no regression
- [ ] Fix has no side effects on other modules
- [ ] Proper validation added/verified
- [ ] Entry added to `/documentation/Bug_Resolution_Log.md`
- [ ] Tests added/updated to cover this bug
- [ ] PLAN.md updated
- [ ] BUSINESS_CONTEXT.md updated (if business impact)
- [ ] CODEBASE_CONTEXT.md updated (if architecture change)
