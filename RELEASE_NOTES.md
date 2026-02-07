# Release Notes

## v0.1.0 — Pilot-Ready MVP

StrideSafe v0.1.0 is the pilot-ready MVP focused on senior living and home health fall-risk workflows.

### Highlights
- Marketing site (EN/ES) with full product and solution pages
- Clinician/Admin portal with residents, assessments, video upload, scoring, and PDF reports
- Post-fall incident module with compliance scorecard and unit rollups
- Workflow queue with SLA badges and filtering
- Secure exports with tokenized downloads and scheduled delivery
- Notifications with email delivery + outbox fallback
- Multi-tenant facility isolation and role-based access controls

### Docs
- PRD and system overview
- Security model, workflow rules, report contract, scoring spec
- Agentic automation reference and release checklist

### Notes
- Scheduled exports can send SMTP email if configured; otherwise emails are queued in the outbox.
- Facility isolation is enforced across API routes; PHI is not stored in localStorage.
