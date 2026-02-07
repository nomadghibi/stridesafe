# Security & Access Control

## Roles
- Admin: Manages facility settings, users, audit logs, exports, and all clinical workflows.
- Clinician: Manages residents, assessments, videos, scores, reports, and exports for their facility.

## Permission Matrix
| Capability | Admin | Clinician |
| --- | --- | --- |
| Sign in / view own profile | Yes | Yes |
| View residents / assessments / reports (own facility) | Yes | Yes |
| Create or update residents / assessments | Yes | Yes |
| Upload videos / generate reports | Yes | Yes |
| Export residents / assessments (own facility) | Yes | Yes |
| Export audit data | Yes | No |
| Manage facility defaults (cadence, turnaround, QA, protocol, capture, role policy) | Yes | No |
| Manage users (list/create/update) | Yes | No |
| View audit logs | Yes | No |
| Manage export schedules / logs | Yes | No |

## Facility Isolation
- All API requests require JWT auth (`Authorization: Bearer <token>`).
- Facility-scoped resources are checked against `req.user.facility_id`.
- Admin requests currently bypass facility checks for resource IDs and can specify `facility_id` on export endpoints.
- Clinicians are restricted to their own facility across resident, assessment, report, export, and audit endpoints.

## Client Storage
- `localStorage` is used only for auth token, user object, and onboarding flags.
- Onboarding state is sanitized to `{ completed, dismissed, checks }` and a dev guard blocks PHI/PII keys from being persisted.
