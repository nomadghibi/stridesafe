# Test Report

## Run
- Command: `DATABASE_URL=postgres://fredd@localhost:5432/stridesafe_mvp npm test`
- Location: `server/`
- Result: 15 passed, 0 failed

## Coverage Summary
- Export token security
- Report contract + versioning
- Scoring validation by protocol
- Workflow status transitions + queue filters
- Facility isolation + role gating

## What The Tests Prove
### Export Tokens
- Clinicians cannot list or revoke tokens for other facilities.
- Token verification returns active status.
- Revoked tokens cannot be downloaded.
- Expired tokens return 410.
- Successful downloads create audit log entries.

### Reports
- Report metadata (`template_version`, `generated_at`, `generated_by`, `finalized`) is stored.
- Finalized reports block clinician regeneration.
- Admin regeneration creates a new report without mutating prior metadata.

### Scoring
- `tug_only` requires `tug_seconds`.
- `balance_only` requires all balance fields.
- `tug_chair_balance` requires tug + chair + balance fields.
- Out-of-range numeric scores are rejected.

### Workflow
- Clinicians can only advance status; admins can override.
- `overdue=true` returns overdue items.
- `overdue=false&due_within=3` returns upcoming items.
- Overdue items report `sla_status=overdue`.

### Facility Isolation
- Clinicians cannot access other facilities’ residents, assessments, reports, or exports.
- Only admins can access audit logs and user management.
- Clinicians cannot update facility defaults.
