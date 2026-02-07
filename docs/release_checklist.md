# Release Checklist (Prime Time)

Use this checklist before production or pilot launches.

## Product Readiness
- [ ] Core workflows validated with pilot users (assessment → report → follow-up)
- [ ] Post-fall incident flow confirmed end-to-end
- [ ] Reports finalized and approved by clinical lead
- [ ] Admin workflows (units, exports, audit logs) verified

## Security & Compliance
- [ ] Facility isolation checks pass in all endpoints
- [ ] Role permissions validated (admin vs clinician)
- [ ] PHI not stored in localStorage (token + flags only)
- [ ] Audit logs enabled for exports, reports, and admin actions
- [ ] HTTPS enabled in production

## Infrastructure & Ops
- [ ] Database backups scheduled
- [ ] Monitoring + alerting configured (API errors, failed exports)
- [ ] SMTP configured (or outbox procedure documented)
- [ ] Storage retention policy defined for videos/reports
- [ ] Rate limiting enabled for auth and upload endpoints

## Data Quality
- [ ] Video validation rules documented (min duration/resolution)
- [ ] Scoring validation rules enforced per protocol
- [ ] Report contract versioned and stable

## QA & Testing
- [ ] API tests pass (`server/npm test`)
- [ ] Manual smoke tests completed (login, upload, scoring, report)
- [ ] Export download and scheduled exports verified

## Documentation
- [ ] `docs/project_overview.md` updated
- [ ] `docs/security.md` updated
- [ ] `docs/workflow.md` updated
- [ ] Release notes drafted

## Pilot Success Metrics
- [ ] Define target fall reduction KPI
- [ ] Define post-fall follow-up compliance KPI
- [ ] Define reporting time reduction KPI
