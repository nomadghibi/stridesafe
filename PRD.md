# StrideSafe PRD

**Version**
- Date: 2026-02-05
- Owner: Product
- Status: Expanded draft based on current codebase

**Product Overview**
StrideSafe is a fall-prevention platform for the US market focused on senior living and home health. It combines a multi‑page marketing site (EN/ES) with a clinician/admin portal for resident management, assessments, video upload, scoring (TUG/Chair Stand/Balance), reporting, outcomes analytics, workflow queue, exports, PT workflow documentation, and facility admin controls. The portal includes a guided onboarding checklist and pilot defaults stored in facility settings.

**Goals**
- Deliver a pilot‑ready workflow for fall risk screening.
- Provide a clean, professional clinician/admin experience with measurable outcomes.
- Enable facility‑level configuration for pilot defaults.
- Support audit logging and a basic compliance posture (SOC 2 Type II messaging, HIPAA‑aligned workflows).

**Non‑Goals (Current Phase)**
- ML gait analysis and automated risk inference.
- EHR integrations (FHIR/HL7) and real‑time interoperability.
- Billing, payments, or subscription management.
- Enterprise SSO, SCIM, or complex RBAC beyond admin/clinician.
- Native mobile apps.

**Target Markets**
- Senior living communities.
- Home health agencies.
- Outpatient PT (secondary).

**Personas**
- Clinician: Runs assessments, uploads videos, generates reports.
- Facility Admin: Manages facility defaults, users, QA, and exports.
- Operations Lead: Monitors outcomes and workflow SLAs.

**Jobs To Be Done**
- Screen resident fall risk quickly with consistent protocol.
- Produce documentation‑ready reports for clinical records.
- Track outcomes over time and across facilities.
- Keep assessment workflow on time with assignments and SLAs.

**Success Metrics**
- Time to complete first assessment < 10 minutes.
- Report generation success rate > 95%.
- Onboarding completion rate > 80% within 7 days of login.
- Weekly assessment volume per clinician meets pilot target.
- Export success rate > 99%.

**User Journeys**

1. Admin Onboarding
- Sign in.
- Open onboarding wizard automatically.
- Configure facility defaults (protocol, capture method, role policy).
- Create clinician accounts.
- Confirm first resident and assessment created.

2. Clinician Onboarding
- Sign in.
- Review onboarding checklist.
- Add resident.
- Create assessment and upload video.
- Capture scores and generate report.

3. Resident Assessment Flow
- Create resident.
- Create assessment with scheduled/due date.
- Upload video (MP4/MOV).
- Capture TUG + Chair Stand + Balance.
- Generate and download report.

4. Operations Flow
- Review outcomes analytics.
- Manage workflow queue (assignments, SLA tracking).
- Export data or run scheduled exports.

5. PT Workflow (Clinician)
- Select resident and assessment.
- Upload video, capture scores.
- Complete PT documentation (CPT, goals, plan of care, pain scale).
- Run QA (if required).
- Export PT summary PDF.

**Core Features and Requirements**

**Marketing Site**
- Multi‑page landing/product/solution pages in EN/ES.
- About page with SEO‑ready content.
- Products dropdown with StrideSafe Home, StrideSafe Gait Lab, PT Workflow.
- Solutions dropdown for Primary Care, Senior Living, Home Health, Orthopedics.
- Compliance messaging (SOC 2 Type II, HIPAA‑aligned).

**Authentication**
- Email/password login.
- Admin and clinician roles.
- Logout clears session and local state.

**Portal Navigation**
- Sidebar with role‑based visibility.
- Overview panel with analytics summary.
- Onboarding progress card with resume.
- PT Workflow panel with guided steps, checklist, and PT documentation fields.

**Onboarding Wizard**
- Modal stepper with checklist and progress.
- Auto‑complete steps based on real data:
  - Resident created.
  - Assessment created.
  - Video uploaded.
  - Report generated.
- Admin‑only facility defaults step.
- Persistent state per user in local storage.

**Residents**
- Create and edit residents.
- Search, filter, and sort.
- Drawer shows resident details and assessment history.

**Assessments**
- Create assessments with scheduled/due dates.
- Track status and risk tier.
- Quick actions for next steps.

**Video Upload**
- MP4/MOV only.
- Size and metadata validation.
- Upload progress feedback.

**Scores and Risk**
- Capture TUG, Chair Stand, Balance.
- Risk tier selection.
- Validation and save feedback.

**PT Workflow Documentation**
- CPT codes, goals, plan of care, pain scale.
- Session timer and time‑saved tracking.
- PT checklist gating PT summary export.

**Reports**
- Generate PDF assessment reports.
- PT summary PDF export for PT workflow.
- Download, preview, and report history (assessment + PT summary).

**Outcomes Analytics**
- Risk trends and resident change summaries.
- Adjustable time window.

**Workflow Queue**
- Assignment, status, and SLA indicators.
- Claim/unassign and status actions.

**Exports**
- Token‑based export links for residents, assessments, audit, bundles.
- Scheduled exports with filters.
- Export logs and facility rollup.

**Admin Tools**
- User management (create/edit/reset password).
- Facility management with pilot defaults.
- Audit logs with filters and presets.

**Facility Pilot Defaults**
- `assessment_protocol`:
  - `tug_chair_balance`
  - `tug_only`
  - `balance_only`
- `capture_method`:
  - `record_upload`
  - `upload_only`
- `role_policy`:
  - `clinician_admin_only`
  - `admin_only`

**User Stories and Acceptance Criteria**

**US‑1: Admin sets pilot defaults**
Acceptance criteria:
1. Admin can select protocol, capture method, and role policy.
2. Settings persist to the facility record.
3. Onboarding checklist step auto‑completes after save.

**US‑2: Clinician adds resident**
Acceptance criteria:
1. Required fields validated (first name, last name, DOB).
2. Resident appears in list after save.
3. Onboarding checklist updates automatically.

**US‑3: Clinician creates assessment**
Acceptance criteria:
1. Assessment dates validated.
2. Assessment appears in list and is selectable.
3. Workflow queue reflects status.

**US‑4: Clinician uploads video**
Acceptance criteria:
1. Only MP4/MOV accepted.
2. Size and metadata validated.
3. Upload progress visible.
4. Onboarding checklist auto‑completes when video exists.

**US‑5: Clinician captures scores**
Acceptance criteria:
1. Numeric validation enforced.
2. Scores persist and re‑load.
3. Risk tier displayed.

**US‑6: Clinician generates report**
Acceptance criteria:
1. Report generates successfully for valid assessment.
2. Download link works.
3. Onboarding checklist auto‑completes when report exists.

**US‑7: Admin manages users**
Acceptance criteria:
1. Admin can create clinician accounts.
2. Admin can reset passwords.
3. Role and status changes persist.

**US‑8: Admin views audit logs**
Acceptance criteria:
1. Audit logs available only to admin.
2. Filters apply correctly.

**US‑9: Exports**
Acceptance criteria:
1. Token export creates a download URL.
2. Scheduled exports can be created, paused, and run.
3. Export logs list status and timestamps.

**Non‑Functional Requirements**
- Performance: UI panels respond within 1–2 seconds for typical queries.
- Reliability: Export and report generation succeed > 95%.
- Security: Role‑based access enforced on all endpoints.
- Usability: Onboarding should be completable within one session.

**Data Model (High Level)**
- Facilities: profile + pilot defaults.
- Users: admin and clinician roles.
- Residents: demographic and notes.
- Assessments: dates, status, risk tier, PT documentation fields.
- Scores: TUG/Chair/Balance details.
- Videos: metadata and storage keys.
- Reports: PDF storage keys + `report_type` (assessment vs PT summary).
- Notifications, audit logs, exports, export schedules.

**APIs (High Level)**
- Auth: `/auth/login`, `/auth/me`.
- Facilities: `/facilities`, `/facilities/:id`.
- Users: `/users`, `/users/:id`.
- Residents: `/residents`, `/residents/:id`.
- Assessments: `/residents/:id/assessments`, `/assessments/:id`.
- Video: `/videos/upload`, `/videos/:id/download`.
- Reports: `/assessments/:id/reports`, `/assessments/:id/pt-summary`, `/reports/:id/download`.
- Analytics: `/analytics/summary`, `/analytics/outcomes`, `/analytics/facility-rollup`.
- Workflow: `/workflow/queue`, `/assessments/:id/assign`.
- Exports: `/exports/tokens`, `/exports/tokens/:id`, `/exports/logs`, `/export-schedules`.

**Localization**
- Full English and Spanish for marketing and portal.

**Compliance & Security**
- Role‑based access control.
- Audit logs for admin visibility.
- SOC 2 Type II messaging in marketing.
- HIPAA‑aligned workflows messaging.

**Risks and Mitigations**
- Risk: No ML gait model yet.
- Mitigation: Clear messaging that scoring is clinician‑entered and standardized.

- Risk: Manual video upload errors.
- Mitigation: Validation rules and onboarding guidance.

**Open Questions**
- Which EHR integrations are highest priority?
- Required report formats for pilot partners?
- Target SLA expectations per facility?
- Any regulatory constraints beyond HIPAA/SOC 2?

**Milestones (Suggested)**
- Phase 1: Pilot‑ready MVP (complete).
- Phase 2: Operational analytics and QA (complete).
- Phase 3: Workflow queue + scheduled exports + rollup (complete).
- Phase 4: Scale & growth (draft for later).

**Senior Living Value Additions (Sellability)**
**Clinical value upgrades (additional assessments)**
- 4‑Stage Balance Test.
- Gait Speed (4m or 10m).
- SPPB (Short Physical Performance Battery).
- Berg Balance Scale.
- STEADI‑aligned screening.
- Dual‑task TUG (optional).

**Documentation + compliance**
- 1‑click clinical narrative (SOAP‑style summary).
- Clinician attestation + e‑signature (typed + timestamp).
- Report finalization + amendment history.

**Incident + post‑fall workflow**
- Fall Event intake: date/time, location, witness, injury level, EMS/hospital, suspected causes.
- Post‑fall checklist: vitals, neuro check, med review flag, environment check, follow‑up due.
- Link incident to resident + most recent risk screen.

**Intervention engine**
- Care plan recommendations by risk tier.
- PT referral triggers, environmental actions, medication review flags.
- Follow‑up cadence rules (30/60/90 days).

**Outcomes + ROI**
- Falls per 1,000 resident‑days.
- Falls with injury KPI.
- Risk‑tier and score improvement tracking.
- Time‑to‑screen compliance and unit benchmarking.
- ROI estimator (estimated cost avoided).

**Workflow automation**
- Due/overdue queue rules.
- Automated reminders (email/SMS/in‑app).
- Escalations on SLA breaches.

**Integrations**
- CSV exports with stable schemas + scheduled delivery.
- EHR document package export (PDF + JSON/CSV bundle).
- FHIR export (Phase 2).
- Optional incident/QAPI integrations.

**Video capture enhancements**
- In‑browser capture + framing guidance.
- Quality checks: lighting, shaky camera, too‑short duration.
- Standardized capture protocol per facility.

**Differentiators (moat)**
- ML‑assisted gait markers (future).
- Longitudinal risk prediction.
- Cross‑facility benchmarking network (opt‑in).

**Fastest Value Increase (Pilot Sales)**
- Fall Incident module + post‑fall checklist.
- Care plan recommendations + follow‑up scheduling.
- Report narrative + e‑signature/finalize.
- Outcomes/ROI dashboard (v1).

**Senior Living 30/60/90 Roadmap**
- 0‑30 days: Fall incidents + post‑fall checklist + unit/room fields.
- 31‑60 days: Interventions/care plans + assignments + re‑screen cadence.
- 61‑90 days: QAPI dashboard + unit benchmarking + QAPI‑ready exports.
