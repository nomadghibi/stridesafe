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
const port = Number(process.env.TEST_PORT_UNITS || "4108");
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
    throw new Error("DATABASE_URL is required for unit tests.");
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

test("admin can create unit and assign resident", async () => {
  const facilityId = await createFacility(`Unit Facility ${Date.now()}`, adminToken);
  const unitRes = await request("POST", "/units", adminToken, {
    facility_id: facilityId,
    label: "Building A • Floor 2 • Unit 210",
    building: "A",
    floor: "2",
    unit: "210",
  });
  assert.equal(unitRes.status, 201, unitRes.text);

  const residentRes = await request("POST", "/residents", adminToken, {
    facility_id: facilityId,
    first_name: "Unit",
    last_name: "Assigned",
    dob: "1945-01-01",
    sex: "F",
    unit_id: unitRes.json.id,
  });
  assert.equal(residentRes.status, 201, residentRes.text);
  assert.equal(residentRes.json.unit_id, unitRes.json.id);

  const listRes = await request("GET", `/units?facility_id=${facilityId}`, adminToken);
  assert.equal(listRes.status, 200, listRes.text);
  assert.ok(listRes.json.some((unit) => unit.id === unitRes.json.id));
});

test("clinician cannot assign unit from another facility", async () => {
  const facilityId = await createFacility(`Other Facility ${Date.now()}`, adminToken);
  const unitRes = await request("POST", "/units", adminToken, {
    facility_id: facilityId,
    label: "Building B • Floor 1",
    building: "B",
    floor: "1",
  });
  assert.equal(unitRes.status, 201, unitRes.text);

  const residentRes = await request("POST", "/residents", clinicianToken, {
    first_name: "Cross",
    last_name: "Facility",
    dob: "1947-01-01",
    sex: "M",
    unit_id: unitRes.json.id,
  });
  assert.equal(residentRes.status, 400, residentRes.text);
});
