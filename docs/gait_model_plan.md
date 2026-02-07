# Gait Model Build Plan (MVP)

## Goal
Ship a clinically defensible, pose-based gait model that delivers:
- TUG time (seconds)
- Chair-stand time (seconds)
- Balance pass/fail (side-by-side, semi-tandem, tandem)

Risk tier will follow after sufficient labeled outcomes.

## Current Build Status
- `gait_model_runs` table tracks model runs per video + assessment.
- Video upload now queues a `gait_model_extract` task.
- Task runner executes a stub model and stores results with notes.
- Optional script hook via `GAIT_MODEL_SCRIPT`.

## 6-Week Execution Plan
### Week 1 — Capture Protocol + Data Pipeline
- Lock camera angle, distance, lighting, and instructions.
- Update capture checklist in pilot facilities.
- Record 20–30 pilot videos across settings.
- Validate upload quality checks (duration, resolution, framing).

### Week 2 — Pose Extraction Baseline
- Integrate a pose engine (MediaPipe or OpenPose).
- Build pose extraction script (video → keypoints JSON).
- Store keypoints (or compressed features) for analysis.

### Week 3 — Feature Engineering
- Extract temporal features: cadence, stride time, step count.
- Extract sit-to-stand duration and balance sway.
- Produce a per-video feature vector.

### Week 4 — Model Training
- Train baseline regressors for TUG + chair stand.
- Train balance classifiers (pass/fail for each stance).
- Measure MAE and accuracy on a held-out validation split.

### Week 5 — Clinical Review
- Compare model outputs vs clinician timing.
- Run blinded review for face validity.
- Add confidence flags (high / medium / low).

### Week 6 — MVP Release
- Wire outputs into assessment detail + report template.
- Add model version tracking and audit log entries.
- Publish model validation summary for pilots.

## Data Capture Protocol (Summary)
- Single phone camera, waist height.
- 10–12 feet from subject, full-body in frame.
- Neutral lighting; avoid backlight.
- 30–45 seconds max.

## Model Output Contract (MVP)
Fields stored in `gait_model_runs`:
- `tug_seconds`
- `chair_stand_seconds`
- `balance_side_by_side`
- `balance_semi_tandem`
- `balance_tandem`
- `confidence`
- `model_version`
- `notes`

## How to Enable a Real Script
Set the following env vars on the API:
- `GAIT_MODEL_SCRIPT=gait_model_stub.py` (or your real script)
- `GAIT_MODEL_VERSION=v1`
- `GAIT_MODEL_TIMEOUT_MS=20000`

The script must print JSON to stdout with the model fields.
