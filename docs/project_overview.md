# StrideSafe Web App Overview

## Summary
StrideSafe is a multi-page marketing site for a US fall-prevention platform, built as a single-page app with hash routing. It includes a main landing page, product pages, and solution pages, all sharing a consistent visual system and layout.

## Routes
- `#/` Main landing page
- `#/stridesafe-home` StrideSafe Home product page
- `#/gait-lab` StrideSafe MotionLab product page
- `#/pt-workflow` StrideSafe TherapyFlow product page
- `#/solutions/primary-care` Solution page
- `#/solutions/senior-living` Solution page
- `#/solutions/home-health` Solution page
- `#/solutions/orthopedics` Solution page

## Top Navigation
- Home
- Products (dropdown)
  - StrideSafe Home
  - StrideSafe MotionLab
  - StrideSafe TherapyFlow
- Solutions (dropdown)
  - Primary Care
  - Senior Living
  - Home Health
  - Orthopedics
- About
- Language selector
- Request a Demo

## Pages
### Landing page (`#/`)
- Hero with platform messaging and metrics
- Challenge vs. opportunity section
- Benefit pillars and reimbursement guide
- AI validation + 3-step workflow
- Impact stats and CTAs

### StrideSafe Home (`#/stridesafe-home`)
- Product hero + app highlights
- Feature grid and assessment flow
- Progress tracking, pricing, FAQ
- Email capture and CTAs

### StrideSafe MotionLab (`#/gait-lab`)
- L.Gait-style product hero
- Feature grid, partners, precision split
- Progress tracking section and FAQ
- Dual call-to-action sections

### StrideSafe TherapyFlow (`#/pt-workflow`)
- Workflow hero with time-saving metrics
- Key challenges and 5-step workflow
- Validation + contact section

### Solutions pages
All solutions share the same format:
- Hero with solution-specific messaging
- Highlight grid
- 3-step workflow section
- CTA block

## Implementation Notes
- Hash routing inside `src/App.jsx`
- Shared layout (header/footer) across pages
- Consistent design system in `src/index.css`
- US-market language, USD pricing, SOC 2 Type II compliance chip

## Local Setup
### Frontend
```bash
cd "New project"
npm run dev -- --host 127.0.0.1 --port 5173
```

### Backend
```bash
cd "New project/server"
export DATABASE_URL=postgres://<user>@localhost:5432/stridesafe_mvp
export JWT_SECRET=change_me
export EXPORT_SCHEDULE_EMAIL_ENABLED=true
export SMTP_HOST=smtp.example.com
export SMTP_PORT=587
export SMTP_SECURE=false
export SMTP_USER=your_user
export SMTP_PASS=your_pass
export EMAIL_FROM=no-reply@stridesafe.com
export EMAIL_OUTBOX_DIR="New project/server/storage/outbox"
export RATE_LIMIT_ENABLED=true
export RATE_LIMIT_WINDOW_MINUTES=10
export RATE_LIMIT_MAX=600
export RATE_LIMIT_AUTH_WINDOW_MINUTES=15
export RATE_LIMIT_AUTH_MAX=50
export RATE_LIMIT_UPLOAD_WINDOW_MINUTES=60
export RATE_LIMIT_UPLOAD_MAX=60
export TRUST_PROXY=false
npm run migrate
npm run seed
npm run dev
```

### Migration Checklist (When Tests Fail)
- [ ] Ensure Postgres is running and `DATABASE_URL` is set.
- [ ] Run all migrations: `npm run migrate` (server folder).
- [ ] If schema errors mention missing columns/tables, re-run the latest migrations:
  - `db/migrations/0014_add_assessment_defaults.sql`
  - `db/migrations/0015_add_assessment_qa.sql`
  - `db/migrations/0016_add_pt_fields.sql`
  - `db/migrations/0017_add_report_type.sql`
  - `db/migrations/0018_add_resident_location.sql`
  - `db/migrations/0019_add_fall_events.sql`
  - `db/migrations/0020_add_fall_checklist.sql`
  - `db/migrations/0021_add_facility_units.sql`
