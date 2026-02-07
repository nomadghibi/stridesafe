# Report Contract

## Required Sections
- Resident Summary (name, DOB, sex)
- Assessment Details (assessment date, assistive device)
- Protocol Scores (TUG, Chair Stand, Balance results where applicable)
- Risk Tier
- Clinician Notes
- Report Metadata

## Required Fields
- `assessment_id`
- `template_version`
- `generated_at`
- `generated_by`
- `finalized`
- `pdf_storage_key`

## Versioning
- `template_version` is stored on each report record.
- `generated_at`/`generated_by` are immutable once created.
- Regenerating a report creates a new report record and does not alter prior metadata.

## Finalization Rules
- Reports are finalized on generation.
- A finalized report blocks regeneration for non-admin users.
