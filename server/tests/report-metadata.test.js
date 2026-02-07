import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverCwd = path.resolve(__dirname, "..");
const port = Number(process.env.TEST_PORT_REPORTS || "4104");
const baseUrl = `http://localhost:${port}`;

let serverProcess;
let pool;
let adminToken;
let clinicianToken;
let residentId;
let assessmentId;
let firstReportId;
let firstReportMeta;

const request = async (method, urlPath, token, body) => {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${urlPath}`, options);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json, text };
};

const waitForHealth = async () => {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // ignore until server is ready
    }
    await delay(200);
  }
  throw new Error("Server did not become ready on /health");
};

const login = async (email, password) => {
  const res = await request("POST", "/auth/login", null, { email, password });
  assert.equal(res.status, 200, `Login failed for ${email}: ${res.text}`);
  return res.json;
};

before(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for report tests.");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  serverProcess = spawn("node", ["src/index.js"], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TASK_POLL_INTERVAL_SECONDS: "0",
      ORPHAN_CLEANUP_INTERVAL_MINUTES: "0",
    },
    stdio: "inherit",
  });

  await waitForHealth();

  const admin = await login("admin@stridesafe.com", "password123");
  adminToken = admin.token;
  const clinician = await login("clinician@stridesafe.com", "password123");
  clinicianToken = clinician.token;

  const residentRes = await request("POST", "/residents", clinicianToken, {
    first_name: "Report",
    last_name: "Tester",
    dob: "1940-01-01",
    sex: "F",
  });
  assert.equal(residentRes.status, 201, `Resident create failed: ${residentRes.text}`);
  residentId = residentRes.json.id;

  const assessmentRes = await request(
    "POST",
    `/residents/${residentId}/assessments`,
    clinicianToken,
    { assessment_date: "2026-02-05" }
  );
  assert.equal(assessmentRes.status, 201, `Assessment create failed: ${assessmentRes.text}`);
  assessmentId = assessmentRes.json.id;

  const { rows: userRows } = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    ["clinician@stridesafe.com"]
  );
  const clinicianId = userRows[0]?.id || null;

  await pool.query(
    `INSERT INTO videos (
      assessment_id, storage_key, content_type, duration_seconds, width, height, checksum, uploaded_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      assessmentId,
      `videos/${assessmentId}/report-test.mp4`,
      "video/mp4",
      30,
      640,
      360,
      "md5:report-test",
      clinicianId,
    ]
  );

  await pool.query(
    `INSERT INTO assessment_scores (
      assessment_id, tug_seconds, chair_stand_seconds, balance_side_by_side,
      balance_semi_tandem, balance_tandem, score_notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (assessment_id) DO NOTHING`,
    [
      assessmentId,
      12.4,
      18.6,
      true,
      true,
      false,
      "seed scores",
    ]
  );
});

after(async () => {
  if (pool) {
    await pool.end();
  }
  if (!serverProcess) {
    return;
  }
  serverProcess.kill("SIGTERM");
  await Promise.race([once(serverProcess, "exit"), delay(2000)]);
  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
});

test("report metadata is stored and finalized blocks clinician regeneration", async () => {
  const reportRes = await request("POST", `/assessments/${assessmentId}/reports`, clinicianToken, {});
  assert.equal(reportRes.status, 201);
  assert.equal(reportRes.json.finalized, true);
  assert.equal(reportRes.json.template_version, "v1");
  assert.ok(reportRes.json.generated_at);
  assert.equal(reportRes.json.generated_by, reportRes.json.created_by);

  firstReportId = reportRes.json.id;
  const { rows } = await pool.query(
    `SELECT template_version, generated_at, generated_by, finalized FROM reports WHERE id = $1`,
    [firstReportId]
  );
  firstReportMeta = rows[0];
  assert.equal(firstReportMeta.finalized, true);

  const blocked = await request("POST", `/assessments/${assessmentId}/reports`, clinicianToken, {});
  assert.equal(blocked.status, 403);
});

test("admin can regenerate without mutating prior metadata", async () => {
  const reportRes = await request("POST", `/assessments/${assessmentId}/reports`, adminToken, {});
  assert.equal(reportRes.status, 201);
  assert.notEqual(reportRes.json.id, firstReportId);

  const { rows } = await pool.query(
    `SELECT template_version, generated_at, generated_by, finalized FROM reports WHERE id = $1`,
    [firstReportId]
  );
  const fresh = rows[0];
  assert.equal(fresh.template_version, firstReportMeta.template_version);
  assert.equal(String(fresh.generated_at), String(firstReportMeta.generated_at));
  assert.equal(fresh.generated_by, firstReportMeta.generated_by);
  assert.equal(fresh.finalized, true);
});
