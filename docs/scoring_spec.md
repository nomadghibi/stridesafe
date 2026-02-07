# Scoring Spec

## Protocols
- `tug_chair_balance` (default)
- `tug_only`
- `balance_only`

## Required Fields by Protocol
### tug_chair_balance
- `tug_seconds`
- `chair_stand_seconds`
- `balance_side_by_side`
- `balance_semi_tandem`
- `balance_tandem`

### tug_only
- `tug_seconds`

### balance_only
- `balance_side_by_side`
- `balance_semi_tandem`
- `balance_tandem`

## Units & Ranges
- `tug_seconds` and `chair_stand_seconds` are in seconds.
- Valid range: `0–300` seconds.
- Balance fields are boolean pass/fail.
