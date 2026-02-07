# StrideSafe Web App Overview

## Summary
StrideSafe is a multi-page marketing site for a US fall-prevention platform, built as a single-page app with hash routing. It includes a main landing page, product pages, and solution pages, all sharing a consistent visual system and layout.

## Routes
- `#/` Main landing page
- `#/stridesafe-home` StrideSafe Home product page
- `#/gait-lab` StrideSafe Gait Lab product page
- `#/pt-workflow` PT Workflow product page
- `#/solutions/primary-care` Solution page
- `#/solutions/senior-living` Solution page
- `#/solutions/home-health` Solution page
- `#/solutions/orthopedics` Solution page

## Top Navigation
- Home
- Products (dropdown)
  - StrideSafe Home
  - StrideSafe Gait Lab
  - PT Workflow
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

### StrideSafe Gait Lab (`#/gait-lab`)
- L.Gait-style product hero
- Feature grid, partners, precision split
- Progress tracking section and FAQ
- Dual call-to-action sections

### PT Workflow (`#/pt-workflow`)
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
