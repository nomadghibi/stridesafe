# StrideSafe

[![CI](https://github.com/nomadghibi/stridesafe/actions/workflows/ci.yml/badge.svg)](https://github.com/nomadghibi/stridesafe/actions/workflows/ci.yml)

StrideSafe is a fall-risk screening and post-fall workflow platform for senior living and home health. It combines standardized assessments, video capture, reporting, workflow accountability, and outcomes analytics in a single clinician and admin portal.

## Highlights
- Clinician/Admin portal with residents, assessments, video upload, scoring, and PDF reports
- Post-fall incident tracking with compliance scorecards and unit rollups
- Workflow queue with SLA badges and escalations
- Secure exports with tokenized downloads and scheduled delivery (email + outbox fallback)
- Multi-tenant facility isolation and role-based access controls

## Tech Stack
- Frontend: Vite + React
- Backend: Express + PostgreSQL + JWT
- Docs: `/docs`

## Repo Structure
- `src/` – Frontend app (Vite/React)
- `server/` – API server (Express)
- `db/` – SQL migrations and seed data
- `docs/` – Product and technical documentation

## Local Setup (Quick Start)
Prerequisites:
- Node.js (LTS)
- PostgreSQL
- `ffmpeg` (for video validation)

Install dependencies:
```bash
npm install
cd server && npm install
```

Set server environment:
```bash
cp server/.env.example server/.env
# then edit server/.env (DATABASE_URL, JWT_SECRET, etc.)
```

Run migrations + seed:
```bash
cd server
npm run migrate
npm run seed
```

Start the app:
```bash
# frontend
npm run dev

# backend (separate terminal)
cd server
npm run dev
```

Run API tests:
```bash
cd server
DATABASE_URL=postgres://<user>@localhost:5432/stridesafe_mvp npm test
```

## Documentation
- Product scope: `PRD.md`
- System overview: `docs/project_overview.md`
- Security model: `docs/security.md`
- Workflow rules: `docs/workflow.md`
- Report contract: `docs/report_contract.md`
- Scoring spec: `docs/scoring_spec.md`
- Agentic layer (reference): `docs/agentic_layer.md`

## Notes
- Facility isolation is mandatory across all API routes.
- Do not store PHI in localStorage (token + non-identifying flags only).
- Scheduled exports can send email or fall back to a local outbox.
