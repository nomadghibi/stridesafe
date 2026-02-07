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
const port = Number(process.env.TEST_PORT_FALL_EVENTS || "4107");
const baseUrl = `http://localhost:${port}`;

let serverProcess;
let adminToken;
let clinicianToken;
let clinicianFacilityId;

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

const createFacility = async (name, token) => {
  const res = await request("POST", "/facilities", token, {
    name,
    city: "Testville",
    state: "CA",
    zip: "94000",
  });
  assert.equal(res.status, 201, `Facility create failed: ${res.text}`);
  return res.json.id;
};

before(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for fall event tests.");
  }
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
  clinicianFacilityId = clinician.user.facility_id;

  const facilityRes = await request("PATCH", `/facilities/${clinicianFacilityId}`, adminToken, {
    fall_checklist: ["Vitals recorded", "Neuro check"],
  });
  assert.equal(facilityRes.status, 200, `Facility update failed: ${facilityRes.text}`);
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

test("clinician can create fall event and toggle checklist", async () => {
  const residentRes = await request("POST", "/residents", clinicianToken, {
    first_name: "Fall",
    last_name: "Tester",
    dob: "1944-03-03",
    sex: "F",
    building: "A",
    floor: "2",
  });
  assert.equal(residentRes.status, 201, residentRes.text);

  const eventRes = await request(
    "POST",
    `/residents/${residentRes.json.id}/fall-events`,
    clinicianToken,
    {
      occurred_at: new Date().toISOString(),
      injury_severity: "minor",
      ems_called: true,
      hospital_transfer: false,
      contributing_factors: ["lighting"],
      notes: "Slipped near bed",
    }
  );
  assert.equal(eventRes.status, 201, eventRes.text);

  const listRes = await request("GET", `/residents/${residentRes.json.id}/fall-events`, clinicianToken);
  assert.equal(listRes.status, 200, listRes.text);
  assert.ok(listRes.json.some((event) => event.id === eventRes.json.id));

  const checkType = "Vitals recorded";
  const checkRes = await request("POST", `/fall-events/${eventRes.json.id}/checks`, clinicianToken, {
    check_type: checkType,
    completed: true,
  });
  assert.equal(checkRes.status, 200, checkRes.text);
  assert.equal(checkRes.json.status, "completed");

  const checksRes = await request("GET", `/fall-events/${eventRes.json.id}/checks`, clinicianToken);
  assert.equal(checksRes.status, 200, checksRes.text);
  assert.ok(checksRes.json.find((item) => item.check_type === checkType));
});

test("clinician cannot access fall events from another facility", async () => {
  const facilityId = await createFacility(`Incident Facility ${Date.now()}`, adminToken);
  const residentRes = await request("POST", "/residents", adminToken, {
    facility_id: facilityId,
    first_name: "Isolated",
    last_name: "Resident",
    dob: "1943-02-02",
    sex: "M",
  });
  assert.equal(residentRes.status, 201, residentRes.text);

  const eventRes = await request(
    "POST",
    `/residents/${residentRes.json.id}/fall-events`,
    adminToken,
    { occurred_at: new Date().toISOString() }
  );
  assert.equal(eventRes.status, 201, eventRes.text);

  const listRes = await request("GET", `/residents/${residentRes.json.id}/fall-events`, clinicianToken);
  assert.equal(listRes.status, 403, listRes.text);

  const checksRes = await request("GET", `/fall-events/${eventRes.json.id}/checks`, clinicianToken);
  assert.equal(checksRes.status, 403, checksRes.text);
});

test("analytics summary includes post-fall compliance metrics", async () => {
  const unitRes = await request("POST", "/units", adminToken, {
    facility_id: clinicianFacilityId,
    label: `Unit ${Date.now()}`,
  });
  assert.equal(unitRes.status, 201, unitRes.text);

  const residentRes = await request("POST", "/residents", clinicianToken, {
    first_name: "Scorecard",
    last_name: "Resident",
    dob: "1942-01-01",
    sex: "F",
    unit_id: unitRes.json.id,
  });
  assert.equal(residentRes.status, 201, residentRes.text);

  const eventRes = await request(
    "POST",
    `/residents/${residentRes.json.id}/fall-events`,
    clinicianToken,
    {
      occurred_at: new Date().toISOString(),
      injury_severity: "minor",
    }
  );
  assert.equal(eventRes.status, 201, eventRes.text);

  await request("POST", `/fall-events/${eventRes.json.id}/checks`, clinicianToken, {
    check_type: "Vitals recorded",
    completed: true,
  });

  const summaryRes = await request("GET", "/analytics/summary?days=7", clinicianToken);
  assert.equal(summaryRes.status, 200, summaryRes.text);
  assert.equal(typeof summaryRes.json.post_fall_required, "number");
  assert.equal(typeof summaryRes.json.post_fall_completion_rate, "number");
  assert.ok(summaryRes.json.post_fall_open >= 1);

  const rollupRes = await request("GET", "/analytics/post-fall-rollup?days=7", clinicianToken);
  assert.equal(rollupRes.status, 200, rollupRes.text);
  assert.ok(Array.isArray(rollupRes.json));
  assert.ok(rollupRes.json.length >= 1);
  const first = rollupRes.json[0];
  assert.equal(typeof first.total, "number");
  assert.equal(typeof first.completion_rate, "number");

  const filteredRes = await request(
    "GET",
    `/analytics/post-fall-rollup?days=7&unit_id=${unitRes.json.id}`,
    clinicianToken
  );
  assert.equal(filteredRes.status, 200, filteredRes.text);
  assert.ok(Array.isArray(filteredRes.json));
  assert.ok(filteredRes.json.every((row) => row.unit_id === unitRes.json.id));

  const tokenRes = await request("POST", "/exports/tokens", clinicianToken, {
    export_type: "post_fall_rollup",
    params: { days: 7, unit_id: unitRes.json.id },
  });
  assert.equal(tokenRes.status, 201, tokenRes.text);

  const downloadRes = await fetch(`${baseUrl}/exports/download?token=${tokenRes.json.id}`);
  assert.equal(downloadRes.status, 200);
  const csvText = await downloadRes.text();
  assert.ok(csvText.includes("unit_id"));
});
