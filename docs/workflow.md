# Workflow State Machine

## Statuses (Current MVP)
- `draft`: Created but not yet scheduled.
- `needs_review`: Scheduled or pending review. Default on creation.
- `in_review`: Review in progress (video captured and scoring underway).
- `completed`: Report finalized and closed.

## Transition Rules
- `draft` → `needs_review` → `in_review` → `completed`
- `needs_review` → `completed` (fast-track close)
- Admins can set any status; clinicians can only advance forward.

## Mapping to PRD Stages
To keep changes minimal, the MVP collapses the PRD stages into the current status set:
- `scheduled` → `needs_review`
- `video_uploaded` / `scored` / `report_generated` → `in_review`
- `closed` → `completed`

## Workflow Queue (`GET /workflow/queue`)
Default queue returns `needs_review` + `in_review`.

Supported filters:
- `status` (`all`, `draft`, `needs_review`, `in_review`, `completed`)
- `assigned` (`all`, `me`, `unassigned`)
- `assigned_to` (uuid, `me`, or `unassigned`)
- `unit_id` (uuid)
- `include_falls` (`true`/`false`, default `true`)
- `overdue` (`true`/`false`)
- `due_within` (days, integer)
- `limit` (max 500)

Fall incidents:
- When `include_falls` is enabled and no assignment/status filter is applied, the queue includes fall events with incomplete post-fall checklists.
- Fall items use `status = post_fall` and follow-up due dates are calculated from `occurred_at` + `POST_FALL_FOLLOWUP_DAYS`.

SLA calculations:
- `sla_due_at` is based on `due_date` (or `scheduled_date`/`assessment_date` fallback), using end-of-day.
- `sla_status` is `overdue` if `sla_hours_remaining < 0`.
