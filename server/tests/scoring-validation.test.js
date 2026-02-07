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
const port = Number(process.env.TEST_PORT_SCORING || "4105");
const baseUrl = `http://localhost:${port}`;

let serverProcess;
let adminToken;
let clinicianToken;

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

const createFacility = async (protocol) => {
  const res = await request("POST", "/facilities", adminToken, {
    name: `Scoring ${protocol} ${Date.now()}`,
    assessment_protocol: protocol,
    city: "Testville",
    state: "CA",
    zip: "94000",
  });
  assert.equal(res.status, 201, `Facility create failed: ${res.text}`);
  return res.json.id;
};

const createAssessment = async (facilityId) => {
  const residentRes = await request("POST", "/residents", adminToken, {
    facility_id: facilityId,
    first_name: "Score",
    last_name: "Tester",
    dob: "1940-01-01",
    sex: "F",
  });
  assert.equal(residentRes.status, 201, `Resident create failed: ${residentRes.text}`);
  const residentId = residentRes.json.id;
  const assessmentRes = await request("POST", `/residents/${residentId}/assessments`, adminToken, {
    assessment_date: "2026-02-05",
  });
  assert.equal(assessmentRes.status, 201, `Assessment create failed: ${assessmentRes.text}`);
  return assessmentRes.json.id;
};

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

test("admin can update facility defaults", async () => {
  const facilityId = await createFacility("tug_only");
  const updated = await request("PATCH", `/facilities/${facilityId}`, adminToken, {
    assessment_protocol: "balance_only",
    capture_method: "upload_only",
    role_policy: "admin_only",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.assessment_protocol, "balance_only");
  assert.equal(updated.json.capture_method, "upload_only");
  assert.equal(updated.json.role_policy, "admin_only");
});

test("clinician cannot update facility defaults", async () => {
  const facilityId = await createFacility("tug_only");
  const updated = await request("PATCH", `/facilities/${facilityId}`, clinicianToken, {
    assessment_protocol: "balance_only",
  });
  assert.equal(updated.status, 403);
});

test("tug_only requires tug_seconds", async () => {
  const facilityId = await createFacility("tug_only");
  const assessmentId = await createAssessment(facilityId);

  const missing = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: { chair_stand_seconds: 12.5 },
  });
  assert.equal(missing.status, 400);

  const ok = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: { tug_seconds: 11.2 },
  });
  assert.equal(ok.status, 200);
});

test("balance_only requires all balance fields", async () => {
  const facilityId = await createFacility("balance_only");
  const assessmentId = await createAssessment(facilityId);

  const missing = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: { balance_side_by_side: true },
  });
  assert.equal(missing.status, 400);

  const ok = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: {
      balance_side_by_side: true,
      balance_semi_tandem: false,
      balance_tandem: false,
    },
  });
  assert.equal(ok.status, 200);
});

test("tug_chair_balance requires tug + chair + balance", async () => {
  const facilityId = await createFacility("tug_chair_balance");
  const assessmentId = await createAssessment(facilityId);

  const missing = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: { tug_seconds: 12.1 },
  });
  assert.equal(missing.status, 400);

  const ok = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: {
      tug_seconds: 12.1,
      chair_stand_seconds: 15.7,
      balance_side_by_side: true,
      balance_semi_tandem: true,
      balance_tandem: false,
    },
  });
  assert.equal(ok.status, 200);
});

test("score range validation rejects out of range values", async () => {
  const facilityId = await createFacility("tug_only");
  const assessmentId = await createAssessment(facilityId);

  const bad = await request("PATCH", `/assessments/${assessmentId}`, adminToken, {
    scores: { tug_seconds: 999 },
  });
  assert.equal(bad.status, 400);
});
