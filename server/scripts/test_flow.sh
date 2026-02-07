#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:4000}
EMAIL=${EMAIL:-clinician@stridesafe.com}
PASSWORD=${PASSWORD:-password123}
FACILITY_ID=${FACILITY_ID:-a2d8c2e7-9bfe-4a9e-b4d2-9e0d7d6b2a1c}
VIDEO_PATH=${1:-${VIDEO_PATH:-}}

if [[ -z "$VIDEO_PATH" ]]; then
  echo "Usage: $0 /path/to/video.mp4 (or set VIDEO_PATH)" >&2
  exit 1
fi

if [[ ! -f "$VIDEO_PATH" ]]; then
  echo "Video not found: $VIDEO_PATH" >&2
  exit 1
fi

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

TOKEN=$(printf '%s' "$LOGIN_RESPONSE" | python3 -c "import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('token', ''))
except Exception:
    print('')")

if [[ -z "$TOKEN" ]]; then
  echo "Login failed. Response:" >&2
  echo "$LOGIN_RESPONSE" >&2
  exit 1
fi

echo "TOKEN=$TOKEN"

RESIDENT_ID=$(curl -s "$BASE_URL/residents" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id']) if data else print('')")

if [[ -z "$RESIDENT_ID" ]]; then
  RESIDENT_ID=$(curl -s -X POST "$BASE_URL/residents" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"facility_id\":\"$FACILITY_ID\",\"first_name\":\"Evelyn\",\"last_name\":\"Rogers\",\"dob\":\"1942-06-12\",\"sex\":\"F\"}" \
    | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")
fi

echo "RESIDENT_ID=$RESIDENT_ID"

ASSESSMENT_ID=$(curl -s -X POST "$BASE_URL/residents/$RESIDENT_ID/assessments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assessment_date":"2026-02-04","assistive_device":"walker"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")

echo "ASSESSMENT_ID=$ASSESSMENT_ID"

UPLOAD_ARGS=(-F "file=@${VIDEO_PATH};type=video/mp4")
if [[ -n "${DURATION_SECONDS:-}" ]]; then
  UPLOAD_ARGS+=( -F "duration_seconds=${DURATION_SECONDS}" )
fi
if [[ -n "${WIDTH:-}" ]]; then
  UPLOAD_ARGS+=( -F "width=${WIDTH}" )
fi
if [[ -n "${HEIGHT:-}" ]]; then
  UPLOAD_ARGS+=( -F "height=${HEIGHT}" )
fi

UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/assessments/$ASSESSMENT_ID/videos/upload" \
  -H "Authorization: Bearer $TOKEN" \
  "${UPLOAD_ARGS[@]}")

VIDEO_ID=$(printf '%s' "$UPLOAD_RESPONSE" | python3 -c "import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('id', ''))
except Exception:
    print('')")

if [[ -z "$VIDEO_ID" ]]; then
  echo "Video upload failed. Response:" >&2
  echo "$UPLOAD_RESPONSE" >&2
  exit 1
fi

echo "VIDEO_ID=$VIDEO_ID"

curl -s -L -o /tmp/stride_video.mp4 \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/videos/$VIDEO_ID/download"

echo "Downloaded video -> /tmp/stride_video.mp4"

curl -s -X PATCH "$BASE_URL/assessments/$ASSESSMENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status":"completed",
    "risk_tier":"moderate",
    "scores":{
      "tug_seconds":14.2,
      "chair_stand_seconds":15.6,
      "balance_side_by_side":true,
      "balance_semi_tandem":true,
      "balance_tandem":false,
      "score_notes":"Tandem stance failed at 6 seconds"
    }
  }' >/dev/null

echo "Assessment updated"

REPORT_ID=$(curl -s -X POST "$BASE_URL/assessments/$ASSESSMENT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")

echo "REPORT_ID=$REPORT_ID"

curl -s -L -o /tmp/stride_report.pdf \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/$REPORT_ID/download"

echo "Downloaded report -> /tmp/stride_report.pdf"

echo "All done."
