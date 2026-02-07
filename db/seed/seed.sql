-- Seed data for StrideSafe MVP

INSERT INTO facilities (id, name, address_line1, address_line2, city, state, zip)
VALUES (
  'a2d8c2e7-9bfe-4a9e-b4d2-9e0d7d6b2a1c',
  'Sunrise Senior Living',
  '410 Mission Street',
  'Suite 600',
  'San Francisco',
  'CA',
  '94105'
);

INSERT INTO users (id, facility_id, email, full_name, role, status, password_salt, password_hash)
VALUES
  (
    '0f2f6a0e-4c4b-4f2a-9b2b-2a3b4c5d6e7f',
    'a2d8c2e7-9bfe-4a9e-b4d2-9e0d7d6b2a1c',
    'clinician@stridesafe.com',
    'Jordan Fields',
    'clinician',
    'active',
    '985944d101f37340d56a8f3fa64365eb',
    '0e0342f7b6ee451e24535cf2052c9ce00359f480465197522d3b2e02aa79a05d'
  ),
  (
    'c8f1d21c-0b3f-4f98-8a5b-7f9a1a2b3c4d',
    'a2d8c2e7-9bfe-4a9e-b4d2-9e0d7d6b2a1c',
    'admin@stridesafe.com',
    'Morgan Lee',
    'admin',
    'active',
    '97f7abcb9aeb13a7a971c8c97becd444',
    '86893c5e69704bb9ad3ec2eb429db270896c254da926fe7860f710585431ca35'
  );

INSERT INTO residents (id, facility_id, external_id, first_name, last_name, dob, sex, notes)
VALUES (
  '11e5a1a0-2ed1-4d49-8f5e-9e05c0a2a5f1',
  'a2d8c2e7-9bfe-4a9e-b4d2-9e0d7d6b2a1c',
  'MRN-1001',
  'Evelyn',
  'Rogers',
  '1942-06-12',
  'F',
  'Uses walker'
);

INSERT INTO assessments (id, resident_id, created_by, status, assessment_date, assistive_device, risk_tier, clinician_notes)
VALUES (
  'b0fbc0b0-6a15-47d5-8b59-4db8d9c86c41',
  '11e5a1a0-2ed1-4d49-8f5e-9e05c0a2a5f1',
  '0f2f6a0e-4c4b-4f2a-9b2b-2a3b4c5d6e7f',
  'completed',
  '2026-02-04',
  'walker',
  'moderate',
  'Balance unsteady during tandem'
);

INSERT INTO assessment_scores (
  assessment_id,
  tug_seconds,
  chair_stand_seconds,
  balance_side_by_side,
  balance_semi_tandem,
  balance_tandem,
  score_notes
)
VALUES (
  'b0fbc0b0-6a15-47d5-8b59-4db8d9c86c41',
  14.2,
  15.6,
  true,
  true,
  false,
  'Tandem stance failed at 6 seconds'
);

INSERT INTO videos (
  id,
  assessment_id,
  storage_key,
  content_type,
  duration_seconds,
  width,
  height,
  checksum,
  uploaded_by
)
VALUES (
  'a10ff9a4-7a19-4b3e-8e4d-5b4312e1b79c',
  'b0fbc0b0-6a15-47d5-8b59-4db8d9c86c41',
  'videos/2026/02/04/a10ff9a4.mp4',
  'video/mp4',
  28.5,
  1080,
  1920,
  'md5:abcd1234',
  '0f2f6a0e-4c4b-4f2a-9b2b-2a3b4c5d6e7f'
);

INSERT INTO reports (id, assessment_id, pdf_storage_key, created_by)
VALUES (
  'cf2f8a7c-5a49-4f7d-8b1e-1f8d9c3d2b4a',
  'b0fbc0b0-6a15-47d5-8b59-4db8d9c86c41',
  'reports/2026/02/04/report.pdf',
  '0f2f6a0e-4c4b-4f2a-9b2b-2a3b4c5d6e7f'
);
