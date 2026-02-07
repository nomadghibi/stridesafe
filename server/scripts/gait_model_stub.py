#!/usr/bin/env python3
import argparse
import json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--duration")
    parser.add_argument("--width")
    parser.add_argument("--height")
    parser.add_argument("--assessment-id")
    args = parser.parse_args()

    duration = float(args.duration) if args.duration else None
    width = int(float(args.width)) if args.width else None
    height = int(float(args.height)) if args.height else None

    tug_seconds = 12.4
    chair_seconds = 18.6
    if duration and duration > 0:
        tug_seconds = max(8.0, min(duration * 0.45, 25.0))
        chair_seconds = max(10.0, min(duration * 0.6, 35.0))

    payload = {
        "model_version": "pose_stub_v0",
        "tug_seconds": round(tug_seconds, 1),
        "chair_stand_seconds": round(chair_seconds, 1),
        "balance_side_by_side": True,
        "balance_semi_tandem": True,
        "balance_tandem": False,
        "confidence": 0.42,
        "notes": "stub: generated demo scores",
        "video_path": args.video,
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "assessment_id": args.assessment_id,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
