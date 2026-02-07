# StrideSafe Web App Overview

_Canonical copy: `docs/project_overview.md`._ 

## Summary
StrideSafe is a multi-page marketing site for a US fall‑prevention platform, built as a single‑page app with hash routing. It includes a main landing page, product pages, and solution pages, all sharing a consistent visual system and layout.

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
- AI validation + 3‑step workflow
- Impact stats and CTAs

### StrideSafe Home (`#/stridesafe-home`)
- Product hero + app highlights
- Feature grid and assessment flow
- Progress tracking, pricing, FAQ
- Email capture and CTAs

### StrideSafe MotionLab (`#/gait-lab`)
- L.Gait‑style product hero
- Feature grid, partners, precision split
- Progress tracking section and FAQ
- Dual call‑to‑action sections

### StrideSafe TherapyFlow (`#/pt-workflow`)
- Workflow hero with time‑saving metrics
- Key challenges and 5‑step workflow
- Validation + contact section

### Solutions pages
All solutions share the same format:
- Hero with solution‑specific messaging
- Highlight grid
- 3‑step workflow section
- CTA block

## Implementation Notes
- Hash routing inside `New project/src/App.jsx`
- Shared layout (header/footer) across pages
- Consistent design system in `New project/src/index.css`
- US‑market language, USD pricing, SOC 2 Type II compliance chip

## Run
```bash
cd "New project"
npm run dev -- --host 127.0.0.1 --port 5173
```
