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
const port = Number(process.env.TEST_PORT_EXPORTS || "4102");
const baseUrl = `http://localhost:${port}`;

let serverProcess;
let pool;
let adminToken;
let clinicianToken;
let clinicianFacilityId;
let facilityBId;
let tokenFacilityBId;
let tokenOwnId;

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
    throw new Error("DATABASE_URL is required for export token tests.");
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
  clinicianFacilityId = clinician.user.facility_id;

  const facilityRes = await request("POST", "/facilities", adminToken, {
    name: `Export Facility ${Date.now()}`,
    city: "Testville",
    state: "CA",
    zip: "94000",
  });
  assert.equal(facilityRes.status, 201, `Facility create failed: ${facilityRes.text}`);
  facilityBId = facilityRes.json.id;

  const tokenRes = await request("POST", "/exports/tokens", adminToken, {
    export_type: "residents",
    facility_id: facilityBId,
  });
  assert.equal(tokenRes.status, 201, `Token create failed: ${tokenRes.text}`);
  tokenFacilityBId = tokenRes.json.id;

  const ownTokenRes = await request("POST", "/exports/tokens", clinicianToken, {
    export_type: "residents",
  });
  assert.equal(ownTokenRes.status, 201, `Clinician token create failed: ${ownTokenRes.text}`);
  tokenOwnId = ownTokenRes.json.id;
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

test("clinician cannot list tokens for another facility", async () => {
  const res = await request("GET", `/exports/tokens?facility_id=${facilityBId}`, clinicianToken);
  assert.equal(res.status, 403);
});

test("token verify returns active status", async () => {
  const res = await request("GET", `/exports/tokens/verify?token=${tokenOwnId}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "active");
  assert.equal(res.json.valid, true);
});

test("clinician cannot revoke another facility token", async () => {
  const res = await request("POST", `/exports/tokens/${tokenFacilityBId}/revoke`, clinicianToken);
  assert.equal(res.status, 403);
});

test("revoked token cannot be downloaded", async () => {
  const revoke = await request("POST", `/exports/tokens/${tokenOwnId}/revoke`, clinicianToken);
  assert.equal(revoke.status, 200);
  assert.ok(revoke.json.revoked_at);

  const verify = await request("GET", `/exports/tokens/verify?token=${tokenOwnId}`);
  assert.equal(verify.status, 200);
  assert.equal(verify.json.status, "revoked");

  const download = await request("GET", `/exports/download?token=${tokenOwnId}`);
  assert.equal(download.status, 410);
});

test("expired token returns 410", async () => {
  const tokenRes = await request("POST", "/exports/tokens", adminToken, {
    export_type: "residents",
    facility_id: clinicianFacilityId,
    expires_in_hours: 1,
  });
  assert.equal(tokenRes.status, 201);
  const tokenId = tokenRes.json.id;

  await pool.query(
    `UPDATE export_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`,
    [tokenId]
  );

  const download = await request("GET", `/exports/download?token=${tokenId}`);
  assert.equal(download.status, 410);
});

test("download logs an audit entry", async () => {
  const tokenRes = await request("POST", "/exports/tokens", adminToken, {
    export_type: "residents",
    facility_id: clinicianFacilityId,
  });
  assert.equal(tokenRes.status, 201);
  const tokenId = tokenRes.json.id;

  const download = await request("GET", `/exports/download?token=${tokenId}`);
  assert.equal(download.status, 200);

  const { rows } = await pool.query(
    `SELECT id FROM audit_logs WHERE action = 'export.downloaded' AND entity_id = $1`,
    [tokenId]
  );
  assert.ok(rows.length >= 1);
});
