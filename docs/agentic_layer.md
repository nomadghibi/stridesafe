# Agentic Layer (MVP-Safe Automation)

## Objective
Introduce low-risk automation that improves follow-up compliance, reduces missed tasks, and tightens operational accountability without changing clinical decisions or creating compliance risk.

## Target Users
- Admins (operational accountability, SLA visibility)
- Clinicians (task reminders, follow-up tracking)

## Scope
In-scope:
- Deterministic, rule-based automation (no ML, no autonomous clinical decisions)
- Automated task creation for follow-ups and SLAs
- Notification escalation (in-app + email)
- Drafting (not finalizing) report narratives

Out of scope:
- Automated clinical scoring or risk tier changes
- Auto-finalizing reports
- Autonomous care plan approvals

## Core Features
- Trigger engine for events (assessment completed, fall event created, report generated, queue item overdue, export schedule run)
- Policy rules with deterministic logic
- Task generator that writes to `task_queue`
- Notification escalation with audit logging
- Human-in-the-loop gates for any clinical documentation changes

## Data Model (Minimal Additions)
- `automation_runs`
  - `id`, `rule_id`, `trigger`, `entity_id`, `status`, `error`, `created_at`
- `automation_actions`
  - `id`, `run_id`, `action_type`, `entity_id`, `result`, `created_at`

Reused tables:
- `task_queue`
- `notifications`
- `audit_logs`

## Security and Compliance
- Facility isolation enforced on all writes
- No PHI in localStorage
- All automated actions logged with `rule_id`, `reason`, `time`, and `result`

## Success Metrics
- Post-fall follow-up completion rate
- SLA compliance rate
- Reduction in overdue tasks
- Admin engagement with escalation notifications

## Acceptance Criteria (MVP)
- AC-1 Post-fall follow-up
  - A fall event creates a follow-up task with due date `+X days`
  - Task appears in the workflow queue for the correct facility only
- AC-2 SLA escalation
  - Overdue tasks show red SLA badges after 24 hours
  - Admins receive in-app and email notifications for overdue items
- AC-3 Auditability
  - Every automated action writes an audit log entry with `rule_id` and `entity_id`
- AC-4 Safety gate
  - Agentic layer can draft, but cannot finalize reports
- AC-5 Role boundaries
  - Clinicians cannot override admin-only automation rules

## Phased Rollout Plan
- Phase 1 (2-3 weeks): Safe automation
  - Post-fall follow-up task creation
  - SLA overdue escalation notifications
  - Audit logging for automated actions
- Phase 2 (3-5 weeks): Workflow assist
  - Draft report narrative suggestions
  - Automated reminders for missing videos
  - Admin override settings for rules
- Phase 3 (6-10 weeks): Ops intelligence
  - Rule performance analytics
  - SLA compliance dashboards by unit
  - Optional integration hooks (email/SMS)
