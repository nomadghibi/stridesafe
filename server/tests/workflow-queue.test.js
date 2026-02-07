import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverCwd = path.resolve(__dirname, "..");
const port = Number(process.env.TEST_PORT_WORKFLOW || "4103");
const baseUrl = `http://localhost:${port}`;

let serverProcess;
let adminToken;
let clinicianToken;
let residentId;
let assessmentId;
let overdueAssessmentId;
let dueSoonAssessmentId;
let fallEventId;
let facilityId;

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

const formatDate = (date) => date.toISOString().slice(0, 10);

before(async () => {
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
  facilityId = clinician.user.facility_id;

  const facilityRes = await request("PATCH", `/facilities/${facilityId}`, adminToken, {
    fall_checklist: ["Vitals recorded"],
  });
  assert.equal(facilityRes.status, 200, `Facility update failed: ${facilityRes.text}`);

  const residentRes = await request("POST", "/residents", clinicianToken, {
    first_name: "Workflow",
    last_name: "Tester",
    dob: "1945-01-01",
    sex: "F",
  });
  assert.equal(residentRes.status, 201, `Resident create failed: ${residentRes.text}`);
  residentId = residentRes.json.id;

  const assessmentRes = await request(
    "POST",
    `/residents/${residentId}/assessments`,
    clinicianToken,
    { assessment_date: formatDate(new Date()) }
  );
  assert.equal(assessmentRes.status, 201, `Assessment create failed: ${assessmentRes.text}`);
  assessmentId = assessmentRes.json.id;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const overdueRes = await request(
    "POST",
    `/residents/${residentId}/assessments`,
    clinicianToken,
    {
      assessment_date: formatDate(new Date()),
      scheduled_date: formatDate(yesterday),
      due_date: formatDate(yesterday),
    }
  );
  assert.equal(overdueRes.status, 201, `Overdue assessment create failed: ${overdueRes.text}`);
  overdueAssessmentId = overdueRes.json.id;

  const dueSoon = new Date();
  dueSoon.setDate(dueSoon.getDate() + 2);
  const dueSoonRes = await request(
    "POST",
    `/residents/${residentId}/assessments`,
    clinicianToken,
    {
      assessment_date: formatDate(new Date()),
      scheduled_date: formatDate(dueSoon),
      due_date: formatDate(dueSoon),
    }
  );
  assert.equal(dueSoonRes.status, 201, `Due-soon assessment create failed: ${dueSoonRes.text}`);
  dueSoonAssessmentId = dueSoonRes.json.id;

  const fallOccurred = new Date();
  fallOccurred.setDate(fallOccurred.getDate() - 5);
  const fallRes = await request(
    "POST",
    `/residents/${residentId}/fall-events`,
    clinicianToken,
    { occurred_at: fallOccurred.toISOString() }
  );
  assert.equal(fallRes.status, 201, `Fall event create failed: ${fallRes.text}`);
  fallEventId = fallRes.json.id;
});

after(async () => {
  if (!serverProcess) {
    return;
  }
  serverProcess.kill("SIGTERM");
  await Promise.race([once(serverProcess, "exit"), delay(2000)]);
  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
});

test("workflow status transitions enforce role rules", async () => {
  const back = await request("PATCH", `/assessments/${assessmentId}`, clinicianToken, {
    status: "draft",
  });
  assert.equal(back.status, 403);

  const toReview = await request("PATCH", `/assessments/${assessmentId}`, clinicianToken, {
    status: "in_review",
  });
  assert.equal(toReview.status, 200);

  const toCompleted = await request("PATCH", `/assessments/${assessmentId}`, clinicianToken, {
    status: "completed",
  });
  assert.equal(toCompleted.status, 200);

  const adminOverride = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    status: "draft",
  });
  assert.equal(adminOverride.status, 200);
});

test("workflow queue overdue filter works", async () => {
  const res = await request("GET", "/workflow/queue?overdue=true", clinicianToken);
  assert.equal(res.status, 200);
  const ids = (res.json || []).map((item) => item.id);
  assert.ok(ids.includes(overdueAssessmentId));
  assert.ok(!ids.includes(dueSoonAssessmentId));
  const overdueItem = (res.json || []).find((item) => item.id === overdueAssessmentId);
  assert.equal(overdueItem?.sla_status, "overdue");
});

test("workflow queue due_within + overdue=false filters upcoming", async () => {
  const res = await request("GET", "/workflow/queue?overdue=false&due_within=3", clinicianToken);
  assert.equal(res.status, 200);
  const ids = (res.json || []).map((item) => item.id);
  assert.ok(ids.includes(dueSoonAssessmentId));
  assert.ok(!ids.includes(overdueAssessmentId));
});

test("workflow queue includes overdue fall incidents", async () => {
  const res = await request("GET", "/workflow/queue?overdue=true", clinicianToken);
  assert.equal(res.status, 200);
  const incidents = (res.json || []).filter((item) => item.item_type === "fall_event");
  assert.ok(incidents.some((item) => item.id === fallEventId));
});
