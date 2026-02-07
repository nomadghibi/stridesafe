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
const port = Number(process.env.TEST_PORT_RESIDENT_LOCATION || "4106");
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
    throw new Error("DATABASE_URL is required for resident location tests.");
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

test("admin can create and update resident location", async () => {
  const facilityId = await createFacility(`Location Facility ${Date.now()}`, adminToken);
  const created = await request("POST", "/residents", adminToken, {
    facility_id: facilityId,
    first_name: "Location",
    last_name: "Tester",
    dob: "1945-01-01",
    sex: "F",
    building: "A",
    floor: "2",
    unit: "210",
    room: "B",
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.building, "A");
  assert.equal(created.json.floor, "2");

  const fetched = await request("GET", `/residents/${created.json.id}`, adminToken);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.unit, "210");
  assert.equal(fetched.json.room, "B");

  const updated = await request("PATCH", `/residents/${created.json.id}`, adminToken, {
    room: "C",
    floor: "3",
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.json.room, "C");
  assert.equal(updated.json.floor, "3");
});

test("clinician cannot access resident from another facility", async () => {
  const facilityId = await createFacility(`Isolation Facility ${Date.now()}`, adminToken);
  const created = await request("POST", "/residents", adminToken, {
    facility_id: facilityId,
    first_name: "Isolated",
    last_name: "Resident",
    dob: "1946-02-02",
    sex: "M",
    building: "B",
  });
  assert.equal(created.status, 201, created.text);

  const readForbidden = await request("GET", `/residents/${created.json.id}`, clinicianToken);
  assert.equal(readForbidden.status, 403);

  const updateForbidden = await request("PATCH", `/residents/${created.json.id}`, clinicianToken, {
    room: "Z",
  });
  assert.equal(updateForbidden.status, 403);
});
