import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import archiver from "archiver";
import YAML from "yamljs";
import swaggerUi from "swagger-ui-express";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import { Pool } from "pg";
import multer from "multer";
import { execFile } from "child_process";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const host = process.env.HOST || "0.0.0.0";
const jwtSecret = process.env.JWT_SECRET || "change-me";
const pbkdf2Iterations = Number.parseInt(process.env.PBKDF2_ITERATIONS || "310000", 10);
const orphanCleanupHours = Number.parseFloat(process.env.ORPHAN_CLEANUP_HOURS || "24");
const orphanCleanupIntervalMinutes = Number.parseFloat(process.env.ORPHAN_CLEANUP_INTERVAL_MINUTES || "60");
const gaitModelVersion = process.env.GAIT_MODEL_VERSION || "pose_stub_v0";
const gaitModelScript = process.env.GAIT_MODEL_SCRIPT || "";
const gaitModelTimeoutMs = Number.parseInt(process.env.GAIT_MODEL_TIMEOUT_MS || "20000", 10);
const parsedPostFallDays = Number.parseInt(process.env.POST_FALL_FOLLOWUP_DAYS || "3", 10);
const postFallFollowupDays = Number.isFinite(parsedPostFallDays) && parsedPostFallDays >= 0
  ? parsedPostFallDays
  : 3;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storageRoot = path.resolve(__dirname, "../storage");
const emailOutboxRoot = process.env.EMAIL_OUTBOX_DIR || "";
const emailOutboxDir = emailOutboxRoot
  ? path.resolve(emailOutboxRoot)
  : path.resolve(storageRoot, "outbox");
const emailFrom = process.env.EMAIL_FROM || "no-reply@stridesafe.com";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number.parseInt(process.env.SMTP_PORT || "587", 10);
const smtpSecure = parseOptionalBoolean(process.env.SMTP_SECURE).value === true;
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const maxVideoSizeMb = Number.parseInt(process.env.MAX_VIDEO_SIZE_MB || "100", 10);
const maxVideoSizeBytes = Number.isFinite(maxVideoSizeMb)
  ? maxVideoSizeMb * 1024 * 1024
  : 100 * 1024 * 1024;
const rateLimitEnabled = parseOptionalBoolean(process.env.RATE_LIMIT_ENABLED).value !== false;
const rateLimitWindowMinutes = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || "10", 10);
const rateLimitMax = Number.parseInt(process.env.RATE_LIMIT_MAX || "600", 10);
const rateLimitAuthWindowMinutes = Number.parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MINUTES || "15", 10);
const rateLimitAuthMax = Number.parseInt(process.env.RATE_LIMIT_AUTH_MAX || "50", 10);
const rateLimitUploadWindowMinutes = Number.parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MINUTES || "60", 10);
const rateLimitUploadMax = Number.parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || "60", 10);
const trustProxy = parseOptionalBoolean(process.env.TRUST_PROXY).value === true;
const allowedAssessmentStatuses = new Set(["draft", "needs_review", "in_review", "completed"]);
const allowedRiskTiers = new Set(["low", "moderate", "high"]);
const riskScoreMap = {
  low: 1,
  moderate: 2,
  high: 3,
};
const allowedSexValues = new Set(["F", "M", "O"]);
const allowedUserRoles = new Set(["admin", "clinician"]);
const allowedUserStatuses = new Set(["active", "disabled", "inactive"]);
const allowedAssessmentProtocols = new Set(["tug_chair_balance", "tug_only", "balance_only"]);
const allowedCaptureMethods = new Set(["record_upload", "upload_only"]);
const allowedRolePolicies = new Set(["clinician_admin_only", "admin_only"]);
const allowedInjurySeverities = new Set(["none", "minor", "moderate", "severe"]);
const allowedExportTypes = new Set(["residents", "assessments", "audit", "bundle", "post_fall_rollup"]);
const allowedBundleIncludes = new Set(["residents", "assessments", "audit"]);
const allowedNotificationStatuses = new Set(["unread", "read"]);
const allowedScheduleFrequencies = new Set(["daily", "weekly"]);
const allowedScheduleStatuses = new Set(["active", "paused"]);
const exportScopeForType = (exportType) => `export:${exportType}`;
const maxExportTokenHours = 24 * 30;
const reportTemplateVersion = "v1";
const assessmentStatusTransitions = {
  draft: new Set(["needs_review", "completed"]),
  needs_review: new Set(["in_review", "completed"]),
  in_review: new Set(["completed"]),
  completed: new Set([]),
};

const resolveExportScheduleEmailRoles = () => {
  const roles = exportScheduleEmailRolesRaw
    .split(",")
    .map((role) => normalizeString(role).toLowerCase())
    .filter(Boolean);
  const filtered = roles.filter((role) => allowedUserRoles.has(role));
  return filtered.length ? filtered : ["admin"];
};

const getSmtpTransport = (() => {
  let cached = null;
  return () => {
    if (!smtpEnabled) {
      return null;
    }
    if (cached) {
      return cached;
    }
    cached = nodemailer.createTransport({
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: smtpSecure,
      auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    });
    return cached;
  };
})();

const canTransitionAssessmentStatus = (currentStatus, nextStatus, role) => {
  if (currentStatus === nextStatus) {
    return true;
  }
  if (role === "admin") {
    return true;
  }
  const allowed = assessmentStatusTransitions[currentStatus];
  return Boolean(allowed && allowed.has(nextStatus));
};

const isRolePolicyAllowed = (rolePolicy, userRole) => {
  if (!rolePolicy || rolePolicy === "clinician_admin_only") {
    return true;
  }
  return userRole === "admin";
};

const normalizeQaChecks = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const next = {};
  Object.entries(value).forEach(([key, val]) => {
    if (typeof key === "string" && key.trim()) {
      next[key] = Boolean(val);
    }
  });
  return next;
};

const isQaComplete = (steps, checks, escalated) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return true;
  }
  if (escalated) {
    return false;
  }
  const source = checks || {};
  return steps.every((step) => source[step] === true);
};

const extractModelScores = (model) => {
  const tug = Number.isFinite(model?.tug_seconds) ? model.tug_seconds : null;
  const chair = Number.isFinite(model?.chair_stand_seconds) ? model.chair_stand_seconds : null;
  const side = typeof model?.balance_side_by_side === "boolean" ? model.balance_side_by_side : null;
  const semi = typeof model?.balance_semi_tandem === "boolean" ? model.balance_semi_tandem : null;
  const tandem = typeof model?.balance_tandem === "boolean" ? model.balance_tandem : null;
  return { tug, chair, side, semi, tandem };
};

const canApplyModelScores = (protocol, scores) => {
  if (!scores) {
    return false;
  }
  const missing = [];
  const requireNumber = (value, label) => {
    if (value === null || value === undefined) {
      missing.push(label);
    }
  };
  const requireBool = (value, label) => {
    if (value === null || value === undefined) {
      missing.push(label);
    }
  };
  if (protocol === "tug_chair_balance") {
    requireNumber(scores.tug, "tug_seconds");
    requireNumber(scores.chair, "chair_stand_seconds");
    requireBool(scores.side, "balance_side_by_side");
    requireBool(scores.semi, "balance_semi_tandem");
    requireBool(scores.tandem, "balance_tandem");
  } else if (protocol === "tug_only") {
    requireNumber(scores.tug, "tug_seconds");
  } else if (protocol === "balance_only") {
    requireBool(scores.side, "balance_side_by_side");
    requireBool(scores.semi, "balance_semi_tandem");
    requireBool(scores.tandem, "balance_tandem");
  }
  const inRange = (value) => value === null || (value >= 0 && value <= 300);
  if (!inRange(scores.tug) || !inRange(scores.chair)) {
    return false;
  }
  return missing.length === 0;
};

const upsertModelScores = async ({ assessmentId, protocol, model }) => {
  if (!assessmentId) {
    return false;
  }
  const scores = extractModelScores(model);
  const effectiveProtocol = protocol || "tug_chair_balance";
  if (!canApplyModelScores(effectiveProtocol, scores)) {
    return false;
  }
  await pool.query(
    `INSERT INTO assessment_scores (
      assessment_id, tug_seconds, chair_stand_seconds, balance_side_by_side,
      balance_semi_tandem, balance_tandem, score_notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (assessment_id) DO NOTHING`,
    [
      assessmentId,
      scores.tug,
      scores.chair,
      scores.side,
      scores.semi,
      scores.tandem,
      null,
    ]
  );
  return true;
};

const extractStoredScores = (scores) => {
  if (!scores) {
    return null;
  }
  const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    tug: parseNumber(scores.tug_seconds),
    chair: parseNumber(scores.chair_stand_seconds),
    side: typeof scores.balance_side_by_side === "boolean" ? scores.balance_side_by_side : null,
    semi: typeof scores.balance_semi_tandem === "boolean" ? scores.balance_semi_tandem : null,
    tandem: typeof scores.balance_tandem === "boolean" ? scores.balance_tandem : null,
  };
};
const taskPollIntervalSeconds = Number.parseInt(process.env.TASK_POLL_INTERVAL_SECONDS || "60", 10);
const taskRetryMinutes = Number.parseInt(process.env.TASK_RETRY_MINUTES || "5", 10);
const notificationScanHour = Number.parseInt(process.env.NOTIFICATION_SCAN_HOUR || "7", 10);
const notificationScanMinute = Number.parseInt(process.env.NOTIFICATION_SCAN_MINUTE || "0", 10);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || corsOrigins.length === 0) {
      callback(null, true);
      return;
    }
    callback(null, corsOrigins.includes(origin));
  },
  credentials: true,
};

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => uuidRegex.test(value);
const toNullableString = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};
const parseDateOnly = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const parsed = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const formatDateOnly = (date) => date.toISOString().slice(0, 10);
const parseDateTime = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const isFutureDate = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
};
const normalizeUserStatus = (value) => (value === "inactive" ? "disabled" : value);
const serializeUser = (user) => ({
  ...user,
  status: user.status === "disabled" ? "inactive" : user.status,
});
const parseOptionalNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return { value: null, error: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: "invalid" };
  }
  return { value: parsed, error: null };
};
function parseOptionalBoolean(value) {
  if (value === undefined) {
    return { value: undefined, error: null };
  }
  if (value === null) {
    return { value: null, error: null };
  }
  if (value === true || value === false) {
    return { value, error: null };
  }
  if (value === "true") {
    return { value: true, error: null };
  }
  if (value === "false") {
    return { value: false, error: null };
  }
  return { value: null, error: "invalid" };
}
const parseOptionalPositiveInt = (value) => {
  if (value === undefined) {
    return { value: undefined, error: null };
  }
  if (value === null || value === "") {
    return { value: null, error: null };
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null, error: "invalid" };
  }
  return { value: parsed, error: null };
};

const exportScheduleEmailEnabled = parseOptionalBoolean(process.env.EXPORT_SCHEDULE_EMAIL_ENABLED).value === true;
const exportScheduleEmailRolesRaw = process.env.EXPORT_SCHEDULE_EMAIL_ROLES || "admin";
const smtpEnabled = Boolean(exportScheduleEmailEnabled && smtpHost);

async function getFacilityTokenTtlDays(facilityId) {
  if (!facilityId) {
    return 7;
  }
  const { rows } = await pool.query(
    `SELECT export_token_ttl_days FROM facilities WHERE id = $1`,
    [facilityId]
  );
  const value = Number(rows[0]?.export_token_ttl_days);
  if (!Number.isFinite(value) || value <= 0) {
    return 7;
  }
  return value;
}
const parseOptionalEnum = (value, allowedValues) => {
  if (value === undefined) {
    return { value: undefined, error: null };
  }
  if (value === null || value === "") {
    return { value: null, error: null };
  }
  const normalized = normalizeString(value);
  if (!normalized || !allowedValues.has(normalized)) {
    return { value: null, error: "invalid" };
  }
  return { value: normalized, error: null };
};
const normalizeChecklist = (value) => {
  if (value === undefined) {
    return { value: undefined, error: null };
  }
  if (!Array.isArray(value)) {
    return { value: null, error: "invalid" };
  }
  const cleaned = value.map((item) => normalizeString(item)).filter(Boolean);
  return { value: cleaned, error: null };
};
const buildUnitLabel = ({ label, building, floor, unit, room }) => {
  const direct = normalizeString(label);
  if (direct) {
    return direct;
  }
  const parts = [];
  const normalizedBuilding = normalizeString(building);
  const normalizedFloor = normalizeString(floor);
  const normalizedUnit = normalizeString(unit);
  const normalizedRoom = normalizeString(room);
  if (normalizedBuilding) {
    parts.push(`Building ${normalizedBuilding}`);
  }
  if (normalizedFloor) {
    parts.push(`Floor ${normalizedFloor}`);
  }
  if (normalizedUnit) {
    parts.push(`Unit ${normalizedUnit}`);
  }
  if (normalizedRoom) {
    parts.push(`Room ${normalizedRoom}`);
  }
  return parts.join(" • ");
};
const escapeCsvValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
};
const buildCsv = (headers, rows) => {
  const lines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ];
  return lines.join("\n");
};
const buildUserResponse = (user) => {
  const normalized = serializeUser(user);
  return {
    id: normalized.id,
    facility_id: normalized.facility_id,
    email: normalized.email,
    full_name: normalized.full_name,
    role: normalized.role,
    status: normalized.status,
  };
};

const createRateLimiter = ({ keyPrefix, windowMs, max, message }) => {
  const store = new Map();
  const safeWindowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 10 * 60 * 1000;
  const safeMax = Number.isFinite(max) && max > 0 ? max : 600;
  return (req, res, next) => {
    if (!rateLimitEnabled) {
      return next();
    }
    if (req.path === "/health") {
      return next();
    }
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    let entry = store.get(key);
    if (!entry || now - entry.start >= safeWindowMs) {
      entry = { start: now, count: 0 };
      store.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > safeMax) {
      const retryAfter = Math.max(1, Math.ceil((safeWindowMs - (now - entry.start)) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ message });
    }
    return next();
  };
};

const generalRateLimiter = createRateLimiter({
  keyPrefix: "general",
  windowMs: rateLimitWindowMinutes * 60 * 1000,
  max: rateLimitMax,
  message: "Too many requests. Please try again later.",
});

const authRateLimiter = createRateLimiter({
  keyPrefix: "auth",
  windowMs: rateLimitAuthWindowMinutes * 60 * 1000,
  max: rateLimitAuthMax,
  message: "Too many login attempts. Please try again later.",
});

const uploadRateLimiter = createRateLimiter({
  keyPrefix: "upload",
  windowMs: rateLimitUploadWindowMinutes * 60 * 1000,
  max: rateLimitUploadMax,
  message: "Upload rate limit exceeded. Please try again later.",
});

app.disable("x-powered-by");
if (trustProxy) {
  app.set("trust proxy", 1);
}
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: "25mb" }));
app.use(morgan("dev"));
app.use(generalRateLimiter);
const openapiPath = path.resolve(__dirname, "../../api/openapi.yaml");
const openapiSpec = YAML.load(openapiPath);

app.get("/openapi.yaml", (_req, res) => {
  res.type("text/yaml").sendFile(openapiPath);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.get("/health", asyncHandler(async (_req, res) => {
  const payload = {
    status: "ok",
    db: "ok",
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  try {
    await pool.query("SELECT 1");
    res.status(200).json(payload);
  } catch (_error) {
    res.status(500).json({ ...payload, status: "error", db: "error" });
  }
}));

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, pbkdf2Iterations, 32, "sha256").toString("hex");
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return { salt, hash };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, facility_id: user.facility_id, role: user.role },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

async function probeVideo(filePath) {
  return await new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration",
        "-of",
        "json",
        filePath,
      ],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          const stream = parsed.streams && parsed.streams[0] ? parsed.streams[0] : {};
          const duration = stream.duration ? Number(stream.duration) : null;
          const width = stream.width ? Number(stream.width) : null;
          const height = stream.height ? Number(stream.height) : null;
          resolve({ durationSeconds: duration, width, height });
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

async function getUserById(userId) {
  const { rows } = await pool.query(
    `SELECT id, facility_id, email, full_name, role, status, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0];
}

const authMiddleware = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Missing Authorization header" });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = await getUserById(decoded.sub);
    if (!user || user.status !== "active") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});

const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};

async function audit(userId, action, entityType, entityId, metadata) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, entityType, entityId, metadata || null]
    );
  } catch (error) {
    console.error("Failed to write audit log", error.message);
  }
}

async function logExport({ userId, facilityId, exportType, params, status, tokenId }) {
  try {
    await pool.query(
      `INSERT INTO export_logs (user_id, facility_id, export_token_id, export_type, params, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId || null, facilityId || null, tokenId || null, exportType, params || null, status]
    );
  } catch (error) {
    console.error("Failed to write export log", error.message);
  }
}

async function createNotification({
  facilityId,
  userId,
  type,
  title,
  body,
  data,
  channel = "in_app",
  eventKey,
}) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (facility_id, user_id, type, title, body, data, channel, event_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id, facility_id, user_id, type, title, body, data, channel, status, created_at, read_at`,
    [facilityId || null, userId || null, type, title, body, data || null, channel, eventKey || null]
  );
  return rows[0] || null;
}

async function updateNotificationData(notificationId, patch) {
  if (!notificationId || !patch || typeof patch !== "object") {
    return;
  }
  try {
    await pool.query(
      `UPDATE notifications
       SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [notificationId, JSON.stringify(patch)]
    );
  } catch (error) {
    console.error("Failed to update notification data", error.message);
  }
}

async function writeEmailOutbox({ to, subject, body, data }) {
  try {
    await fs.promises.mkdir(emailOutboxDir, { recursive: true });
    const filename = path.join(emailOutboxDir, `email_${formatDateOnly(new Date())}.jsonl`);
    const payload = {
      from: emailFrom,
      to,
      subject,
      body,
      data: data || null,
      created_at: new Date().toISOString(),
    };
    await fs.promises.appendFile(filename, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write email outbox", error.message);
  }
}

async function sendSmtpEmail({ to, subject, body, data }) {
  if (!smtpEnabled) {
    return false;
  }
  try {
    const transport = getSmtpTransport();
    if (!transport) {
      return false;
    }
    await transport.sendMail({
      from: emailFrom,
      to,
      subject,
      text: body,
      headers: data ? { "X-StrideSafe-Data": JSON.stringify(data) } : undefined,
    });
    return true;
  } catch (error) {
    console.error("Failed to send SMTP email", error.message);
    return false;
  }
}

async function notifyFacilityUsers({
  facilityId,
  type,
  title,
  body,
  data,
  eventKeyBase,
  roles,
}) {
  const values = [facilityId];
  let roleClause = "";
  if (roles && roles.length) {
    values.push(roles);
    roleClause = "AND role = ANY($2)";
  }
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE facility_id = $1 AND status = 'active' ${roleClause}`,
    values
  );
  await Promise.all(
    rows.map((row) => createNotification({
      facilityId,
      userId: row.id,
      type,
      title,
      body,
      data,
      eventKey: eventKeyBase ? `${eventKeyBase}:${row.id}` : null,
    }))
  );
}

async function notifyFacilityUsersEmail({
  facilityId,
  type,
  title,
  body,
  data,
  eventKeyBase,
  roles,
}) {
  if (!exportScheduleEmailEnabled) {
    return;
  }
  const roleList = roles && roles.length ? roles : resolveExportScheduleEmailRoles();
  const values = [facilityId];
  let roleClause = "";
  if (roleList && roleList.length) {
    values.push(roleList);
    roleClause = "AND role = ANY($2)";
  }
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE facility_id = $1 AND status = 'active' ${roleClause}`,
    values
  );
  await Promise.all(
    rows.map(async (row) => {
      const email = normalizeString(row.email);
      if (!email) {
        return;
      }
      const notification = await createNotification({
        facilityId,
        userId: row.id,
        type,
        title,
        body,
        data,
        channel: "email",
        eventKey: eventKeyBase ? `${eventKeyBase}:${row.id}:email` : null,
      });
      if (!notification) {
        return;
      }
      const payload = {
        to: email,
        subject: title,
        body,
        data: {
          ...data,
          facility_id: facilityId,
          user_id: row.id,
        },
      };
      const sent = await sendSmtpEmail(payload);
      await updateNotificationData(notification.id, {
        email_delivery: sent ? "sent" : "queued",
      });
      if (!sent) {
        await writeEmailOutbox(payload);
      }
    })
  );
}

const getNextNotificationScanTime = (now = new Date()) => {
  const next = new Date(now);
  next.setHours(notificationScanHour, notificationScanMinute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

async function enqueueTask({ taskType, payload, runAt, taskKey }) {
  const { rows } = await pool.query(
    `INSERT INTO task_queue (task_key, task_type, payload, run_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_key) DO NOTHING
     RETURNING id, task_key, task_type, run_at`,
    [taskKey || null, taskType, payload || null, runAt || new Date()]
  );
  return rows[0] || null;
}

const resolveStoragePath = (storageKey) => path.resolve(storageRoot, storageKey || "");

async function createGaitModelRun({ facilityId, assessmentId, videoId }) {
  const { rows } = await pool.query(
    `INSERT INTO gait_model_runs (facility_id, assessment_id, video_id, status, model_version)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING id, facility_id, assessment_id, video_id, status, model_version, created_at`,
    [facilityId, assessmentId, videoId, gaitModelVersion]
  );
  return rows[0];
}

async function enqueueGaitModelRun(run) {
  if (!run?.id) {
    return null;
  }
  const taskKey = `gait_model:${run.id}`;
  return enqueueTask({
    taskType: "gait_model_extract",
    payload: { run_id: run.id, video_id: run.video_id },
    taskKey,
  });
}

async function runGaitModel(payload = {}) {
  const runId = payload.run_id;
  if (!runId) {
    return;
  }
  const { rows } = await pool.query(
    `SELECT g.id, g.status, g.model_version, g.assessment_id, g.video_id,
            v.storage_key, v.duration_seconds, v.width, v.height,
            r.facility_id, COALESCE(a.assessment_protocol, f.assessment_protocol) AS assessment_protocol
     FROM gait_model_runs g
     JOIN videos v ON v.id = g.video_id
     JOIN assessments a ON a.id = g.assessment_id
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE g.id = $1`,
    [runId]
  );
  const run = rows[0];
  if (!run) {
    return;
  }

  await pool.query(
    `UPDATE gait_model_runs SET status = 'running', updated_at = now() WHERE id = $1`,
    [run.id]
  );

  let modelOutput = null;
  if (gaitModelScript) {
    const scriptPath = path.isAbsolute(gaitModelScript)
      ? gaitModelScript
      : path.resolve(__dirname, "..", "scripts", gaitModelScript);
    if (fs.existsSync(scriptPath)) {
      const videoPath = resolveStoragePath(run.storage_key);
      try {
        modelOutput = await new Promise((resolve, reject) => {
          execFile(
            "python3",
            [
              scriptPath,
              "--video",
              videoPath,
              "--duration",
              String(run.duration_seconds || ""),
              "--width",
              String(run.width || ""),
              "--height",
              String(run.height || ""),
              "--assessment-id",
              run.assessment_id,
            ],
            { timeout: gaitModelTimeoutMs },
            (error, stdout) => {
              if (error) {
                reject(error);
                return;
              }
              try {
                const parsed = JSON.parse(stdout || "{}");
                resolve(parsed);
              } catch (parseError) {
                reject(parseError);
              }
            }
          );
        });
      } catch (error) {
        modelOutput = { notes: `model_error:${error.message}` };
      }
    }
  }

  if (!modelOutput) {
    modelOutput = { notes: "stub: model not configured" };
  }

  await pool.query(
    `UPDATE gait_model_runs
     SET status = 'completed',
         model_version = $2,
         tug_seconds = $3,
         chair_stand_seconds = $4,
         balance_side_by_side = $5,
         balance_semi_tandem = $6,
         balance_tandem = $7,
         confidence = $8,
         notes = $9,
         updated_at = now()
     WHERE id = $1`,
    [
      run.id,
      modelOutput.model_version || gaitModelVersion,
      Number.isFinite(modelOutput.tug_seconds) ? modelOutput.tug_seconds : null,
      Number.isFinite(modelOutput.chair_stand_seconds) ? modelOutput.chair_stand_seconds : null,
      typeof modelOutput.balance_side_by_side === "boolean" ? modelOutput.balance_side_by_side : null,
      typeof modelOutput.balance_semi_tandem === "boolean" ? modelOutput.balance_semi_tandem : null,
      typeof modelOutput.balance_tandem === "boolean" ? modelOutput.balance_tandem : null,
      Number.isFinite(modelOutput.confidence) ? modelOutput.confidence : null,
      toNullableString(modelOutput.notes) || "stub: model not configured",
    ]
  );

  await upsertModelScores({
    assessmentId: run.assessment_id,
    protocol: run.assessment_protocol,
    model: modelOutput,
  });
}

async function scheduleNextDueScan(facilityId, referenceDate = new Date()) {
  const nextRun = getNextNotificationScanTime(referenceDate);
  const scanDate = formatDateOnly(nextRun);
  const taskKey = `assessment_due_scan:${facilityId}:${scanDate}`;
  await enqueueTask({
    taskType: "assessment_due_scan",
    payload: { facility_id: facilityId, scan_date: scanDate },
    runAt: nextRun,
    taskKey,
  });
}

const getNextExportRunTime = (schedule, referenceDate = new Date()) => {
  const next = new Date(referenceDate);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  if (schedule.frequency === "daily") {
    if (next <= referenceDate) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }
  if (schedule.frequency === "weekly") {
    const targetDay = Number(schedule.day_of_week);
    if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) {
      return null;
    }
    const dayDelta = (targetDay - next.getDay() + 7) % 7;
    if (dayDelta === 0 && next <= referenceDate) {
      next.setDate(next.getDate() + 7);
    } else {
      next.setDate(next.getDate() + dayDelta);
    }
    return next;
  }
  return null;
};

async function scheduleNextExportRun(schedule, referenceDate = new Date()) {
  if (!schedule || schedule.status !== "active") {
    return;
  }
  const nextRun = getNextExportRunTime(schedule, referenceDate);
  if (!nextRun) {
    return;
  }
  const taskKey = `export_schedule:${schedule.id}:${nextRun.toISOString()}`;
  await pool.query(
    `UPDATE export_schedules SET next_run_at = $1, updated_at = now() WHERE id = $2`,
    [nextRun, schedule.id]
  );
  await enqueueTask({
    taskType: "export_schedule",
    payload: { schedule_id: schedule.id, run_at: nextRun.toISOString() },
    runAt: nextRun,
    taskKey,
  });
}

async function seedExportScheduleTasks() {
  const { rows } = await pool.query(
    `SELECT * FROM export_schedules WHERE status = 'active'`
  );
  if (!rows.length) {
    return;
  }
  await Promise.all(rows.map((schedule) => scheduleNextExportRun(schedule, new Date())));
}

async function runExportSchedule({ schedule_id, run_at }) {
  if (!schedule_id) {
    return;
  }
  const { rows } = await pool.query(
    `SELECT * FROM export_schedules WHERE id = $1`,
    [schedule_id]
  );
  const schedule = rows[0];
  if (!schedule || schedule.status !== "active") {
    return;
  }
  if (run_at && schedule.next_run_at) {
    const scheduledTime = new Date(schedule.next_run_at);
    const payloadTime = new Date(run_at);
    if (!Number.isNaN(scheduledTime.getTime()) && !Number.isNaN(payloadTime.getTime())) {
      const delta = Math.abs(scheduledTime.getTime() - payloadTime.getTime());
      if (delta > 5 * 60 * 1000) {
        return;
      }
    }
  }

  let expiresHours = Number(schedule.expires_hours);
  if (!Number.isFinite(expiresHours) || expiresHours <= 0) {
    const ttlDays = await getFacilityTokenTtlDays(schedule.facility_id);
    expiresHours = ttlDays * 24;
  }
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
  const exportType = schedule.export_type;
  const scope = exportScopeForType(exportType);
  let params = schedule.params || null;
  if (exportType === "bundle") {
    const includeList = Array.isArray(schedule.include) ? schedule.include : null;
    params = { include: resolveBundleIncludes(includeList, "admin") };
  }
  const { rows: tokenRows } = await pool.query(
    `INSERT INTO export_tokens (user_id, created_by, facility_id, export_type, scope, params, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, export_type, scope, facility_id, params, expires_at, created_at, created_by, revoked_at`,
    [schedule.created_by, schedule.created_by, schedule.facility_id, exportType, scope, params, expiresAt]
  );
  const token = tokenRows[0];
  await logExport({
    userId: schedule.created_by,
    facilityId: schedule.facility_id,
    exportType,
    params,
    status: "schedule_issued",
    tokenId: token.id,
  });

  const title = "Scheduled export ready";
  const body = `${schedule.name} is ready for download.`;
  const data = {
    export_token_id: token.id,
    export_type: exportType,
    schedule_id: schedule.id,
    download_url: `/exports/download?token=${token.id}`,
  };
  await notifyFacilityUsers({
    facilityId: schedule.facility_id,
    type: "export.ready",
    title,
    body,
    data,
    roles: ["admin", "clinician"],
    eventKeyBase: `export_schedule:${schedule.id}:${token.id}`,
  });
  await notifyFacilityUsersEmail({
    facilityId: schedule.facility_id,
    type: "export.ready",
    title,
    body: `${body} Download: ${data.download_url}`,
    data,
    roles: resolveExportScheduleEmailRoles(),
    eventKeyBase: `export_schedule:${schedule.id}:${token.id}`,
  });

  await pool.query(
    `UPDATE export_schedules
     SET last_run_at = now(), updated_at = now()
     WHERE id = $1`,
    [schedule.id]
  );
  await scheduleNextExportRun(schedule, new Date());
  return token;
}

async function seedDueScanTasks() {
  const { rows } = await pool.query(`SELECT id FROM facilities`);
  if (!rows.length) {
    return;
  }
  await Promise.all(
    rows.map((row) => scheduleNextDueScan(row.id))
  );
}

async function runFallFollowupScan({ facility_id, scan_date, users }) {
  if (!facility_id) {
    return;
  }
  const scanDateValue = scan_date && parseDateOnly(scan_date) ? parseDateOnly(scan_date) : new Date();
  if (!scanDateValue) {
    return;
  }
  scanDateValue.setHours(0, 0, 0, 0);
  const scanDateString = formatDateOnly(scanDateValue);
  const { rows } = await pool.query(
    `SELECT fe.id, fe.resident_id, fe.occurred_at::date AS occurred_date,
            r.first_name, r.last_name,
            COALESCE(jsonb_array_length(f.fall_checklist), 0) AS required_count,
            COALESCE(done.completed_count, 0) AS completed_count
     FROM fall_events fe
     JOIN residents r ON r.id = fe.resident_id
     JOIN facilities f ON f.id = fe.facility_id
     LEFT JOIN (
       SELECT fall_event_id, COUNT(DISTINCT check_type) AS completed_count
       FROM post_fall_checks
       WHERE status = 'completed'
       GROUP BY fall_event_id
     ) done ON done.fall_event_id = fe.id
     WHERE fe.facility_id = $1
     ORDER BY fe.occurred_at DESC`,
    [facility_id]
  );
  if (!rows.length) {
    return;
  }

  const recipients = Array.isArray(users) && users.length
    ? users
    : (await pool.query(
      `SELECT id, role FROM users
       WHERE facility_id = $1 AND status = 'active' AND role IN ('clinician', 'admin')`,
      [facility_id]
    )).rows;

  await Promise.all(rows.flatMap((row) => {
    const requiredCount = Number(row.required_count) || 0;
    const completedCount = Number(row.completed_count) || 0;
    if (requiredCount <= 0 || completedCount >= requiredCount) {
      return [];
    }
    const occurredDate = row.occurred_date ? parseDateOnly(row.occurred_date) : null;
    if (!occurredDate) {
      return [];
    }
    occurredDate.setHours(0, 0, 0, 0);
    const dueDate = new Date(occurredDate);
    dueDate.setDate(dueDate.getDate() + Math.max(0, postFallFollowupDays));
    if (dueDate > scanDateValue) {
      return [];
    }
    const isOverdue = dueDate < scanDateValue;
    const dueDateString = formatDateOnly(dueDate);
    const residentName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Resident";
    const type = isOverdue ? "fall.followup.overdue" : "fall.followup.due";
    const title = isOverdue ? "Post-fall follow-up overdue" : "Post-fall follow-up due";
    const body = isOverdue
      ? `${residentName} post-fall follow-up is overdue since ${dueDateString}.`
      : `${residentName} post-fall follow-up is due on ${dueDateString}.`;
    const data = {
      fall_event_id: row.id,
      resident_id: row.resident_id,
      resident_name: residentName,
      due_date: dueDateString,
      status: isOverdue ? "overdue" : "due",
      required_checks: requiredCount,
      completed_checks: completedCount,
      scan_date: scanDateString,
    };
    const eventKeyBase = `${type}:${row.id}:${dueDateString}`;
    const targetUsers = isOverdue
      ? recipients.filter((user) => user.role === "admin")
      : recipients;
    const finalTargets = targetUsers.length ? targetUsers : recipients;
    return finalTargets.map((user) => createNotification({
      facilityId: facility_id,
      userId: user.id,
      type,
      title,
      body,
      data,
      eventKey: `${eventKeyBase}:${user.id}`,
    }));
  }));
}

async function runDueAssessmentScan({ facility_id, scan_date }) {
  if (!facility_id) {
    return;
  }
  const scanDate = scan_date && parseDateOnly(scan_date) ? scan_date : formatDateOnly(new Date());
  const normalizeDateValue = (value) => {
    if (!value) {
      return null;
    }
    if (typeof value === "string") {
      return value.slice(0, 10);
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return formatDateOnly(value);
    }
    return null;
  };
  const { rows } = await pool.query(
    `SELECT a.id, a.due_date, r.id AS resident_id, r.first_name, r.last_name
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1
       AND a.status != 'completed'
       AND a.due_date IS NOT NULL
       AND a.due_date <= $2
     ORDER BY a.due_date ASC`,
    [facility_id, scanDate]
  );
  if (!rows.length) {
    return;
  }

  const { rows: userRows } = await pool.query(
    `SELECT id, role FROM users WHERE facility_id = $1 AND status = 'active' AND role IN ('clinician', 'admin')`,
    [facility_id]
  );

  await Promise.all(rows.flatMap((row) => {
    const dueDate = normalizeDateValue(row.due_date) || scanDate;
    const isOverdue = dueDate < scanDate;
    const residentName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Resident";
    const type = isOverdue ? "assessment.overdue" : "assessment.due";
    const title = isOverdue ? "Assessment overdue" : "Assessment due today";
    const body = isOverdue
      ? `${residentName} assessment is overdue since ${dueDate}.`
      : `${residentName} assessment is due today (${dueDate}).`;
    const data = {
      assessment_id: row.id,
      resident_id: row.resident_id,
      resident_name: residentName,
      due_date: dueDate,
      status: isOverdue ? "overdue" : "due",
    };
    const eventKeyBase = `${type}:${row.id}:${dueDate}`;
    return userRows.map((user) => createNotification({
      facilityId: facility_id,
      userId: user.id,
      type,
      title,
      body,
      data,
      eventKey: `${eventKeyBase}:${user.id}`,
    }));
  }));

  await runFallFollowupScan({ facility_id, scan_date: scanDate, users: userRows });
}

async function processTaskQueue() {
  const client = await pool.connect();
  let tasks = [];
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `WITH next_tasks AS (
         SELECT id FROM task_queue
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY run_at ASC
         LIMIT 5
         FOR UPDATE SKIP LOCKED
       )
       UPDATE task_queue t
       SET status = 'running', attempts = attempts + 1, updated_at = now()
       FROM next_tasks
       WHERE t.id = next_tasks.id
       RETURNING t.id, t.task_type, t.payload, t.attempts`
    );
    tasks = rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to claim tasks", error.message);
    return;
  } finally {
    client.release();
  }

  if (!tasks.length) {
    return;
  }

  await Promise.all(tasks.map(async (task) => {
    try {
      if (task.task_type === "assessment_due_scan") {
        await runDueAssessmentScan(task.payload || {});
        if (task.payload?.facility_id) {
          await scheduleNextDueScan(task.payload.facility_id);
        }
      } else if (task.task_type === "export_schedule") {
        await runExportSchedule(task.payload || {});
      } else if (task.task_type === "gait_model_extract") {
        await runGaitModel(task.payload || {});
      } else {
        throw new Error(`Unknown task ${task.task_type}`);
      }
      await pool.query(
        `UPDATE task_queue SET status = 'completed', updated_at = now() WHERE id = $1`,
        [task.id]
      );
    } catch (error) {
      const attempts = Number(task.attempts || 1);
      const shouldRetry = attempts < 3;
      const nextRunAt = shouldRetry
        ? new Date(Date.now() + taskRetryMinutes * 60 * 1000)
        : null;
      await pool.query(
        `UPDATE task_queue
         SET status = $2,
             run_at = COALESCE($3, run_at),
             last_error = $4,
             updated_at = now()
         WHERE id = $1`,
        [task.id, shouldRetry ? "pending" : "failed", nextRunAt, error.message]
      );
    }
  }));
}

function getFacilityIdForExport(requestedFacilityId, user) {
  if (requestedFacilityId) {
    if (requestedFacilityId !== user.facility_id && user.role !== "admin") {
      return null;
    }
    return requestedFacilityId;
  }
  return user.facility_id;
}

async function buildResidentsCsv({ facilityId }) {
  const { rows } = await pool.query(
    `SELECT id, facility_id, external_id, first_name, last_name, dob, sex, notes, created_at, updated_at
     FROM residents WHERE facility_id = $1 ORDER BY created_at DESC`,
    [facilityId]
  );
  const headers = [
    "id",
    "facility_id",
    "external_id",
    "first_name",
    "last_name",
    "dob",
    "sex",
    "notes",
    "created_at",
    "updated_at",
  ];
  const rowsData = rows.map((row) => ([
    row.id,
    row.facility_id,
    row.external_id,
    row.first_name,
    row.last_name,
    row.dob,
    row.sex,
    row.notes,
    row.created_at,
    row.updated_at,
  ]));
  return buildCsv(headers, rowsData);
}

async function buildAssessmentsCsv({ facilityId, query }) {
  const filters = [];
  const values = [facilityId];
  let index = 2;

  if (query?.resident_id) {
    filters.push(`a.resident_id = $${index}`);
    values.push(query.resident_id);
    index += 1;
  }

  if (query?.status) {
    const status = normalizeString(query.status).toLowerCase();
    if (!allowedAssessmentStatuses.has(status)) {
      throw Object.assign(new Error("Invalid status filter"), { status: 400 });
    }
    filters.push(`a.status = $${index}`);
    values.push(status);
    index += 1;
  }

  if (query?.risk_tier) {
    const risk = normalizeString(query.risk_tier).toLowerCase();
    if (!allowedRiskTiers.has(risk)) {
      throw Object.assign(new Error("Invalid risk_tier filter"), { status: 400 });
    }
    filters.push(`a.risk_tier = $${index}`);
    values.push(risk);
    index += 1;
  }

  if (query?.assigned_to) {
    const assigned = normalizeString(query.assigned_to);
    if (assigned === "unassigned") {
      filters.push("a.assigned_to IS NULL");
    } else {
      if (!isUuid(assigned)) {
        throw Object.assign(new Error("Invalid assigned_to filter"), { status: 400 });
      }
      filters.push(`a.assigned_to = $${index}`);
      values.push(assigned);
      index += 1;
    }
  }

  if (query?.from) {
    const fromDate = parseDateOnly(query.from);
    if (!fromDate) {
      throw Object.assign(new Error("Invalid from date"), { status: 400 });
    }
    filters.push(`a.assessment_date >= $${index}`);
    values.push(query.from);
    index += 1;
  }

  if (query?.to) {
    const toDate = parseDateOnly(query.to);
    if (!toDate) {
      throw Object.assign(new Error("Invalid to date"), { status: 400 });
    }
    filters.push(`a.assessment_date <= $${index}`);
    values.push(query.to);
    index += 1;
  }

  if (query?.scheduled_from) {
    const fromDate = parseDateOnly(query.scheduled_from);
    if (!fromDate) {
      throw Object.assign(new Error("Invalid scheduled_from date"), { status: 400 });
    }
    filters.push(`a.scheduled_date >= $${index}`);
    values.push(query.scheduled_from);
    index += 1;
  }

  if (query?.scheduled_to) {
    const toDate = parseDateOnly(query.scheduled_to);
    if (!toDate) {
      throw Object.assign(new Error("Invalid scheduled_to date"), { status: 400 });
    }
    filters.push(`a.scheduled_date <= $${index}`);
    values.push(query.scheduled_to);
    index += 1;
  }

  if (query?.due_from) {
    const fromDate = parseDateOnly(query.due_from);
    if (!fromDate) {
      throw Object.assign(new Error("Invalid due_from date"), { status: 400 });
    }
    filters.push(`a.due_date >= $${index}`);
    values.push(query.due_from);
    index += 1;
  }

  if (query?.due_to) {
    const toDate = parseDateOnly(query.due_to);
    if (!toDate) {
      throw Object.assign(new Error("Invalid due_to date"), { status: 400 });
    }
    filters.push(`a.due_date <= $${index}`);
    values.push(query.due_to);
    index += 1;
  }

  const whereClause = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT a.id, a.resident_id, r.external_id, r.first_name, r.last_name,
            a.assessment_date, a.scheduled_date, a.due_date, a.reassessment_due_date, a.completed_at,
            a.status, a.assistive_device, a.risk_tier, a.clinician_notes,
            a.assigned_to, a.assigned_at,
            a.created_at, a.updated_at
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1 ${whereClause}
     ORDER BY a.assessment_date DESC`,
    values
  );

  const headers = [
    "id",
    "resident_id",
    "resident_external_id",
    "resident_first_name",
    "resident_last_name",
    "assessment_date",
    "scheduled_date",
    "due_date",
    "reassessment_due_date",
    "completed_at",
    "status",
    "assistive_device",
    "risk_tier",
    "clinician_notes",
    "assigned_to",
    "assigned_at",
    "created_at",
    "updated_at",
  ];
  const rowsData = rows.map((row) => ([
    row.id,
    row.resident_id,
    row.external_id,
    row.first_name,
    row.last_name,
    row.assessment_date,
    row.scheduled_date,
    row.due_date,
    row.reassessment_due_date,
    row.completed_at,
    row.status,
    row.assistive_device,
    row.risk_tier,
    row.clinician_notes,
    row.assigned_to,
    row.assigned_at,
    row.created_at,
    row.updated_at,
  ]));
  return buildCsv(headers, rowsData);
}

async function buildAuditCsv({ facilityId, query }) {
  const limitRaw = query?.limit;
  const limit = limitRaw === undefined ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw Object.assign(new Error("Invalid limit"), { status: 400 });
  }
  const filters = ["u.facility_id = $1"];
  const values = [facilityId];
  let index = 2;

  if (query?.action) {
    const action = normalizeString(query.action);
    if (!action) {
      throw Object.assign(new Error("Invalid action filter"), { status: 400 });
    }
    filters.push(`l.action = $${index}`);
    values.push(action);
    index += 1;
  }

  if (query?.entity_type) {
    const entityType = normalizeString(query.entity_type);
    if (!entityType) {
      throw Object.assign(new Error("Invalid entity_type filter"), { status: 400 });
    }
    filters.push(`l.entity_type = $${index}`);
    values.push(entityType);
    index += 1;
  }

  if (query?.user_id) {
    const userId = normalizeString(query.user_id);
    if (!userId) {
      throw Object.assign(new Error("Invalid user_id filter"), { status: 400 });
    }
    filters.push(`l.user_id = $${index}`);
    values.push(userId);
    index += 1;
  }

  if (query?.from) {
    const fromDate = parseDateTime(query.from);
    if (!fromDate) {
      throw Object.assign(new Error("Invalid from date"), { status: 400 });
    }
    filters.push(`l.created_at >= $${index}`);
    values.push(fromDate);
    index += 1;
  }

  if (query?.to) {
    const toDate = parseDateTime(query.to);
    if (!toDate) {
      throw Object.assign(new Error("Invalid to date"), { status: 400 });
    }
    filters.push(`l.created_at <= $${index}`);
    values.push(toDate);
    index += 1;
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT l.id, l.user_id, u.email AS user_email, u.full_name AS user_name, u.role AS user_role,
            l.action, l.entity_type, l.entity_id, l.metadata, l.created_at
     FROM audit_logs l
     JOIN users u ON u.id = l.user_id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${index}`,
    [...values, limit]
  );

  const headers = [
    "id",
    "user_id",
    "user_email",
    "user_name",
    "user_role",
    "action",
    "entity_type",
    "entity_id",
    "metadata",
    "created_at",
  ];
  const rowsData = rows.map((row) => ([
    row.id,
    row.user_id,
    row.user_email,
    row.user_name,
    row.user_role,
    row.action,
    row.entity_type,
    row.entity_id,
    row.metadata ? JSON.stringify(row.metadata) : null,
    row.created_at,
  ]));
  return buildCsv(headers, rowsData);
}

async function fetchPostFallRollup({ facilityId, days = 30, unitId = null, limit = 200 }) {
  const windowDays = Number.isInteger(days) ? days : 30;
  const rowLimit = Number.isInteger(limit) ? limit : 200;
  const unitFilter = unitId || null;

  const { rows } = await pool.query(
    `WITH events AS (
       SELECT fe.id,
              fe.occurred_at::date AS occurred_date,
              r.unit_id,
              COALESCE(jsonb_array_length(f.fall_checklist), 0) AS required_count
       FROM fall_events fe
       JOIN residents r ON r.id = fe.resident_id
       JOIN facilities f ON f.id = fe.facility_id
       WHERE fe.facility_id = $1
         AND fe.occurred_at >= now() - ($2 * interval '1 day')
         AND ($3::uuid IS NULL OR r.unit_id = $3)
     ),
     completed AS (
       SELECT fall_event_id, COUNT(DISTINCT check_type) AS completed_count
       FROM post_fall_checks
       WHERE status = 'completed'
       GROUP BY fall_event_id
     ),
     scored AS (
       SELECT e.*, COALESCE(c.completed_count, 0) AS completed_count
       FROM events e
       LEFT JOIN completed c ON c.fall_event_id = e.id
       WHERE e.required_count > 0
     )
     SELECT s.unit_id,
            fu.label AS unit_label,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE s.completed_count >= s.required_count)::int AS completed,
            COUNT(*) FILTER (WHERE s.completed_count < s.required_count)::int AS open,
            COUNT(*) FILTER (
              WHERE s.completed_count < s.required_count
                AND (s.occurred_date + make_interval(days => $4))::date < CURRENT_DATE
            )::int AS overdue
     FROM scored s
     LEFT JOIN facility_units fu ON fu.id = s.unit_id
     GROUP BY s.unit_id, fu.label
     ORDER BY overdue DESC, open DESC, total DESC, unit_label ASC
     LIMIT $5`,
    [facilityId, windowDays, unitFilter, postFallFollowupDays, rowLimit]
  );

  return rows.map((row) => {
    const total = Number(row.total) || 0;
    const completed = Number(row.completed) || 0;
    return {
      unit_id: row.unit_id,
      unit_label: row.unit_label,
      total,
      completed,
      open: Number(row.open) || 0,
      overdue: Number(row.overdue) || 0,
      completion_rate: total ? completed / total : 0,
    };
  });
}

async function buildPostFallRollupCsv({ facilityId, params }) {
  const windowDays = Number(params?.days) || 30;
  const unitId = params?.unit_id || null;
  const limit = Number(params?.limit) || 200;
  const rows = await fetchPostFallRollup({ facilityId, days: windowDays, unitId, limit });
  const headers = [
    "unit_id",
    "unit_label",
    "total",
    "completed",
    "open",
    "overdue",
    "completion_rate",
  ];
  const rowsData = rows.map((row) => ([
    row.unit_id,
    row.unit_label,
    row.total,
    row.completed,
    row.open,
    row.overdue,
    Number.isFinite(row.completion_rate) ? row.completion_rate : 0,
  ]));
  return buildCsv(headers, rowsData);
}

const normalizeIncludeList = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parts = Array.isArray(value) ? value : [value];
  const normalized = parts
    .flatMap((entry) => normalizeString(entry).split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? normalized : null;
};

function resolveBundleIncludes(includeRaw, userRole) {
  const provided = normalizeIncludeList(includeRaw);
  const includes = provided
    ?? (userRole === "admin"
      ? ["residents", "assessments", "audit"]
      : ["residents", "assessments"]);
  const unique = Array.from(new Set(includes));
  const invalid = unique.filter((entry) => !allowedBundleIncludes.has(entry));
  if (invalid.length) {
    throw Object.assign(new Error(`Invalid include: ${invalid.join(", ")}`), { status: 400 });
  }
  if (unique.includes("audit") && userRole !== "admin") {
    throw Object.assign(new Error("Forbidden include"), { status: 403 });
  }
  return unique;
}

function sanitizeAssessmentExportParams(rawParams) {
  const allowedKeys = [
    "resident_id",
    "status",
    "risk_tier",
    "from",
    "to",
    "assigned_to",
    "scheduled_from",
    "scheduled_to",
    "due_from",
    "due_to",
  ];
  const filtered = {};
  allowedKeys.forEach((key) => {
    const value = normalizeString(rawParams?.[key]);
    if (!value) {
      return;
    }
    if (key === "status" && !allowedAssessmentStatuses.has(value)) {
      throw Object.assign(new Error("Invalid status filter"), { status: 400 });
    }
    if (key === "risk_tier" && !allowedRiskTiers.has(value)) {
      throw Object.assign(new Error("Invalid risk_tier filter"), { status: 400 });
    }
    if (["from", "to", "scheduled_from", "scheduled_to", "due_from", "due_to"].includes(key)) {
      if (!parseDateOnly(value)) {
        throw Object.assign(new Error(`Invalid ${key} date`), { status: 400 });
      }
    }
    if (key === "resident_id" && !isUuid(value)) {
      throw Object.assign(new Error("Invalid resident_id filter"), { status: 400 });
    }
    if (key === "assigned_to") {
      if (value !== "unassigned" && !isUuid(value)) {
        throw Object.assign(new Error("Invalid assigned_to filter"), { status: 400 });
      }
    }
    filtered[key] = value;
  });
  return Object.keys(filtered).length ? filtered : null;
}

function sanitizeAuditExportParams(rawParams) {
  const filtered = {};
  const stringKeys = ["action", "entity_type", "user_id", "from", "to"];
  stringKeys.forEach((key) => {
    const value = normalizeString(rawParams?.[key]);
    if (value) {
      filtered[key] = value;
    }
  });
  if (rawParams?.limit !== undefined) {
    const limit = Number(rawParams.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw Object.assign(new Error("Invalid limit"), { status: 400 });
    }
    filtered.limit = limit;
  }
  return Object.keys(filtered).length ? filtered : null;
}

function sanitizePostFallRollupParams(rawParams) {
  const filtered = {};
  if (rawParams?.days !== undefined) {
    const days = Number(rawParams.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw Object.assign(new Error("Invalid days window"), { status: 400 });
    }
    filtered.days = days;
  }
  if (rawParams?.unit_id) {
    const unitId = normalizeString(rawParams.unit_id);
    if (!unitId || !isUuid(unitId)) {
      throw Object.assign(new Error("Invalid unit_id filter"), { status: 400 });
    }
    filtered.unit_id = unitId;
  }
  if (rawParams?.limit !== undefined) {
    const limit = Number(rawParams.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw Object.assign(new Error("Invalid limit"), { status: 400 });
    }
    filtered.limit = limit;
  }
  return Object.keys(filtered).length ? filtered : null;
}

async function streamZip(res, filename, entries) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    res.on("finish", resolve);
    archive.on("warning", (error) => {
      if (error?.code === "ENOENT") {
        console.warn("Zip warning", error.message);
      } else {
        reject(error);
      }
    });
    archive.on("error", reject);
    archive.pipe(res);
    entries.forEach((entry) => {
      archive.append(entry.content, { name: entry.name });
    });
    archive.finalize();
  });
}

function buildUpdate(fields) {
  const keys = Object.keys(fields).filter((key) => fields[key] !== undefined);
  if (!keys.length) {
    return null;
  }
  const setClauses = keys.map((key, index) => `${key} = $${index + 1}`);
  const values = keys.map((key) => fields[key]);
  return { setClauses, values };
}

function ensureVideoDir(assessmentId) {
  const dir = path.resolve(storageRoot, "videos", assessmentId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureReportDir() {
  const dir = path.resolve(storageRoot, "reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeStorageKey(filePath) {
  return filePath.split(path.sep).join("/");
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = ensureVideoDir(req.params.id);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || ".mp4");
      const name = `${crypto.randomUUID()}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: maxVideoSizeBytes },
});

app.post("/auth/login", authRateLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeString(email).toLowerCase();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }
  const { rows } = await pool.query(
    `SELECT id, facility_id, email, full_name, role, status, password_salt, password_hash
     FROM users WHERE email = $1`,
    [normalizedEmail]
  );
  const user = rows[0];
  if (!user || user.status !== "active" || !user.password_salt || !user.password_hash) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const computed = hashPassword(password, user.password_salt);
  if (computed !== user.password_hash) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const token = signToken(user);
  await audit(user.id, "auth.login", "user", user.id, null);
  res.json({
    token,
    user: buildUserResponse(user),
  });
}));

app.post("/auth/logout", (_req, res) => res.status(204).send());

app.get("/auth/me", authMiddleware, asyncHandler(async (req, res) => {
  res.status(200).json(buildUserResponse(req.user));
}));

app.get("/facilities", authMiddleware, asyncHandler(async (req, res) => {
  const query = req.user.role === "admin"
    ? {
        text: `SELECT id, name, address_line1, address_line2, city, state, zip,
                      reassessment_cadence_days, report_turnaround_hours, qa_checklist, fall_checklist,
                      export_token_ttl_days,
                      assessment_protocol, capture_method, role_policy,
                      created_at, updated_at
               FROM facilities ORDER BY name ASC`,
        values: [],
      }
    : {
        text: `SELECT id, name, address_line1, address_line2, city, state, zip,
                      reassessment_cadence_days, report_turnaround_hours, qa_checklist, fall_checklist,
                      export_token_ttl_days,
                      assessment_protocol, capture_method, role_policy,
                      created_at, updated_at
               FROM facilities WHERE id = $1`,
        values: [req.user.facility_id],
      };
  const { rows } = await pool.query(query.text, query.values);
  res.json(rows);
}));

app.get("/facilities/:id", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.user.facility_id !== id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { rows } = await pool.query(
    `SELECT id, name, address_line1, address_line2, city, state, zip,
            reassessment_cadence_days, report_turnaround_hours, qa_checklist, fall_checklist,
            export_token_ttl_days,
            assessment_protocol, capture_method, role_policy,
            created_at, updated_at
     FROM facilities WHERE id = $1`,
    [id]
  );
  if (!rows[0]) {
    return res.status(404).json({ message: "Facility not found" });
  }
  res.json(rows[0]);
}));

app.post("/facilities", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const {
    name,
    address_line1,
    address_line2,
    city,
    state,
    zip,
    reassessment_cadence_days,
    report_turnaround_hours,
    qa_checklist,
    fall_checklist,
    export_token_ttl_days,
    assessment_protocol,
    capture_method,
    role_policy,
  } = req.body || {};

  const normalizedName = normalizeString(name);
  if (!normalizedName) {
    return res.status(400).json({ message: "Facility name is required" });
  }

  const cadence = parseOptionalPositiveInt(reassessment_cadence_days);
  if (cadence.error) {
    return res.status(400).json({ message: "Invalid reassessment cadence" });
  }
  const reportHours = parseOptionalPositiveInt(report_turnaround_hours);
  if (reportHours.error) {
    return res.status(400).json({ message: "Invalid report turnaround hours" });
  }
  const checklist = normalizeChecklist(qa_checklist);
  if (checklist.error) {
    return res.status(400).json({ message: "Invalid QA checklist" });
  }
  const fallChecklist = normalizeChecklist(fall_checklist);
  if (fallChecklist.error) {
    return res.status(400).json({ message: "Invalid fall checklist" });
  }
  const exportTtl = parseOptionalPositiveInt(export_token_ttl_days);
  if (exportTtl.error) {
    return res.status(400).json({ message: "Invalid export token TTL" });
  }
  const protocol = parseOptionalEnum(assessment_protocol, allowedAssessmentProtocols);
  if (protocol.error) {
    return res.status(400).json({ message: "Invalid assessment protocol" });
  }
  const captureMethod = parseOptionalEnum(capture_method, allowedCaptureMethods);
  if (captureMethod.error) {
    return res.status(400).json({ message: "Invalid capture method" });
  }
  const rolePolicy = parseOptionalEnum(role_policy, allowedRolePolicies);
  if (rolePolicy.error) {
    return res.status(400).json({ message: "Invalid role policy" });
  }

  const { rows } = await pool.query(
    `INSERT INTO facilities (name, address_line1, address_line2, city, state, zip,
                             reassessment_cadence_days, report_turnaround_hours, qa_checklist, fall_checklist,
                             export_token_ttl_days,
                             assessment_protocol, capture_method, role_policy)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, name, address_line1, address_line2, city, state, zip,
               reassessment_cadence_days, report_turnaround_hours, qa_checklist, fall_checklist,
               export_token_ttl_days,
               assessment_protocol, capture_method, role_policy,
               created_at, updated_at`,
    [
      normalizedName,
      toNullableString(address_line1),
      toNullableString(address_line2),
      toNullableString(city),
      toNullableString(state),
      toNullableString(zip),
      cadence.value || 90,
      reportHours.value || 24,
      JSON.stringify(checklist.value || []),
      JSON.stringify(fallChecklist.value || []),
      exportTtl.value || 7,
      protocol.value || "tug_chair_balance",
      captureMethod.value || "record_upload",
      rolePolicy.value || "clinician_admin_only",
    ]
  );
  await audit(req.user.id, "facility.created", "facility", rows[0].id, { name: normalizedName });
  scheduleNextDueScan(rows[0].id).catch((error) => {
    console.error("Failed to schedule due scan", error.message);
  });
  res.status(201).json(rows[0]);
}));

app.patch("/facilities/:id", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateFields = {};

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
    const normalizedName = normalizeString(req.body?.name);
    if (!normalizedName) {
      return res.status(400).json({ message: "Facility name is required" });
    }
    updateFields.name = normalizedName;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "address_line1")) {
    updateFields.address_line1 = toNullableString(req.body?.address_line1);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "address_line2")) {
    updateFields.address_line2 = toNullableString(req.body?.address_line2);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "city")) {
    updateFields.city = toNullableString(req.body?.city);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "state")) {
    updateFields.state = toNullableString(req.body?.state);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "zip")) {
    updateFields.zip = toNullableString(req.body?.zip);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "reassessment_cadence_days")) {
    const cadence = parseOptionalPositiveInt(req.body?.reassessment_cadence_days);
    if (cadence.error || cadence.value === null) {
      return res.status(400).json({ message: "Invalid reassessment cadence" });
    }
    updateFields.reassessment_cadence_days = cadence.value;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "report_turnaround_hours")) {
    const reportHours = parseOptionalPositiveInt(req.body?.report_turnaround_hours);
    if (reportHours.error || reportHours.value === null) {
      return res.status(400).json({ message: "Invalid report turnaround hours" });
    }
    updateFields.report_turnaround_hours = reportHours.value;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "export_token_ttl_days")) {
    const exportTtl = parseOptionalPositiveInt(req.body?.export_token_ttl_days);
    if (exportTtl.error || exportTtl.value === null) {
      return res.status(400).json({ message: "Invalid export token TTL" });
    }
    updateFields.export_token_ttl_days = exportTtl.value;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "qa_checklist")) {
    const checklist = normalizeChecklist(req.body?.qa_checklist);
    if (checklist.error) {
      return res.status(400).json({ message: "Invalid QA checklist" });
    }
    updateFields.qa_checklist = JSON.stringify(checklist.value || []);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "fall_checklist")) {
    const checklist = normalizeChecklist(req.body?.fall_checklist);
    if (checklist.error) {
      return res.status(400).json({ message: "Invalid fall checklist" });
    }
    updateFields.fall_checklist = JSON.stringify(checklist.value || []);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "assessment_protocol")) {
    const protocol = parseOptionalEnum(req.body?.assessment_protocol, allowedAssessmentProtocols);
    if (protocol.error || protocol.value === null) {
      return res.status(400).json({ message: "Invalid assessment protocol" });
    }
    updateFields.assessment_protocol = protocol.value;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "capture_method")) {
    const captureMethod = parseOptionalEnum(req.body?.capture_method, allowedCaptureMethods);
    if (captureMethod.error || captureMethod.value === null) {
      return res.status(400).json({ message: "Invalid capture method" });
    }
    updateFields.capture_method = captureMethod.value;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "role_policy")) {
    const rolePolicy = parseOptionalEnum(req.body?.role_policy, allowedRolePolicies);
    if (rolePolicy.error || rolePolicy.value === null) {
      return res.status(400).json({ message: "Invalid role policy" });
    }
    updateFields.role_policy = rolePolicy.value;
  }

  const update = buildUpdate(updateFields);
  if (!update) {
    return res.status(400).json({ message: "No fields to update" });
  }

  const { setClauses, values } = update;
  const { rows } = await pool.query(
    `UPDATE facilities SET ${setClauses.join(", ")}, updated_at = now()
     WHERE id = $${values.length + 1}
     RETURNING id, name, address_line1, address_line2, city, state, zip,
               reassessment_cadence_days, report_turnaround_hours, qa_checklist, fall_checklist,
               export_token_ttl_days,
               assessment_protocol, capture_method, role_policy,
               created_at, updated_at`,
    [...values, id]
  );
  if (!rows[0]) {
    return res.status(404).json({ message: "Facility not found" });
  }
  await audit(req.user.id, "facility.updated", "facility", id, null);
  res.json(rows[0]);
}));

app.get("/units", authMiddleware, asyncHandler(async (req, res) => {
  const facilityId = normalizeString(req.query.facility_id || req.user.facility_id);
  if (!facilityId) {
    return res.status(400).json({ message: "facility_id is required" });
  }
  if (facilityId !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { rows } = await pool.query(
    `SELECT id, facility_id, label, building, floor, unit, room, created_at, updated_at
     FROM facility_units
     WHERE facility_id = $1
     ORDER BY label ASC`,
    [facilityId]
  );
  res.json(rows);
}));

app.post("/units", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const {
    facility_id,
    label,
    building,
    floor,
    unit,
    room,
  } = req.body || {};
  const facilityId = facility_id || req.user.facility_id;
  if (facilityId !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { rows: facilityRows } = await pool.query(
    `SELECT id FROM facilities WHERE id = $1`,
    [facilityId]
  );
  if (!facilityRows[0]) {
    return res.status(400).json({ message: "Facility not found" });
  }
  const normalizedBuilding = toNullableString(building);
  const normalizedFloor = toNullableString(floor);
  const normalizedUnit = toNullableString(unit);
  const normalizedRoom = toNullableString(room);
  const normalizedLabel = buildUnitLabel({
    label,
    building: normalizedBuilding,
    floor: normalizedFloor,
    unit: normalizedUnit,
    room: normalizedRoom,
  });
  if (!normalizedLabel) {
    return res.status(400).json({ message: "Unit label is required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO facility_units (facility_id, label, building, floor, unit, room)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, facility_id, label, building, floor, unit, room, created_at, updated_at`,
      [
        facilityId,
        normalizedLabel,
        normalizedBuilding,
        normalizedFloor,
        normalizedUnit,
        normalizedRoom,
      ]
    );
    await audit(req.user.id, "unit.created", "unit", rows[0].id, { facility_id: facilityId });
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({ message: "Unit label already exists" });
    }
    throw error;
  }
}));

app.patch("/units/:id", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: unitRows } = await pool.query(
    `SELECT id FROM facility_units WHERE id = $1`,
    [id]
  );
  if (!unitRows[0]) {
    return res.status(404).json({ message: "Unit not found" });
  }

  const updateFields = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "label")) {
    const normalizedLabel = buildUnitLabel({
      label: req.body?.label,
      building: req.body?.building,
      floor: req.body?.floor,
      unit: req.body?.unit,
      room: req.body?.room,
    });
    if (!normalizedLabel) {
      return res.status(400).json({ message: "Unit label is required" });
    }
    updateFields.label = normalizedLabel;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "building")) {
    updateFields.building = toNullableString(req.body?.building);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "floor")) {
    updateFields.floor = toNullableString(req.body?.floor);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "unit")) {
    updateFields.unit = toNullableString(req.body?.unit);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "room")) {
    updateFields.room = toNullableString(req.body?.room);
  }

  const update = buildUpdate(updateFields);
  if (!update) {
    return res.status(400).json({ message: "No fields to update" });
  }
  const { setClauses, values } = update;
  const { rows } = await pool.query(
    `UPDATE facility_units SET ${setClauses.join(", ")}, updated_at = now()
     WHERE id = $${values.length + 1}
     RETURNING id, facility_id, label, building, floor, unit, room, created_at, updated_at`,
    [...values, id]
  );
  await audit(req.user.id, "unit.updated", "unit", id, null);
  res.json(rows[0]);
}));

app.get("/users", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const facilityId = req.query.facility_id || req.user.facility_id;
  const { rows } = await pool.query(
    `SELECT id, facility_id, email, full_name, role, status, created_at, updated_at
     FROM users WHERE facility_id = $1 ORDER BY created_at DESC`,
    [facilityId]
  );
  res.json(rows.map((row) => serializeUser(row)));
}));

app.post("/users", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const { facility_id, email, full_name, role, status, password } = req.body || {};
  const normalizedEmail = normalizeString(email).toLowerCase();
  const normalizedName = normalizeString(full_name);
  const normalizedRole = normalizeString(role).toLowerCase();
  const normalizedStatus = normalizeUserStatus(normalizeString(status).toLowerCase() || "active");
  if (!facility_id || !normalizedEmail || !normalizedName || !normalizedRole || !password) {
    return res.status(400).json({ message: "facility_id, email, full_name, role, password required" });
  }
  if (!allowedUserRoles.has(normalizedRole)) {
    return res.status(400).json({ message: "Invalid role" });
  }
  if (!allowedUserStatuses.has(normalizedStatus)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  if (normalizeString(password).length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  const { rows: existingRows } = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    [normalizedEmail]
  );
  if (existingRows.length) {
    return res.status(409).json({ message: "Email already exists" });
  }
  const { salt, hash } = createPasswordHash(password);
  const { rows } = await pool.query(
    `INSERT INTO users (facility_id, email, full_name, role, status, password_salt, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, facility_id, email, full_name, role, status, created_at, updated_at`,
    [facility_id, normalizedEmail, normalizedName, normalizedRole, normalizedStatus, salt, hash]
  );
  await audit(req.user.id, "user.created", "user", rows[0].id, { email });
  res.status(201).json(serializeUser(rows[0]));
}));

app.patch("/users/:id", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { full_name, role, status, password } = req.body || {};
  const updateFields = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "full_name")) {
    const normalizedName = normalizeString(full_name);
    if (!normalizedName) {
      return res.status(400).json({ message: "Full name is required" });
    }
    updateFields.full_name = normalizedName;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "role")) {
    const normalizedRole = normalizeString(role).toLowerCase();
    if (!allowedUserRoles.has(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    updateFields.role = normalizedRole;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
    const normalizedStatus = normalizeUserStatus(normalizeString(status).toLowerCase());
    if (!allowedUserStatuses.has(normalizedStatus)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    updateFields.status = normalizedStatus;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "password") && password) {
    if (normalizeString(password).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
  }
  const update = buildUpdate(updateFields);

  if (!update && !password) {
    return res.status(400).json({ message: "No fields to update" });
  }

  if (update) {
    const { setClauses, values } = update;
    const { rows } = await pool.query(
      `UPDATE users SET ${setClauses.join(", ")}, updated_at = now()
       WHERE id = $${values.length + 1}
       RETURNING id, facility_id, email, full_name, role, status, created_at, updated_at`,
      [...values, id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: "User not found" });
    }
    if (password) {
      const { salt, hash } = createPasswordHash(password);
      await pool.query(
        `UPDATE users SET password_salt = $1, password_hash = $2 WHERE id = $3`,
        [salt, hash, id]
      );
    }
    await audit(req.user.id, "user.updated", "user", id, null);
    return res.json(serializeUser(rows[0]));
  }

  const { salt, hash } = createPasswordHash(password);
  await pool.query(
    `UPDATE users SET password_salt = $1, password_hash = $2, updated_at = now() WHERE id = $3`,
    [salt, hash, id]
  );
  await audit(req.user.id, "user.password_reset", "user", id, null);
  const { rows } = await pool.query(
    `SELECT id, facility_id, email, full_name, role, status, created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );
  res.json(serializeUser(rows[0]));
}));

app.get("/residents", authMiddleware, asyncHandler(async (req, res) => {
  const facilityId = req.query.facility_id || req.user.facility_id;
  if (facilityId !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { rows } = await pool.query(
    `SELECT id, facility_id, external_id, first_name, last_name, dob, sex, notes,
            building, floor, unit, room, unit_id,
            created_at, updated_at
     FROM residents WHERE facility_id = $1 ORDER BY created_at DESC`,
    [facilityId]
  );
  res.json(rows);
}));

app.post("/residents", authMiddleware, asyncHandler(async (req, res) => {
  const {
    facility_id,
    external_id,
    first_name,
    last_name,
    dob,
    sex,
    notes,
    building,
    floor,
    unit,
    room,
    unit_id,
  } = req.body || {};
  const facilityId = facility_id || req.user.facility_id;
  if (facilityId !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const normalizedFirst = normalizeString(first_name);
  const normalizedLast = normalizeString(last_name);
  const normalizedDob = normalizeString(dob);
  if (!normalizedFirst || !normalizedLast || !normalizedDob) {
    return res.status(400).json({ message: "first_name, last_name, dob required" });
  }
  const dobDate = parseDateOnly(normalizedDob);
  if (!dobDate || isFutureDate(dobDate)) {
    return res.status(400).json({ message: "Invalid date of birth" });
  }
  let normalizedSex = normalizeString(sex).toUpperCase();
  if (!normalizedSex) {
    normalizedSex = null;
  }
  if (normalizedSex && !allowedSexValues.has(normalizedSex)) {
    return res.status(400).json({ message: "Invalid sex value" });
  }
  const normalizedExternal = toNullableString(external_id);
  const normalizedNotes = toNullableString(notes);
  const normalizedBuilding = toNullableString(building);
  const normalizedFloor = toNullableString(floor);
  const normalizedUnit = toNullableString(unit);
  const normalizedRoom = toNullableString(room);
  let normalizedUnitId = null;
  if (unit_id !== undefined && unit_id !== null && unit_id !== "") {
    const candidateUnit = normalizeString(unit_id);
    if (!isUuid(candidateUnit)) {
      return res.status(400).json({ message: "Invalid unit_id" });
    }
    const { rows: unitRows } = await pool.query(
      `SELECT id, facility_id FROM facility_units WHERE id = $1`,
      [candidateUnit]
    );
    if (!unitRows[0] || unitRows[0].facility_id !== facilityId) {
      return res.status(400).json({ message: "Unit not found for facility" });
    }
    normalizedUnitId = candidateUnit;
  }
  const { rows } = await pool.query(
    `INSERT INTO residents (
       facility_id, external_id, first_name, last_name, dob, sex, notes,
       building, floor, unit, room, unit_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, facility_id, external_id, first_name, last_name, dob, sex, notes,
               building, floor, unit, room, unit_id,
               created_at, updated_at`,
    [
      facilityId,
      normalizedExternal,
      normalizedFirst,
      normalizedLast,
      normalizedDob,
      normalizedSex,
      normalizedNotes,
      normalizedBuilding,
      normalizedFloor,
      normalizedUnit,
      normalizedRoom,
      normalizedUnitId,
    ]
  );
  await audit(req.user.id, "resident.created", "resident", rows[0].id, null);
  res.status(201).json(rows[0]);
}));

app.get("/residents/:id", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT id, facility_id, external_id, first_name, last_name, dob, sex, notes,
            building, floor, unit, room, unit_id,
            created_at, updated_at
     FROM residents WHERE id = $1`,
    [id]
  );
  const resident = rows[0];
  if (!resident) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (resident.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  res.json(resident);
}));

app.patch("/residents/:id", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: residentRows } = await pool.query(
    `SELECT facility_id FROM residents WHERE id = $1`,
    [id]
  );
  if (!residentRows[0]) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (residentRows[0].facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const updateFields = {};
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, "first_name")) {
    const normalizedFirst = normalizeString(body.first_name);
    if (!normalizedFirst) {
      return res.status(400).json({ message: "first_name is required" });
    }
    updateFields.first_name = normalizedFirst;
  }
  if (Object.prototype.hasOwnProperty.call(body, "last_name")) {
    const normalizedLast = normalizeString(body.last_name);
    if (!normalizedLast) {
      return res.status(400).json({ message: "last_name is required" });
    }
    updateFields.last_name = normalizedLast;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dob")) {
    const normalizedDob = normalizeString(body.dob);
    const dobDate = parseDateOnly(normalizedDob);
    if (!normalizedDob || !dobDate || isFutureDate(dobDate)) {
      return res.status(400).json({ message: "Invalid date of birth" });
    }
    updateFields.dob = normalizedDob;
  }
  if (Object.prototype.hasOwnProperty.call(body, "sex")) {
    let normalizedSex = normalizeString(body.sex).toUpperCase();
    if (!normalizedSex) {
      normalizedSex = null;
    }
    if (normalizedSex && !allowedSexValues.has(normalizedSex)) {
      return res.status(400).json({ message: "Invalid sex value" });
    }
    updateFields.sex = normalizedSex;
  }
  if (Object.prototype.hasOwnProperty.call(body, "external_id")) {
    updateFields.external_id = toNullableString(body.external_id);
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    updateFields.notes = toNullableString(body.notes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "building")) {
    updateFields.building = toNullableString(body.building);
  }
  if (Object.prototype.hasOwnProperty.call(body, "floor")) {
    updateFields.floor = toNullableString(body.floor);
  }
  if (Object.prototype.hasOwnProperty.call(body, "unit")) {
    updateFields.unit = toNullableString(body.unit);
  }
  if (Object.prototype.hasOwnProperty.call(body, "room")) {
    updateFields.room = toNullableString(body.room);
  }
  if (Object.prototype.hasOwnProperty.call(body, "unit_id")) {
    const candidateUnit = normalizeString(body.unit_id);
    if (!candidateUnit) {
      updateFields.unit_id = null;
    } else {
      if (!isUuid(candidateUnit)) {
        return res.status(400).json({ message: "Invalid unit_id" });
      }
      const { rows: unitRows } = await pool.query(
        `SELECT id, facility_id FROM facility_units WHERE id = $1`,
        [candidateUnit]
      );
      if (!unitRows[0] || unitRows[0].facility_id !== residentRows[0].facility_id) {
        return res.status(400).json({ message: "Unit not found for facility" });
      }
      updateFields.unit_id = candidateUnit;
    }
  }
  const update = buildUpdate(updateFields);

  if (!update) {
    return res.status(400).json({ message: "No fields to update" });
  }

  const { setClauses, values } = update;
  const { rows } = await pool.query(
    `UPDATE residents SET ${setClauses.join(", ")}, updated_at = now()
     WHERE id = $${values.length + 1}
     RETURNING id, facility_id, external_id, first_name, last_name, dob, sex, notes,
               building, floor, unit, room, unit_id,
               created_at, updated_at`,
    [...values, id]
  );
  await audit(req.user.id, "resident.updated", "resident", id, null);
  res.json(rows[0]);
}));

app.post("/residents/:id/assessments", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { assessment_date, assistive_device, scheduled_date, due_date } = req.body || {};
  const normalizedDate = normalizeString(assessment_date);
  if (!normalizedDate) {
    return res.status(400).json({ message: "assessment_date is required" });
  }
  const assessmentDate = parseDateOnly(normalizedDate);
  if (!assessmentDate) {
    return res.status(400).json({ message: "Invalid assessment date" });
  }
  const normalizedScheduled = normalizeString(scheduled_date);
  const scheduledDate = normalizedScheduled ? parseDateOnly(normalizedScheduled) : null;
  if (normalizedScheduled && !scheduledDate) {
    return res.status(400).json({ message: "Invalid scheduled date" });
  }
  const normalizedDue = normalizeString(due_date);
  const dueDate = normalizedDue ? parseDateOnly(normalizedDue) : null;
  if (normalizedDue && !dueDate) {
    return res.status(400).json({ message: "Invalid due date" });
  }
  const scheduledForCompare = scheduledDate || assessmentDate;
  const dueForCompare = dueDate || scheduledForCompare;
  if (dueForCompare && scheduledForCompare && dueForCompare < scheduledForCompare) {
    return res.status(400).json({ message: "Due date cannot be before scheduled date" });
  }
  const { rows: residentRows } = await pool.query(
    `SELECT r.facility_id, f.assessment_protocol, f.capture_method, f.role_policy
     FROM residents r
     JOIN facilities f ON f.id = r.facility_id
     WHERE r.id = $1`,
    [id]
  );
  const resident = residentRows[0];
  if (!resident) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (resident.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(resident.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const normalizedDevice = toNullableString(assistive_device);
  const scheduledValue = normalizedScheduled || normalizedDate;
  const dueValue = normalizedDue || scheduledValue;
  const assessmentProtocol = resident.assessment_protocol || "tug_chair_balance";
  const captureMethod = resident.capture_method || "record_upload";
  const { rows } = await pool.query(
    `INSERT INTO assessments (
       resident_id, created_by, status, assessment_date, assistive_device, scheduled_date, due_date,
       assessment_protocol, capture_method
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, resident_id, created_by, status, assessment_date, assistive_device, scheduled_date, due_date,
              reassessment_due_date, completed_at, risk_tier, clinician_notes, assigned_to, assigned_at,
              assessment_protocol, capture_method, created_at, updated_at`,
    [id, req.user.id, "needs_review", normalizedDate, normalizedDevice, scheduledValue, dueValue, assessmentProtocol, captureMethod]
  );
  await audit(req.user.id, "assessment.created", "assessment", rows[0].id, null);
  res.status(201).json(rows[0]);
}));

app.get("/residents/:id/assessments", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: residentRows } = await pool.query(
    `SELECT facility_id FROM residents WHERE id = $1`,
    [id]
  );
  if (!residentRows[0]) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (residentRows[0].facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.resident_id, a.created_by, a.status, a.assessment_date, a.assistive_device, a.scheduled_date, a.due_date,
            a.reassessment_due_date, a.completed_at, a.risk_tier, a.clinician_notes, a.assigned_to, a.assigned_at,
            a.assessment_protocol, a.capture_method,
            a.pt_cpt_codes, a.pt_goals, a.pt_plan_of_care, a.pt_pain_score,
            a.pt_session_minutes, a.pt_time_saved_minutes,
            a.created_at, a.updated_at,
            COUNT(v.id)::int AS video_count,
            MAX(v.created_at) AS latest_video_at,
            COALESCE(BOOL_OR(s.assessment_id IS NOT NULL), false) AS has_scores
     FROM assessments a
     LEFT JOIN videos v ON v.assessment_id = a.id
     LEFT JOIN assessment_scores s ON s.assessment_id = a.id
     WHERE a.resident_id = $1
     GROUP BY a.id, a.resident_id, a.created_by, a.status, a.assessment_date, a.assistive_device, a.scheduled_date,
              a.due_date, a.reassessment_due_date, a.completed_at, a.risk_tier, a.clinician_notes, a.assigned_to,
              a.assigned_at, a.assessment_protocol, a.capture_method,
              a.pt_cpt_codes, a.pt_goals, a.pt_plan_of_care, a.pt_pain_score,
              a.pt_session_minutes, a.pt_time_saved_minutes,
              a.created_at, a.updated_at
     ORDER BY a.assessment_date DESC`,
    [id]
  );
  res.json(rows);
}));

app.get("/residents/:id/fall-events", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: residentRows } = await pool.query(
    `SELECT r.facility_id, f.role_policy
     FROM residents r
     JOIN facilities f ON f.id = r.facility_id
     WHERE r.id = $1`,
    [id]
  );
  const resident = residentRows[0];
  if (!resident) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (resident.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(resident.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }
  const { rows } = await pool.query(
    `SELECT fe.id, fe.facility_id, fe.resident_id, fe.occurred_at, fe.building, fe.floor, fe.unit, fe.room,
            fe.witness, fe.injury_severity, fe.ems_called, fe.hospital_transfer, fe.assistive_device,
            fe.contributing_factors, fe.notes, fe.created_by, fe.created_at, fe.updated_at,
            COALESCE(jsonb_array_length(f.fall_checklist), 0) AS fall_checks_required,
            COALESCE(done.completed_count, 0) AS fall_checks_completed,
            last_assessment.assessment_date AS last_assessment_date,
            last_assessment.risk_tier AS last_risk_tier
     FROM fall_events fe
     JOIN facilities f ON f.id = fe.facility_id
     LEFT JOIN (
       SELECT fall_event_id, COUNT(DISTINCT check_type) AS completed_count
       FROM post_fall_checks
       WHERE status = 'completed'
       GROUP BY fall_event_id
     ) done ON done.fall_event_id = fe.id
     LEFT JOIN LATERAL (
       SELECT assessment_date, risk_tier
       FROM assessments
       WHERE resident_id = fe.resident_id
       ORDER BY assessment_date DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) AS last_assessment ON TRUE
     WHERE fe.resident_id = $1
     ORDER BY fe.occurred_at DESC, fe.created_at DESC`,
    [id]
  );
  res.json(rows);
}));

app.post("/residents/:id/fall-events", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    occurred_at,
    building,
    floor,
    unit,
    room,
    injury_severity,
    ems_called,
    hospital_transfer,
    witness,
    assistive_device,
    contributing_factors,
    notes,
  } = req.body || {};
  const { rows: residentRows } = await pool.query(
    `SELECT r.facility_id, r.building, r.floor, r.unit, r.room, f.role_policy
     FROM residents r
     JOIN facilities f ON f.id = r.facility_id
     WHERE r.id = $1`,
    [id]
  );
  const resident = residentRows[0];
  if (!resident) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (resident.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(resident.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }
  const occurredAt = parseDateTime(occurred_at);
  if (!occurredAt) {
    return res.status(400).json({ message: "Invalid occurred_at" });
  }
  const severity = parseOptionalEnum(injury_severity, allowedInjurySeverities);
  if (severity.error) {
    return res.status(400).json({ message: "Invalid injury severity" });
  }
  const parsedEms = parseOptionalBoolean(ems_called);
  if (parsedEms.error) {
    return res.status(400).json({ message: "Invalid EMS called flag" });
  }
  const parsedHospital = parseOptionalBoolean(hospital_transfer);
  if (parsedHospital.error) {
    return res.status(400).json({ message: "Invalid hospital transfer flag" });
  }
  const factors = normalizeChecklist(contributing_factors);
  if (factors.error) {
    return res.status(400).json({ message: "Invalid contributing factors" });
  }

  const normalizedBuilding = toNullableString(building) ?? resident.building ?? null;
  const normalizedFloor = toNullableString(floor) ?? resident.floor ?? null;
  const normalizedUnit = toNullableString(unit) ?? resident.unit ?? null;
  const normalizedRoom = toNullableString(room) ?? resident.room ?? null;
  const normalizedWitness = toNullableString(witness);
  const normalizedDevice = toNullableString(assistive_device);
  const normalizedNotes = toNullableString(notes);
  const normalizedSeverity = severity.value || "none";
  const emsCalled = parsedEms.value ?? false;
  const hospitalTransfer = parsedHospital.value ?? false;
  const normalizedFactors = factors.value ?? [];
  const serializedFactors = JSON.stringify(normalizedFactors);

  const { rows } = await pool.query(
    `WITH inserted AS (
       INSERT INTO fall_events (
         facility_id, resident_id, occurred_at,
         building, floor, unit, room,
         witness, injury_severity, ems_called, hospital_transfer,
         assistive_device, contributing_factors, notes, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *
     )
     SELECT inserted.id, inserted.facility_id, inserted.resident_id, inserted.occurred_at,
            inserted.building, inserted.floor, inserted.unit, inserted.room,
            inserted.witness, inserted.injury_severity, inserted.ems_called, inserted.hospital_transfer,
            inserted.assistive_device, inserted.contributing_factors, inserted.notes, inserted.created_by,
            inserted.created_at, inserted.updated_at,
            COALESCE(jsonb_array_length(f.fall_checklist), 0) AS fall_checks_required,
            COALESCE(done.completed_count, 0) AS fall_checks_completed,
            last_assessment.assessment_date AS last_assessment_date,
            last_assessment.risk_tier AS last_risk_tier
     FROM inserted
     JOIN facilities f ON f.id = inserted.facility_id
     LEFT JOIN (
       SELECT fall_event_id, COUNT(DISTINCT check_type) AS completed_count
       FROM post_fall_checks
       WHERE status = 'completed'
       GROUP BY fall_event_id
     ) done ON done.fall_event_id = inserted.id
     LEFT JOIN LATERAL (
       SELECT assessment_date, risk_tier
       FROM assessments
       WHERE resident_id = inserted.resident_id
       ORDER BY assessment_date DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) AS last_assessment ON TRUE`,
    [
      resident.facility_id,
      id,
      occurredAt,
      normalizedBuilding,
      normalizedFloor,
      normalizedUnit,
      normalizedRoom,
      normalizedWitness,
      normalizedSeverity,
      emsCalled,
      hospitalTransfer,
      normalizedDevice,
      serializedFactors,
      normalizedNotes,
      req.user.id,
    ]
  );
  await audit(req.user.id, "fall_event.created", "fall_event", rows[0].id, { resident_id: id });
  res.status(201).json(rows[0]);
}));

app.get("/fall-events/:id/checks", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: eventRows } = await pool.query(
    `SELECT fe.id, fe.facility_id, f.role_policy
     FROM fall_events fe
     JOIN facilities f ON f.id = fe.facility_id
     WHERE fe.id = $1`,
    [id]
  );
  const fallEvent = eventRows[0];
  if (!fallEvent) {
    return res.status(404).json({ message: "Fall event not found" });
  }
  if (fallEvent.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(fallEvent.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }
  const { rows } = await pool.query(
    `SELECT id, fall_event_id, check_type, status, completed_at, completed_by, notes, created_at, updated_at
     FROM post_fall_checks
     WHERE fall_event_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  res.json(rows);
}));

app.post("/fall-events/:id/checks", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { check_type, completed } = req.body || {};
  const normalizedCheck = normalizeString(check_type);
  if (!normalizedCheck) {
    return res.status(400).json({ message: "check_type is required" });
  }
  const parsedCompleted = parseOptionalBoolean(completed);
  if (parsedCompleted.error || typeof parsedCompleted.value !== "boolean") {
    return res.status(400).json({ message: "Invalid completed flag" });
  }
  const { rows: eventRows } = await pool.query(
    `SELECT fe.id, fe.facility_id, f.role_policy
     FROM fall_events fe
     JOIN facilities f ON f.id = fe.facility_id
     WHERE fe.id = $1`,
    [id]
  );
  const fallEvent = eventRows[0];
  if (!fallEvent) {
    return res.status(404).json({ message: "Fall event not found" });
  }
  if (fallEvent.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(fallEvent.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const status = parsedCompleted.value ? "completed" : "pending";
  const completedAt = parsedCompleted.value ? new Date() : null;
  const completedBy = parsedCompleted.value ? req.user.id : null;

  const { rows } = await pool.query(
    `INSERT INTO post_fall_checks (
       fall_event_id, check_type, status, completed_at, completed_by
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (fall_event_id, check_type) DO UPDATE SET
       status = EXCLUDED.status,
       completed_at = EXCLUDED.completed_at,
       completed_by = EXCLUDED.completed_by,
       updated_at = now()
     RETURNING id, fall_event_id, check_type, status, completed_at, completed_by, notes, created_at, updated_at`,
    [id, normalizedCheck, status, completedAt, completedBy]
  );
  await audit(req.user.id, "fall_check.updated", "fall_event", id, {
    check_type: normalizedCheck,
    status,
  });
  res.json(rows[0]);
}));

app.get("/assessments/:id", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT a.id, a.resident_id, a.created_by, a.status, a.assessment_date, a.assistive_device,
            a.scheduled_date, a.due_date, a.reassessment_due_date, a.completed_at,
            a.risk_tier, a.clinician_notes, a.assigned_to, a.assigned_at,
            a.pt_cpt_codes, a.pt_goals, a.pt_plan_of_care, a.pt_pain_score,
            a.pt_session_minutes, a.pt_time_saved_minutes,
            a.created_at, a.updated_at,
            a.assessment_protocol, a.capture_method,
            r.facility_id, f.assessment_protocol AS facility_assessment_protocol, f.capture_method AS facility_capture_method
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [id]
  );
  const assessment = rows[0];
  if (!assessment) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessment.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  let { rows: scoreRows } = await pool.query(
    `SELECT tug_seconds, chair_stand_seconds, balance_side_by_side, balance_semi_tandem, balance_tandem, score_notes
     FROM assessment_scores WHERE assessment_id = $1`,
    [id]
  );

  const { rows: videoRows } = await pool.query(
    `SELECT id, assessment_id, storage_key, content_type, duration_seconds, width, height, checksum, uploaded_by, created_at
     FROM videos WHERE assessment_id = $1 ORDER BY created_at DESC`,
    [id]
  );

  const { rows: reportRows } = await pool.query(
    `SELECT id, assessment_id, pdf_storage_key, created_by, created_at,
            template_version, generated_at, generated_by, finalized, report_type
     FROM reports
     WHERE assessment_id = $1 AND report_type = 'assessment'
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );

  const { rows: ptSummaryRows } = await pool.query(
    `SELECT id, assessment_id, pdf_storage_key, created_by, created_at,
            template_version, generated_at, generated_by, finalized, report_type
     FROM reports
     WHERE assessment_id = $1 AND report_type = 'pt_summary'
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );

  const { rows: reportHistoryRows } = await pool.query(
    `SELECT id, assessment_id, pdf_storage_key, created_by, created_at,
            template_version, generated_at, generated_by, finalized, report_type
     FROM reports
     WHERE assessment_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [id]
  );

  const { rows: modelRows } = await pool.query(
    `SELECT id, status, model_version, tug_seconds, chair_stand_seconds,
            balance_side_by_side, balance_semi_tandem, balance_tandem,
            confidence, notes, created_at, updated_at
     FROM gait_model_runs
     WHERE assessment_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );

  if (!scoreRows[0] && modelRows[0]?.status === "completed") {
    await upsertModelScores({
      assessmentId: id,
      protocol: assessment.assessment_protocol,
      model: modelRows[0],
    });
    const refreshedScores = await pool.query(
      `SELECT tug_seconds, chair_stand_seconds, balance_side_by_side, balance_semi_tandem, balance_tandem, score_notes
       FROM assessment_scores WHERE assessment_id = $1`,
      [id]
    );
    scoreRows = refreshedScores.rows;
  }

  res.json({
    id: assessment.id,
    resident_id: assessment.resident_id,
    created_by: assessment.created_by,
    status: assessment.status,
    assessment_date: assessment.assessment_date,
    assistive_device: assessment.assistive_device,
    scheduled_date: assessment.scheduled_date,
    due_date: assessment.due_date,
    reassessment_due_date: assessment.reassessment_due_date,
    completed_at: assessment.completed_at,
    risk_tier: assessment.risk_tier,
    clinician_notes: assessment.clinician_notes,
    assigned_to: assessment.assigned_to,
    assigned_at: assessment.assigned_at,
    pt_cpt_codes: assessment.pt_cpt_codes,
    pt_goals: assessment.pt_goals,
    pt_plan_of_care: assessment.pt_plan_of_care,
    pt_pain_score: assessment.pt_pain_score,
    pt_session_minutes: assessment.pt_session_minutes,
    pt_time_saved_minutes: assessment.pt_time_saved_minutes,
    assessment_protocol: assessment.assessment_protocol || assessment.facility_assessment_protocol,
    capture_method: assessment.capture_method || assessment.facility_capture_method,
    created_at: assessment.created_at,
    updated_at: assessment.updated_at,
    scores: scoreRows[0] || null,
    videos: videoRows,
    report: reportRows[0] || null,
    pt_summary: ptSummaryRows[0] || null,
    report_history: reportHistoryRows || [],
    model_run: modelRows[0] || null,
  });
}));

app.patch("/assessments/:id", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const { scores } = body;
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, a.status, a.assessment_date, a.scheduled_date, a.due_date, a.reassessment_due_date, a.completed_at,
            a.assessment_protocol, a.capture_method,
            r.facility_id, f.reassessment_cadence_days, f.assessment_protocol AS facility_assessment_protocol, f.role_policy
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [id]
  );
  if (!assessmentRows[0]) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  const currentAssessment = assessmentRows[0];
  if (currentAssessment.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(currentAssessment.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const updateFields = {};
  let nextAssessmentDate = currentAssessment.assessment_date;
  let nextScheduledDate = currentAssessment.scheduled_date;
  let nextDueDate = currentAssessment.due_date;
  if (Object.prototype.hasOwnProperty.call(body, "assessment_date")) {
    const normalizedDate = normalizeString(body.assessment_date);
    if (!normalizedDate) {
      return res.status(400).json({ message: "assessment_date is required" });
    }
    const assessmentDate = parseDateOnly(normalizedDate);
    if (!assessmentDate) {
      return res.status(400).json({ message: "Invalid assessment date" });
    }
    updateFields.assessment_date = normalizedDate;
    nextAssessmentDate = normalizedDate;
  }
  if (Object.prototype.hasOwnProperty.call(body, "scheduled_date")) {
    const normalizedScheduled = normalizeString(body.scheduled_date);
    if (!normalizedScheduled) {
      updateFields.scheduled_date = null;
      nextScheduledDate = null;
    } else {
      const scheduledDate = parseDateOnly(normalizedScheduled);
      if (!scheduledDate) {
        return res.status(400).json({ message: "Invalid scheduled date" });
      }
      updateFields.scheduled_date = normalizedScheduled;
      nextScheduledDate = normalizedScheduled;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "due_date")) {
    const normalizedDue = normalizeString(body.due_date);
    if (!normalizedDue) {
      updateFields.due_date = null;
      nextDueDate = null;
    } else {
      const dueDate = parseDateOnly(normalizedDue);
      if (!dueDate) {
        return res.status(400).json({ message: "Invalid due date" });
      }
      updateFields.due_date = normalizedDue;
      nextDueDate = normalizedDue;
    }
  } else if (Object.prototype.hasOwnProperty.call(body, "scheduled_date")) {
    if (nextScheduledDate) {
      updateFields.due_date = nextScheduledDate;
      nextDueDate = nextScheduledDate;
    }
  }

  const scheduledForCompare = nextScheduledDate || nextAssessmentDate;
  if (nextDueDate && scheduledForCompare) {
    const dueCompare = parseDateOnly(nextDueDate);
    const scheduledCompare = parseDateOnly(scheduledForCompare);
    if (dueCompare && scheduledCompare && dueCompare < scheduledCompare) {
      return res.status(400).json({ message: "Due date cannot be before scheduled date" });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const normalizedStatus = normalizeString(body.status).toLowerCase();
    if (!normalizedStatus || !allowedAssessmentStatuses.has(normalizedStatus)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (!canTransitionAssessmentStatus(currentAssessment.status, normalizedStatus, req.user.role)) {
      return res.status(403).json({ message: "Status transition not allowed" });
    }
    updateFields.status = normalizedStatus;
  }
  if (Object.prototype.hasOwnProperty.call(body, "assistive_device")) {
    updateFields.assistive_device = toNullableString(body.assistive_device);
  }
  if (Object.prototype.hasOwnProperty.call(body, "risk_tier")) {
    const normalizedRisk = normalizeString(body.risk_tier).toLowerCase();
    if (!normalizedRisk) {
      updateFields.risk_tier = null;
    } else if (!allowedRiskTiers.has(normalizedRisk)) {
      return res.status(400).json({ message: "Invalid risk_tier" });
    } else {
      updateFields.risk_tier = normalizedRisk;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "clinician_notes")) {
    updateFields.clinician_notes = toNullableString(body.clinician_notes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "pt_cpt_codes")) {
    updateFields.pt_cpt_codes = toNullableString(body.pt_cpt_codes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "pt_goals")) {
    updateFields.pt_goals = toNullableString(body.pt_goals);
  }
  if (Object.prototype.hasOwnProperty.call(body, "pt_plan_of_care")) {
    updateFields.pt_plan_of_care = toNullableString(body.pt_plan_of_care);
  }
  if (Object.prototype.hasOwnProperty.call(body, "pt_pain_score")) {
    const parsed = parseOptionalNumber(body.pt_pain_score);
    if (parsed.error) {
      return res.status(400).json({ message: "Invalid pt_pain_score" });
    }
    if (parsed.value !== null && (!Number.isInteger(parsed.value) || parsed.value < 0 || parsed.value > 10)) {
      return res.status(400).json({ message: "pt_pain_score must be 0-10" });
    }
    updateFields.pt_pain_score = parsed.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "pt_session_minutes")) {
    const parsed = parseOptionalNumber(body.pt_session_minutes);
    if (parsed.error) {
      return res.status(400).json({ message: "Invalid pt_session_minutes" });
    }
    if (parsed.value !== null && (!Number.isInteger(parsed.value) || parsed.value < 0 || parsed.value > 240)) {
      return res.status(400).json({ message: "pt_session_minutes must be 0-240" });
    }
    updateFields.pt_session_minutes = parsed.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "pt_time_saved_minutes")) {
    const parsed = parseOptionalNumber(body.pt_time_saved_minutes);
    if (parsed.error) {
      return res.status(400).json({ message: "Invalid pt_time_saved_minutes" });
    }
    if (parsed.value !== null && (!Number.isInteger(parsed.value) || parsed.value < 0 || parsed.value > 240)) {
      return res.status(400).json({ message: "pt_time_saved_minutes must be 0-240" });
    }
    updateFields.pt_time_saved_minutes = parsed.value;
  }

  const nextStatus = updateFields.status || currentAssessment.status;
  if (nextStatus === "completed" && !currentAssessment.completed_at) {
    updateFields.completed_at = new Date().toISOString();
  }
  if (nextStatus === "completed" && !currentAssessment.reassessment_due_date) {
    const cadenceDays = Number.parseInt(currentAssessment.reassessment_cadence_days || "90", 10);
    const baseDate = parseDateOnly(nextAssessmentDate);
    if (baseDate && Number.isFinite(cadenceDays) && cadenceDays > 0) {
      const due = new Date(baseDate);
      due.setDate(due.getDate() + cadenceDays);
      updateFields.reassessment_due_date = formatDateOnly(due);
    }
  }

  const update = buildUpdate(updateFields);
  if (update) {
    const { setClauses, values } = update;
    await pool.query(
      `UPDATE assessments SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
  }

  if (scores) {
    if (typeof scores !== "object") {
      return res.status(400).json({ message: "Invalid scores payload" });
    }
    const {
      tug_seconds,
      chair_stand_seconds,
      balance_side_by_side,
      balance_semi_tandem,
      balance_tandem,
      score_notes,
    } = scores;
    const parsedTug = parseOptionalNumber(tug_seconds);
    const parsedChair = parseOptionalNumber(chair_stand_seconds);
    const parsedSide = parseOptionalBoolean(balance_side_by_side);
    const parsedSemi = parseOptionalBoolean(balance_semi_tandem);
    const parsedTandem = parseOptionalBoolean(balance_tandem);
    if (parsedTug.error || parsedChair.error || parsedSide.error || parsedSemi.error || parsedTandem.error) {
      return res.status(400).json({ message: "Invalid score values" });
    }
    const protocol = currentAssessment.assessment_protocol || currentAssessment.facility_assessment_protocol || "tug_chair_balance";
    const missing = [];
    const requireNumber = (value, label) => {
      if (value === null || value === undefined) {
        missing.push(label);
      }
    };
    const requireBool = (value, label) => {
      if (value === null || value === undefined) {
        missing.push(label);
      }
    };
    if (protocol === "tug_chair_balance") {
      requireNumber(parsedTug.value, "tug_seconds");
      requireNumber(parsedChair.value, "chair_stand_seconds");
      requireBool(parsedSide.value, "balance_side_by_side");
      requireBool(parsedSemi.value, "balance_semi_tandem");
      requireBool(parsedTandem.value, "balance_tandem");
    } else if (protocol === "tug_only") {
      requireNumber(parsedTug.value, "tug_seconds");
    } else if (protocol === "balance_only") {
      requireBool(parsedSide.value, "balance_side_by_side");
      requireBool(parsedSemi.value, "balance_semi_tandem");
      requireBool(parsedTandem.value, "balance_tandem");
    }
    if (missing.length) {
      return res.status(400).json({ message: `Missing required score fields: ${missing.join(", ")}` });
    }
    const inRange = (value) => value === null || (value >= 0 && value <= 300);
    if (!inRange(parsedTug.value) || !inRange(parsedChair.value)) {
      return res.status(400).json({ message: "Score values must be between 0 and 300" });
    }
    await pool.query(
      `INSERT INTO assessment_scores (
        assessment_id, tug_seconds, chair_stand_seconds, balance_side_by_side,
        balance_semi_tandem, balance_tandem, score_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (assessment_id) DO UPDATE SET
        tug_seconds = EXCLUDED.tug_seconds,
        chair_stand_seconds = EXCLUDED.chair_stand_seconds,
        balance_side_by_side = EXCLUDED.balance_side_by_side,
        balance_semi_tandem = EXCLUDED.balance_semi_tandem,
        balance_tandem = EXCLUDED.balance_tandem,
        score_notes = EXCLUDED.score_notes`,
      [
        id,
        parsedTug.value,
        parsedChair.value,
        parsedSide.value,
        parsedSemi.value,
        parsedTandem.value,
        toNullableString(score_notes),
      ]
    );
  }

  await audit(req.user.id, "assessment.updated", "assessment", id, null);

  const { rows } = await pool.query(
    `SELECT id, resident_id, created_by, status, assessment_date, assistive_device,
            scheduled_date, due_date, reassessment_due_date, completed_at,
            risk_tier, clinician_notes, assigned_to, assigned_at,
            pt_cpt_codes, pt_goals, pt_plan_of_care, pt_pain_score,
            pt_session_minutes, pt_time_saved_minutes,
            created_at, updated_at
     FROM assessments WHERE id = $1`,
    [id]
  );
  res.json(rows[0]);
}));

app.get("/qa", authMiddleware, asyncHandler(async (req, res) => {
  const residentId = normalizeString(req.query.resident_id);
  if (!residentId) {
    return res.status(400).json({ message: "resident_id is required" });
  }
  const { rows: residentRows } = await pool.query(
    `SELECT r.facility_id, f.role_policy, f.qa_checklist
     FROM residents r
     JOIN facilities f ON f.id = r.facility_id
     WHERE r.id = $1`,
    [residentId]
  );
  const resident = residentRows[0];
  if (!resident) {
    return res.status(404).json({ message: "Resident not found" });
  }
  if (resident.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(resident.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const { rows } = await pool.query(
    `SELECT q.assessment_id, q.checks, q.notes, q.escalated, q.updated_at
     FROM assessment_qa q
     JOIN assessments a ON a.id = q.assessment_id
     WHERE a.resident_id = $1
     ORDER BY q.updated_at DESC`,
    [residentId]
  );
  const response = rows.map((row) => ({
    ...row,
    completed: isQaComplete(resident.qa_checklist, row.checks, row.escalated),
  }));
  res.json(response);
}));

app.put("/assessments/:id/qa", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, r.facility_id, f.role_policy, f.qa_checklist
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [id]
  );
  const assessment = assessmentRows[0];
  if (!assessment) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessment.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessment.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const { rows: existingRows } = await pool.query(
    `SELECT checks, notes, escalated FROM assessment_qa WHERE assessment_id = $1`,
    [id]
  );
  const existing = existingRows[0];
  const hasChecks = Object.prototype.hasOwnProperty.call(req.body || {}, "checks");
  const checks = hasChecks ? normalizeQaChecks(req.body?.checks) : null;
  if (hasChecks && !checks) {
    return res.status(400).json({ message: "Invalid QA checks" });
  }
  const parsedEscalated = parseOptionalBoolean(req.body?.escalated);
  if (parsedEscalated.error) {
    return res.status(400).json({ message: "Invalid escalated flag" });
  }

  const nextChecks = hasChecks ? checks : (existing?.checks || {});
  const nextNotes = Object.prototype.hasOwnProperty.call(req.body || {}, "notes")
    ? toNullableString(req.body?.notes)
    : (existing?.notes ?? null);
  const nextEscalated = parsedEscalated.value !== undefined
    ? parsedEscalated.value
    : (existing?.escalated ?? false);

  const { rows } = await pool.query(
    `INSERT INTO assessment_qa (assessment_id, checks, notes, escalated, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (assessment_id) DO UPDATE SET
       checks = EXCLUDED.checks,
       notes = EXCLUDED.notes,
       escalated = EXCLUDED.escalated,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING assessment_id, checks, notes, escalated, updated_at`,
    [id, nextChecks, nextNotes, nextEscalated, req.user.id]
  );
  await audit(req.user.id, "qa.updated", "assessment", id, null);
  const row = rows[0];
  res.json({
    ...row,
    completed: isQaComplete(assessment.qa_checklist, row.checks, row.escalated),
  });
}));

app.patch("/assessments/:id/assign", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const rawAssign = body.assigned_to;
  let assignedTo = null;
  if (rawAssign !== undefined && rawAssign !== null && rawAssign !== "") {
    if (rawAssign === "me") {
      assignedTo = req.user.id;
    } else {
      assignedTo = normalizeString(rawAssign);
    }
  }

  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, a.assigned_to, r.facility_id
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE a.id = $1`,
    [id]
  );
  const assessment = assessmentRows[0];
  if (!assessment) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessment.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  if (assignedTo) {
    if (!isUuid(assignedTo)) {
      return res.status(400).json({ message: "Invalid assignee" });
    }
    if (req.user.role !== "admin" && assignedTo !== req.user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { rows: userRows } = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND facility_id = $2`,
      [assignedTo, req.user.facility_id]
    );
    if (!userRows[0]) {
      return res.status(400).json({ message: "Assignee not found" });
    }
  } else if (assessment.assigned_to && assessment.assigned_to !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  await pool.query(
    `UPDATE assessments
     SET assigned_to = $1,
         assigned_at = CASE WHEN $1 IS NULL THEN NULL ELSE now() END,
         updated_at = now()
     WHERE id = $2`,
    [assignedTo, id]
  );
  await audit(req.user.id, "assessment.assigned", "assessment", id, { assigned_to: assignedTo });

  const { rows } = await pool.query(
    `SELECT id, assigned_to, assigned_at
     FROM assessments WHERE id = $1`,
    [id]
  );
  res.json(rows[0]);
}));

app.get("/workflow/queue", authMiddleware, asyncHandler(async (req, res) => {
  const facilityId = req.user.facility_id;
  const statusRaw = normalizeString(req.query.status || "");
  const assignedRaw = normalizeString(req.query.assigned || "");
  const assignedToRaw = normalizeString(req.query.assigned_to || "");
  const unitIdRaw = normalizeString(req.query.unit_id || "");
  const includeFallsRaw = normalizeString(req.query.include_falls || "");
  const overdueRaw = normalizeString(req.query.overdue || "");
  const dueWithinRaw = req.query.due_within;
  const limitRaw = req.query.limit;
  const limit = limitRaw === undefined ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ message: "Invalid limit" });
  }

  const overdueParsed = overdueRaw ? parseOptionalBoolean(overdueRaw) : { value: undefined, error: null };
  if (overdueParsed.error) {
    return res.status(400).json({ message: "Invalid overdue filter" });
  }
  const overdue = overdueParsed.value;

  let dueWithinDays = null;
  if (dueWithinRaw !== undefined) {
    const parsed = Number(dueWithinRaw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
      return res.status(400).json({ message: "Invalid due_within filter" });
    }
    dueWithinDays = parsed;
  }

  const filters = ["r.facility_id = $1"];
  const values = [facilityId];
  let index = 2;

  if (statusRaw && statusRaw !== "all") {
    if (!allowedAssessmentStatuses.has(statusRaw)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }
    filters.push(`a.status = $${index}`);
    values.push(statusRaw);
    index += 1;
  } else {
    filters.push(`a.status IN ('needs_review', 'in_review')`);
  }

  if (assignedToRaw) {
    if (assignedToRaw === "me") {
      filters.push(`a.assigned_to = $${index}`);
      values.push(req.user.id);
      index += 1;
    } else if (assignedToRaw === "unassigned") {
      filters.push("a.assigned_to IS NULL");
    } else if (isUuid(assignedToRaw)) {
      filters.push(`a.assigned_to = $${index}`);
      values.push(assignedToRaw);
      index += 1;
    } else {
      return res.status(400).json({ message: "Invalid assigned_to filter" });
    }
  } else if (assignedRaw) {
    if (!["all", "me", "unassigned"].includes(assignedRaw)) {
      return res.status(400).json({ message: "Invalid assignment filter" });
    }
    if (assignedRaw === "me") {
      filters.push(`a.assigned_to = $${index}`);
      values.push(req.user.id);
      index += 1;
    }
    if (assignedRaw === "unassigned") {
      filters.push("a.assigned_to IS NULL");
    }
  }
  if (unitIdRaw) {
    if (!isUuid(unitIdRaw)) {
      return res.status(400).json({ message: "Invalid unit filter" });
    }
    filters.push(`r.unit_id = $${index}`);
    values.push(unitIdRaw);
    index += 1;
  }

  const dueDateExpr = "COALESCE(a.due_date, a.scheduled_date, a.assessment_date)";
  if (overdue === true) {
    filters.push(`${dueDateExpr} < CURRENT_DATE`);
  } else if (overdue === false) {
    filters.push(`${dueDateExpr} >= CURRENT_DATE`);
  }
  if (dueWithinDays !== null) {
    filters.push(`${dueDateExpr} <= CURRENT_DATE + make_interval(days => $${index})`);
    values.push(dueWithinDays);
    index += 1;
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT a.id, a.resident_id, a.assessment_date, a.scheduled_date, a.due_date,
            a.status, a.risk_tier, a.assistive_device, a.created_at,
            a.assigned_to, a.assigned_at,
            r.first_name, r.last_name, r.external_id, r.unit_id,
            fu.label AS unit_label,
            u.full_name AS assigned_name, u.email AS assigned_email,
            f.report_turnaround_hours,
            (${dueDateExpr} + interval '1 day') AS sla_due_at,
            EXTRACT(EPOCH FROM (((${dueDateExpr} + interval '1 day') - now()))) / 3600
              AS sla_hours_remaining
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     LEFT JOIN facility_units fu ON fu.id = r.unit_id
     LEFT JOIN users u ON u.id = a.assigned_to
     ${whereClause}
     ORDER BY a.due_date NULLS LAST, a.created_at ASC
     LIMIT $${index}`,
    [...values, limit]
  );

  const queue = rows.map((row) => {
    const remaining = row.sla_hours_remaining;
    const remainingNumber = remaining === null ? null : Number(remaining);
    let slaStatus = "unknown";
    if (Number.isFinite(remainingNumber)) {
      slaStatus = remainingNumber < 0 ? "overdue" : "on_track";
    }
    return {
      item_type: "assessment",
      id: row.id,
      resident_id: row.resident_id,
      assessment_date: row.assessment_date,
      scheduled_date: row.scheduled_date,
      due_date: row.due_date,
      status: row.status,
      risk_tier: row.risk_tier,
      assistive_device: row.assistive_device,
      created_at: row.created_at,
      assigned_to: row.assigned_to,
      assigned_at: row.assigned_at,
      assigned_name: row.assigned_name,
      assigned_email: row.assigned_email,
      resident_first_name: row.first_name,
      resident_last_name: row.last_name,
      resident_external_id: row.external_id,
      resident_unit_id: row.unit_id,
      resident_unit_label: row.unit_label,
      report_turnaround_hours: row.report_turnaround_hours,
      sla_due_at: row.sla_due_at,
      sla_hours_remaining: remainingNumber,
      sla_status: slaStatus,
    };
  });
  const includeFallEvents = includeFallsRaw !== "false"
    && (!statusRaw || statusRaw === "all")
    && (!assignedRaw || assignedRaw === "all")
    && !assignedToRaw;

  if (!includeFallEvents) {
    res.json(queue);
    return;
  }

  const { rows: fallRows } = await pool.query(
    `SELECT fe.id, fe.resident_id, fe.occurred_at, fe.injury_severity, fe.ems_called, fe.hospital_transfer,
            fe.created_at,
            r.first_name, r.last_name, r.external_id, r.unit_id,
            fu.label AS unit_label,
            f.fall_checklist,
            COALESCE(jsonb_array_length(f.fall_checklist), 0) AS required_count,
            COALESCE(done.completed_count, 0) AS completed_count
     FROM fall_events fe
     JOIN residents r ON r.id = fe.resident_id
     JOIN facilities f ON f.id = fe.facility_id
     LEFT JOIN facility_units fu ON fu.id = r.unit_id
     LEFT JOIN (
       SELECT fall_event_id, COUNT(DISTINCT check_type) AS completed_count
       FROM post_fall_checks
       WHERE status = 'completed'
       GROUP BY fall_event_id
     ) done ON done.fall_event_id = fe.id
     WHERE fe.facility_id = $1
     ORDER BY fe.occurred_at DESC`,
    [facilityId]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fallQueue = fallRows
    .filter((row) => {
      const required = Number(row.required_count);
      const completed = Number(row.completed_count);
      if (!Number.isFinite(required) || required <= 0) {
        return false;
      }
      return completed < required;
    })
    .filter((row) => {
      if (unitIdRaw && row.unit_id !== unitIdRaw) {
        return false;
      }
      const occurredDate = row.occurred_at ? new Date(row.occurred_at) : null;
      if (!occurredDate) {
        return false;
      }
      occurredDate.setHours(0, 0, 0, 0);
      const dueDate = new Date(occurredDate);
      dueDate.setDate(dueDate.getDate() + Math.max(0, postFallFollowupDays));
      let matches = true;
      if (overdue === true) {
        matches = dueDate < today;
      } else if (overdue === false) {
        matches = dueDate >= today;
      }
      if (matches && dueWithinDays !== null) {
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() + dueWithinDays);
        matches = dueDate <= cutoff;
      }
      return matches;
    })
    .map((row) => {
      const occurredDate = row.occurred_at ? new Date(row.occurred_at) : null;
      if (occurredDate) {
        occurredDate.setHours(0, 0, 0, 0);
      }
      const dueDate = occurredDate ? new Date(occurredDate) : null;
      if (dueDate) {
        dueDate.setDate(dueDate.getDate() + Math.max(0, postFallFollowupDays));
      }
      const slaDueAt = dueDate ? new Date(dueDate) : null;
      if (slaDueAt) {
        slaDueAt.setDate(slaDueAt.getDate() + 1);
      }
      const remainingHours = slaDueAt
        ? (slaDueAt.getTime() - Date.now()) / 3600000
        : null;
      let slaStatus = "unknown";
      if (Number.isFinite(remainingHours)) {
        slaStatus = remainingHours < 0 ? "overdue" : "on_track";
      }
      return {
        item_type: "fall_event",
        id: row.id,
        resident_id: row.resident_id,
        occurred_at: row.occurred_at,
        due_date: dueDate ? formatDateOnly(dueDate) : null,
        status: "post_fall",
        injury_severity: row.injury_severity,
        ems_called: row.ems_called,
        hospital_transfer: row.hospital_transfer,
        fall_checks_required: Number(row.required_count) || 0,
        fall_checks_completed: Number(row.completed_count) || 0,
        resident_first_name: row.first_name,
        resident_last_name: row.last_name,
        resident_external_id: row.external_id,
        resident_unit_id: row.unit_id,
        resident_unit_label: row.unit_label,
        created_at: row.created_at,
        sla_due_at: slaDueAt ? slaDueAt.toISOString() : null,
        sla_hours_remaining: Number.isFinite(remainingHours) ? remainingHours : null,
        sla_status: slaStatus,
      };
    });

  const combined = [...queue, ...fallQueue];
  combined.sort((a, b) => {
    const dateA = new Date(a.due_date || a.assessment_date || a.occurred_at || a.created_at || 0).getTime();
    const dateB = new Date(b.due_date || b.assessment_date || b.occurred_at || b.created_at || 0).getTime();
    return dateA - dateB;
  });
  res.json(combined.slice(0, limit));
}));

app.use("/assessments/:id/videos", uploadRateLimiter);

app.post("/assessments/:id/videos/presign", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, r.facility_id, f.role_policy
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [id]
  );
  if (!assessmentRows[0]) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessmentRows[0].facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessmentRows[0].role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const storageKey = `videos/${id}/${Date.now()}.mp4`;
  res.json({
    upload_url: `http://localhost:${port}/assessments/${id}/videos/upload`,
    storage_key: storageKey,
    expires_in: 600,
    method: "POST",
  });
}));

app.post("/assessments/:id/videos/upload", authMiddleware, upload.single("file"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ message: "File is required" });
  }
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, r.facility_id, f.role_policy
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [id]
  );
  if (!assessmentRows[0]) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessmentRows[0].facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessmentRows[0].role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const allowedTypes = new Set(["video/mp4", "video/quicktime"]);
  if (!allowedTypes.has(req.file.mimetype)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: "Unsupported video type" });
  }

  const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  let durationSeconds = parseNumber(req.body?.duration_seconds);
  let width = parseNumber(req.body?.width);
  let height = parseNumber(req.body?.height);

  let probeError = null;
  try {
    const metadata = await probeVideo(req.file.path);
    if (Number.isFinite(metadata.durationSeconds)) {
      durationSeconds = metadata.durationSeconds;
    }
    if (Number.isFinite(metadata.width)) {
      width = metadata.width;
    }
    if (Number.isFinite(metadata.height)) {
      height = metadata.height;
    }
  } catch (error) {
    probeError = error;
  }

  const hasDuration = Number.isFinite(durationSeconds);
  const hasWidth = Number.isFinite(width);
  const hasHeight = Number.isFinite(height);

  if (!hasDuration || !hasWidth || !hasHeight) {
    fs.unlinkSync(req.file.path);
    if (probeError && probeError.code === "ENOENT") {
      return res.status(400).json({
        message: "ffprobe not available. Install ffmpeg or pass duration_seconds, width, height.",
      });
    }
    return res.status(400).json({ message: "Unable to read video metadata" });
  }

  if (durationSeconds < 10 || durationSeconds > 120) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: "Duration must be between 10 and 120 seconds" });
  }
  if (width < 640) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: "Video width must be at least 640px" });
  }
  if (height < 360) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: "Video height must be at least 360px" });
  }

  const storageKey = `videos/${id}/${req.file.filename}`;
  const checksum = crypto.createHash("md5").update(fs.readFileSync(req.file.path)).digest("hex");

  const { rows } = await pool.query(
    `INSERT INTO videos (assessment_id, storage_key, content_type, duration_seconds, width, height, checksum, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, assessment_id, storage_key, content_type, duration_seconds, width, height, checksum, uploaded_by, created_at`,
    [id, storageKey, req.file.mimetype || null, durationSeconds, width, height, `md5:${checksum}`, req.user.id]
  );
  await audit(req.user.id, "video.uploaded", "video", rows[0].id, null);
  const gaitRun = await createGaitModelRun({
    facilityId: assessmentRows[0].facility_id,
    assessmentId: id,
    videoId: rows[0].id,
  });
  if (gaitRun) {
    await enqueueGaitModelRun(gaitRun);
    await audit(req.user.id, "gait_model.queued", "gait_model_run", gaitRun.id, null);
  }
  res.status(201).json(rows[0]);
}));

app.post("/assessments/:id/videos/complete", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { storage_key, content_type, duration_seconds, width, height, checksum } = req.body || {};
  if (!storage_key) {
    return res.status(400).json({ message: "storage_key is required" });
  }
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, r.facility_id, f.role_policy
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [id]
  );
  if (!assessmentRows[0]) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessmentRows[0].facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessmentRows[0].role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }

  const { rows } = await pool.query(
    `INSERT INTO videos (assessment_id, storage_key, content_type, duration_seconds, width, height, checksum, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, assessment_id, storage_key, content_type, duration_seconds, width, height, checksum, uploaded_by, created_at`,
    [id, storage_key, content_type || null, duration_seconds || null, width || null, height || null, checksum || null, req.user.id]
  );
  await audit(req.user.id, "video.created", "video", rows[0].id, null);
  const gaitRun = await createGaitModelRun({
    facilityId: assessmentRows[0].facility_id,
    assessmentId: id,
    videoId: rows[0].id,
  });
  if (gaitRun) {
    await enqueueGaitModelRun(gaitRun);
    await audit(req.user.id, "gait_model.queued", "gait_model_run", gaitRun.id, null);
  }
  res.status(201).json(rows[0]);
}));

app.post("/assessments/:id/model/run", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT a.id, r.facility_id, f.role_policy,
            v.id AS video_id
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     LEFT JOIN LATERAL (
       SELECT id FROM videos WHERE assessment_id = a.id ORDER BY created_at DESC LIMIT 1
     ) v ON true
     WHERE a.id = $1`,
    [id]
  );
  const assessment = rows[0];
  if (!assessment) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessment.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessment.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }
  if (!assessment.video_id) {
    return res.status(400).json({ message: "Video is required to run the model" });
  }

  const { rows: latestRuns } = await pool.query(
    `SELECT id, status
     FROM gait_model_runs
     WHERE assessment_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  const latest = latestRuns[0];
  if (latest && (latest.status === "queued" || latest.status === "running")) {
    return res.status(409).json({ message: "Model run already in progress" });
  }

  const gaitRun = await createGaitModelRun({
    facilityId: assessment.facility_id,
    assessmentId: id,
    videoId: assessment.video_id,
  });
  if (!gaitRun) {
    return res.status(500).json({ message: "Unable to start model run" });
  }
  await enqueueGaitModelRun(gaitRun);
  await audit(req.user.id, "gait_model.queued", "gait_model_run", gaitRun.id, null);
  res.status(201).json({ id: gaitRun.id, status: "queued" });
}));

async function fetchAssessmentForReport(assessmentId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.assessment_date, a.assistive_device, a.risk_tier, a.clinician_notes,
            r.first_name, r.last_name, r.dob, r.sex
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE a.id = $1`,
    [assessmentId]
  );
  const assessment = rows[0];
  if (!assessment) {
    return null;
  }
  const { rows: scoreRows } = await pool.query(
    `SELECT tug_seconds, chair_stand_seconds, balance_side_by_side, balance_semi_tandem, balance_tandem, score_notes
     FROM assessment_scores WHERE assessment_id = $1`,
    [assessmentId]
  );
  assessment.scores = scoreRows[0] || null;
  return assessment;
}

async function fetchAssessmentForPtSummary(assessmentId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.assessment_date, a.assistive_device, a.risk_tier, a.clinician_notes,
            a.pt_cpt_codes, a.pt_goals, a.pt_plan_of_care, a.pt_pain_score,
            a.pt_session_minutes, a.pt_time_saved_minutes,
            r.first_name, r.last_name, r.dob, r.sex, r.external_id,
            f.name AS facility_name
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     WHERE a.id = $1`,
    [assessmentId]
  );
  const assessment = rows[0];
  if (!assessment) {
    return null;
  }
  const { rows: scoreRows } = await pool.query(
    `SELECT tug_seconds, chair_stand_seconds, balance_side_by_side, balance_semi_tandem, balance_tandem, score_notes
     FROM assessment_scores WHERE assessment_id = $1`,
    [assessmentId]
  );
  assessment.scores = scoreRows[0] || null;
  return assessment;
}

function generatePdf(filePath, assessment) {
  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(20).text("StrideSafe Assessment Report", { align: "left" });
  doc.moveDown();
  doc.fontSize(12).text(`Resident: ${assessment.first_name || ""} ${assessment.last_name || ""}`);
  doc.text(`DOB: ${assessment.dob || ""}`);
  doc.text(`Sex: ${assessment.sex || ""}`);
  doc.text(`Assessment Date: ${assessment.assessment_date}`);
  doc.text(`Assistive Device: ${assessment.assistive_device || "None"}`);
  doc.text(`Risk Tier: ${assessment.risk_tier || "Not set"}`);
  doc.moveDown();

  doc.fontSize(14).text("Scores", { underline: true });
  if (assessment.scores) {
    doc.fontSize(12).text(`TUG (sec): ${assessment.scores.tug_seconds ?? "-"}`);
    doc.text(`Chair Stand (sec): ${assessment.scores.chair_stand_seconds ?? "-"}`);
    doc.text(`Balance side-by-side: ${assessment.scores.balance_side_by_side ? "Pass" : "Fail"}`);
    doc.text(`Balance semi-tandem: ${assessment.scores.balance_semi_tandem ? "Pass" : "Fail"}`);
    doc.text(`Balance tandem: ${assessment.scores.balance_tandem ? "Pass" : "Fail"}`);
    doc.text(`Notes: ${assessment.scores.score_notes || ""}`);
  } else {
    doc.fontSize(12).text("No scores recorded.");
  }

  doc.moveDown();
  doc.fontSize(14).text("Clinician Notes", { underline: true });
  doc.fontSize(12).text(assessment.clinician_notes || "");

  doc.end();
}

function generatePtSummaryPdf(filePath, assessment) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.pipe(stream);

    doc.fontSize(20).fillColor("#0b4a3b").text("StrideSafe PT Workflow Summary", { align: "left" });
    doc.fontSize(10).fillColor("#5f6c67").text("StrideSafe — a division of Techeze AI", { align: "left" });
    doc.moveDown(0.4);
    doc.strokeColor("#d6e5e1").lineWidth(1).moveTo(48, doc.y).lineTo(548, doc.y).stroke();
    doc.moveDown();
    doc.fillColor("#1b1f1d");

    doc.fontSize(12).text(`Facility: ${assessment.facility_name || "—"}`);
    doc.text(`Resident: ${assessment.first_name || ""} ${assessment.last_name || ""}`);
    doc.text(`Resident ID: ${assessment.external_id || "—"}`);
    doc.text(`DOB: ${assessment.dob || ""}`);
    doc.text(`Sex: ${assessment.sex || ""}`);
    doc.text(`Assessment Date: ${assessment.assessment_date || "—"}`);
    doc.text(`Assistive Device: ${assessment.assistive_device || "None"}`);
    doc.text(`Risk Tier: ${assessment.risk_tier || "Not set"}`);
    doc.moveDown();

    doc.fontSize(14).text("PT Documentation", { underline: true });
    doc.fontSize(12).text(`CPT Codes: ${assessment.pt_cpt_codes || "—"}`);
    doc.text(`Pain Scale: ${assessment.pt_pain_score ?? "—"}`);
    doc.text(`Session Minutes: ${assessment.pt_session_minutes ?? "—"}`);
    doc.text(`Time Saved (min): ${assessment.pt_time_saved_minutes ?? "—"}`);
    doc.moveDown(0.5);
    doc.fontSize(12).text("Goals:");
    doc.text(assessment.pt_goals || "—");
    doc.moveDown(0.5);
    doc.fontSize(12).text("Plan of Care:");
    doc.text(assessment.pt_plan_of_care || "—");
    doc.moveDown();

    doc.fontSize(14).text("Scores", { underline: true });
    if (assessment.scores) {
      doc.fontSize(12).text(`TUG (sec): ${assessment.scores.tug_seconds ?? "-"}`);
      doc.text(`Chair Stand (sec): ${assessment.scores.chair_stand_seconds ?? "-"}`);
      doc.text(`Balance side-by-side: ${assessment.scores.balance_side_by_side ? "Pass" : "Fail"}`);
      doc.text(`Balance semi-tandem: ${assessment.scores.balance_semi_tandem ? "Pass" : "Fail"}`);
      doc.text(`Balance tandem: ${assessment.scores.balance_tandem ? "Pass" : "Fail"}`);
      doc.text(`Notes: ${assessment.scores.score_notes || ""}`);
    } else {
      doc.fontSize(12).text("No scores recorded.");
    }

    doc.moveDown();
    doc.fontSize(14).text("Clinician Notes", { underline: true });
    doc.fontSize(12).text(assessment.clinician_notes || "");

    doc.end();
  });
}

app.post("/assessments/:id/reports", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, r.facility_id, COALESCE(a.assessment_protocol, f.assessment_protocol) AS assessment_protocol,
            f.role_policy, f.qa_checklist,
            COUNT(v.id)::int AS video_count,
            s.tug_seconds, s.chair_stand_seconds, s.balance_side_by_side, s.balance_semi_tandem, s.balance_tandem,
            q.checks AS qa_checks, q.escalated AS qa_escalated
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     LEFT JOIN videos v ON v.assessment_id = a.id
     LEFT JOIN assessment_scores s ON s.assessment_id = a.id
     LEFT JOIN assessment_qa q ON q.assessment_id = a.id
     WHERE a.id = $1
     GROUP BY a.id, r.facility_id, COALESCE(a.assessment_protocol, f.assessment_protocol), f.role_policy, f.qa_checklist,
              s.tug_seconds, s.chair_stand_seconds, s.balance_side_by_side, s.balance_semi_tandem, s.balance_tandem,
              q.checks, q.escalated`,
    [id]
  );
  const assessmentRow = assessmentRows[0];
  if (!assessmentRow) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessmentRow.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessmentRow.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }
  if (!assessmentRow.video_count) {
    return res.status(400).json({ message: "Video is required to generate report" });
  }
  const storedScores = extractStoredScores(assessmentRow);
  const protocol = assessmentRow.assessment_protocol || "tug_chair_balance";
  if (!canApplyModelScores(protocol, storedScores)) {
    return res.status(400).json({ message: "Scores are required to generate report" });
  }
  if (!isQaComplete(assessmentRow.qa_checklist, assessmentRow.qa_checks, assessmentRow.qa_escalated)) {
    return res.status(400).json({ message: "QA checklist must be complete before generating report" });
  }

  const { rows: existingRows } = await pool.query(
    `SELECT id, finalized
     FROM reports
     WHERE assessment_id = $1 AND report_type = 'assessment'
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  const existingReport = existingRows[0];
  if (existingReport?.finalized && req.user.role !== "admin") {
    return res.status(403).json({ message: "Report is finalized" });
  }

  const assessment = await fetchAssessmentForReport(id);
  if (!assessment) {
    return res.status(404).json({ message: "Assessment not found" });
  }

  const reportId = crypto.randomUUID();
  const reportDir = ensureReportDir();
  const relativeKey = `reports/${reportId}.pdf`;
  const filePath = path.resolve(reportDir, `${reportId}.pdf`);
  generatePdf(filePath, assessment);

  const { rows } = await pool.query(
    `INSERT INTO reports (
       id,
       assessment_id,
       pdf_storage_key,
       created_by,
       template_version,
       generated_at,
       generated_by,
       finalized,
       report_type
     )
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)
     RETURNING id, assessment_id, pdf_storage_key, created_by, created_at,
               template_version, generated_at, generated_by, finalized, report_type`,
    [reportId, id, relativeKey, req.user.id, reportTemplateVersion, req.user.id, true, "assessment"]
  );
  await audit(req.user.id, "report.created", "report", reportId, null);
  try {
    const { rows: notifyRows } = await pool.query(
      `SELECT a.created_by, r.id AS resident_id, r.first_name, r.last_name, r.facility_id
       FROM assessments a
       JOIN residents r ON r.id = a.resident_id
       WHERE a.id = $1`,
      [id]
    );
    const notifyTarget = notifyRows[0];
    if (notifyTarget) {
      const residentName = `${notifyTarget.first_name || ""} ${notifyTarget.last_name || ""}`.trim() || "Resident";
      const data = {
        assessment_id: id,
        report_id: reportId,
        resident_id: notifyTarget.resident_id,
        resident_name: residentName,
      };
      const title = "Report ready";
      const body = `Report is ready for ${residentName}.`;
      const eventKeyBase = `report.ready:${reportId}`;
      if (notifyTarget.created_by) {
        await createNotification({
          facilityId: notifyTarget.facility_id,
          userId: notifyTarget.created_by,
          type: "report.ready",
          title,
          body,
          data,
          eventKey: `${eventKeyBase}:${notifyTarget.created_by}`,
        });
      } else {
        await notifyFacilityUsers({
          facilityId: notifyTarget.facility_id,
          type: "report.ready",
          title,
          body,
          data,
          eventKeyBase,
          roles: ["clinician", "admin"],
        });
      }
    }
  } catch (error) {
    console.error("Failed to create report notification", error.message);
  }
  res.status(201).json(rows[0]);
}));

app.get("/assessments/:id/pt-summary", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: assessmentRows } = await pool.query(
    `SELECT a.id, r.facility_id, f.role_policy, f.qa_checklist,
            COUNT(v.id)::int AS video_count,
            s.tug_seconds, s.chair_stand_seconds, s.balance_side_by_side, s.balance_semi_tandem, s.balance_tandem,
            q.checks AS qa_checks, q.escalated AS qa_escalated,
            a.pt_cpt_codes, a.pt_goals, a.pt_plan_of_care, a.pt_pain_score,
            COALESCE(a.assessment_protocol, f.assessment_protocol) AS assessment_protocol
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     JOIN facilities f ON f.id = r.facility_id
     LEFT JOIN videos v ON v.assessment_id = a.id
     LEFT JOIN assessment_scores s ON s.assessment_id = a.id
     LEFT JOIN assessment_qa q ON q.assessment_id = a.id
     WHERE a.id = $1
     GROUP BY a.id, r.facility_id, f.role_policy, f.qa_checklist,
              s.tug_seconds, s.chair_stand_seconds, s.balance_side_by_side,
              s.balance_semi_tandem, s.balance_tandem,
              q.checks, q.escalated,
              a.pt_cpt_codes, a.pt_goals, a.pt_plan_of_care, a.pt_pain_score,
              COALESCE(a.assessment_protocol, f.assessment_protocol)`,
    [id]
  );
  const assessmentRow = assessmentRows[0];
  if (!assessmentRow) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  if (assessmentRow.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (!isRolePolicyAllowed(assessmentRow.role_policy, req.user.role)) {
    return res.status(403).json({ message: "Admin role required for this facility" });
  }
  if (!assessmentRow.video_count) {
    return res.status(400).json({ message: "Video is required to export PT summary" });
  }
  const storedScores = extractStoredScores(assessmentRow);
  const protocol = assessmentRow.assessment_protocol || "tug_chair_balance";
  if (!canApplyModelScores(protocol, storedScores)) {
    return res.status(400).json({ message: "Scores are required to export PT summary" });
  }
  if (!isQaComplete(assessmentRow.qa_checklist, assessmentRow.qa_checks, assessmentRow.qa_escalated)) {
    return res.status(400).json({ message: "QA checklist must be complete before exporting summary" });
  }
  if (!assessmentRow.pt_cpt_codes || !assessmentRow.pt_goals || !assessmentRow.pt_plan_of_care) {
    return res.status(400).json({ message: "PT documentation is required to export summary" });
  }
  if (assessmentRow.pt_pain_score === null || assessmentRow.pt_pain_score === undefined) {
    return res.status(400).json({ message: "Pain score is required to export summary" });
  }

  const assessment = await fetchAssessmentForPtSummary(id);
  if (!assessment) {
    return res.status(404).json({ message: "Assessment not found" });
  }
  const reportId = crypto.randomUUID();
  const reportDir = ensureReportDir();
  const relativeKey = `reports/${reportId}.pdf`;
  const filePath = path.resolve(reportDir, `${reportId}.pdf`);
  await generatePtSummaryPdf(filePath, assessment);

  const { rows } = await pool.query(
    `INSERT INTO reports (
       id,
       assessment_id,
       pdf_storage_key,
       created_by,
       template_version,
       generated_at,
       generated_by,
       finalized,
       report_type
     )
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)
     RETURNING id`,
    [reportId, id, relativeKey, req.user.id, "pt_v1", req.user.id, true, "pt_summary"]
  );

  await audit(req.user.id, "pt_summary.downloaded", "report", rows[0]?.id || reportId, null);
  res.setHeader("Content-Disposition", `attachment; filename=pt_summary_${id}.pdf`);
  res.type("application/pdf").sendFile(filePath);
}));

app.get("/reports/:id/download", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT r.id, r.pdf_storage_key, a.resident_id, res.facility_id
     FROM reports r
     JOIN assessments a ON a.id = r.assessment_id
     JOIN residents res ON res.id = a.resident_id
     WHERE r.id = $1`,
    [id]
  );
  const report = rows[0];
  if (!report) {
    return res.status(404).json({ message: "Report not found" });
  }
  if (report.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const filePath = path.resolve(storageRoot, report.pdf_storage_key);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Report file not found" });
  }
  res.type("application/pdf").sendFile(filePath);
}));

app.get("/videos/:id/download", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT v.id, v.storage_key, r.facility_id
     FROM videos v
     JOIN assessments a ON a.id = v.assessment_id
     JOIN residents r ON r.id = a.resident_id
     WHERE v.id = $1`,
    [id]
  );
  const video = rows[0];
  if (!video) {
    return res.status(404).json({ message: "Video not found" });
  }
  if (video.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const filePath = path.resolve(storageRoot, video.storage_key);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Video file not found" });
  }
  res.type("video/mp4").sendFile(filePath);
}));

app.get("/exports/residents", authMiddleware, asyncHandler(async (req, res) => {
  const requestedFacility = normalizeString(req.query.facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  try {
    const csv = await buildResidentsCsv({ facilityId });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"residents_${facilityId}.csv\"`);
    res.status(200).send(csv);
    await logExport({
      userId: req.user.id,
      facilityId,
      exportType: "residents",
      params: { facility_id: facilityId },
      status: "completed",
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

app.get("/exports/assessments", authMiddleware, asyncHandler(async (req, res) => {
  const requestedFacility = normalizeString(req.query.facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const query = {
    resident_id: req.query.resident_id,
    status: req.query.status,
    risk_tier: req.query.risk_tier,
    from: req.query.from,
    to: req.query.to,
    assigned_to: req.query.assigned_to,
    scheduled_from: req.query.scheduled_from,
    scheduled_to: req.query.scheduled_to,
    due_from: req.query.due_from,
    due_to: req.query.due_to,
  };
  const params = { facility_id: facilityId };
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params[key] = value;
    }
  });
  try {
    const csv = await buildAssessmentsCsv({ facilityId, query });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"assessments_${facilityId}.csv\"`);
    res.status(200).send(csv);
    await logExport({
      userId: req.user.id,
      facilityId,
      exportType: "assessments",
      params,
      status: "completed",
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

app.get("/exports/audit", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const requestedFacility = normalizeString(req.query.facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const query = {
    action: req.query.action,
    entity_type: req.query.entity_type,
    user_id: req.query.user_id,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  };
  const params = { facility_id: facilityId };
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params[key] = value;
    }
  });
  try {
    const csv = await buildAuditCsv({ facilityId, query });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"audit_${facilityId}.csv\"`);
    res.status(200).send(csv);
    await logExport({
      userId: req.user.id,
      facilityId,
      exportType: "audit",
      params,
      status: "completed",
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

app.get("/exports/bundle", authMiddleware, asyncHandler(async (req, res) => {
  const requestedFacility = normalizeString(req.query.facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  let includes;
  try {
    includes = resolveBundleIncludes(req.query.include, req.user.role);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }

  const params = { facility_id: facilityId, include: includes };
  try {
    const entries = [];
    if (includes.includes("residents")) {
      const residentsCsv = await buildResidentsCsv({ facilityId });
      entries.push({ name: `residents_${facilityId}.csv`, content: residentsCsv });
    }
    if (includes.includes("assessments")) {
      const assessmentsCsv = await buildAssessmentsCsv({ facilityId, query: {} });
      entries.push({ name: `assessments_${facilityId}.csv`, content: assessmentsCsv });
    }
    if (includes.includes("audit")) {
      const auditCsv = await buildAuditCsv({ facilityId, query: {} });
      entries.push({ name: `audit_${facilityId}.csv`, content: auditCsv });
    }

    const filename = `stride_exports_${facilityId}_${new Date().toISOString().slice(0, 10)}.zip`;
    await streamZip(res, filename, entries);
    await logExport({
      userId: req.user.id,
      facilityId,
      exportType: "bundle",
      params,
      status: "completed",
    });
  } catch (error) {
    await logExport({
      userId: req.user.id,
      facilityId,
      exportType: "bundle",
      params,
      status: "failed",
    });
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

app.post("/exports/tokens", authMiddleware, asyncHandler(async (req, res) => {
  const { export_type, facility_id, params, expires_in_hours } = req.body || {};
  const exportType = normalizeString(export_type).toLowerCase();
  if (!allowedExportTypes.has(exportType)) {
    return res.status(400).json({ message: "Invalid export type" });
  }
  if (exportType === "audit" && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  const requestedFacility = normalizeString(facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  let expiresHours;
  if (expires_in_hours !== undefined) {
    const parsed = Number(expires_in_hours);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxExportTokenHours) {
      return res.status(400).json({ message: "Invalid expires_in_hours" });
    }
    expiresHours = parsed;
  } else {
    const ttlDays = await getFacilityTokenTtlDays(facilityId);
    expiresHours = ttlDays * 24;
  }

  let rawParams = null;
  if (params !== undefined && params !== null) {
    if (typeof params !== "object" || Array.isArray(params)) {
      return res.status(400).json({ message: "Invalid params" });
    }
    rawParams = params;
  }

  let storedParams = null;
  if (exportType === "assessments") {
    storedParams = sanitizeAssessmentExportParams(rawParams);
  } else if (exportType === "audit") {
    storedParams = sanitizeAuditExportParams(rawParams);
  } else if (exportType === "post_fall_rollup") {
    storedParams = sanitizePostFallRollupParams(rawParams);
  } else if (exportType === "bundle") {
    try {
      const includes = resolveBundleIncludes(rawParams?.include, req.user.role);
      storedParams = { include: includes };
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      throw error;
    }
  }

  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
  const scope = exportScopeForType(exportType);
  const { rows } = await pool.query(
    `INSERT INTO export_tokens (user_id, created_by, facility_id, export_type, scope, params, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, export_type, scope, facility_id, params, expires_at, created_at, created_by, revoked_at, used_at`,
    [req.user.id, req.user.id, facilityId, exportType, scope, storedParams, expiresAt]
  );
  const token = rows[0];
  await logExport({
    userId: req.user.id,
    facilityId,
    exportType,
    params: storedParams,
    status: "token_issued",
    tokenId: token.id,
  });
  res.status(201).json({
    ...token,
    download_url: `/exports/download?token=${token.id}`,
  });
}));

app.get("/exports/tokens", authMiddleware, asyncHandler(async (req, res) => {
  const requestedFacility = normalizeString(req.query.facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const limitValue = req.query.limit;
  let limit = 100;
  if (limitValue !== undefined) {
    const parsed = parseOptionalPositiveInt(limitValue);
    if (parsed.error || parsed.value === null) {
      return res.status(400).json({ message: "Invalid limit" });
    }
    limit = Math.min(parsed.value, 500);
  }
  const filters = ["facility_id = $1"];
  if (req.user.role !== "admin") {
    filters.push("export_type <> 'audit'");
  }
  const whereClause = `WHERE ${filters.join(" AND ")}`;
  const { rows } = await pool.query(
    `SELECT id, facility_id, export_type, scope, params, expires_at, created_at, created_by, revoked_at, used_at
     FROM export_tokens ${whereClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    [facilityId, limit]
  );
  res.json(rows);
}));

app.post("/exports/tokens/:id/revoke", authMiddleware, asyncHandler(async (req, res) => {
  const id = normalizeString(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Token id is required" });
  }
  const { rows } = await pool.query(
    `SELECT id, facility_id, export_type, scope, created_by, revoked_at, expires_at, created_at
     FROM export_tokens WHERE id = $1`,
    [id]
  );
  const token = rows[0];
  if (!token) {
    return res.status(404).json({ message: "Token not found" });
  }
  if (token.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (token.export_type === "audit" && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (req.user.role !== "admin" && token.created_by !== req.user.id) {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (token.revoked_at) {
    return res.json(token);
  }
  const { rows: updatedRows } = await pool.query(
    `UPDATE export_tokens SET revoked_at = now() WHERE id = $1
     RETURNING id, facility_id, export_type, scope, params, expires_at, created_at, created_by, revoked_at, used_at`,
    [id]
  );
  await audit(req.user.id, "export.token_revoked", "export_token", id, {
    facility_id: token.facility_id,
    export_type: token.export_type,
    scope: token.scope,
  });
  res.json(updatedRows[0]);
}));

app.get("/exports/tokens/verify", asyncHandler(async (req, res) => {
  const tokenValue = normalizeString(req.query.token || req.query.id);
  if (!tokenValue) {
    return res.status(400).json({ message: "Token is required" });
  }
  const { rows } = await pool.query(
    `SELECT id, facility_id, export_type, scope, expires_at, revoked_at, created_at
     FROM export_tokens WHERE id = $1`,
    [tokenValue]
  );
  const token = rows[0];
  if (!token) {
    return res.status(404).json({ message: "Token not found" });
  }
  const expiresAt = new Date(token.expires_at);
  const expired = Number.isNaN(expiresAt.getTime()) || expiresAt < new Date();
  const revoked = Boolean(token.revoked_at);
  const status = revoked ? "revoked" : expired ? "expired" : "active";
  res.json({
    valid: status === "active",
    status,
    export_type: token.export_type,
    scope: token.scope,
    facility_id: token.facility_id,
    expires_at: token.expires_at,
    revoked_at: token.revoked_at,
    created_at: token.created_at,
  });
}));

app.get("/exports/download", asyncHandler(async (req, res) => {
  const tokenValue = normalizeString(req.query.token || req.query.id);
  if (!tokenValue) {
    return res.status(400).json({ message: "Token is required" });
  }
  const { rows } = await pool.query(
    `SELECT id, user_id, created_by, facility_id, export_type, scope, params, expires_at, revoked_at, used_at
     FROM export_tokens WHERE id = $1`,
    [tokenValue]
  );
  const token = rows[0];
  if (!token) {
    return res.status(404).json({ message: "Token not found" });
  }
  if (token.revoked_at) {
    return res.status(410).json({ message: "Token revoked" });
  }
  const expiresAt = new Date(token.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
    return res.status(410).json({ message: "Token expired" });
  }
  if (!token.facility_id || !allowedExportTypes.has(token.export_type)) {
    return res.status(400).json({ message: "Invalid token" });
  }

  if (!token.used_at) {
    await pool.query(`UPDATE export_tokens SET used_at = now() WHERE id = $1`, [token.id]);
  }

  const params = token.params || null;
  try {
    if (token.export_type === "residents") {
      const csv = await buildResidentsCsv({ facilityId: token.facility_id });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"residents_${token.facility_id}.csv\"`);
      res.status(200).send(csv);
    } else if (token.export_type === "assessments") {
      const csv = await buildAssessmentsCsv({ facilityId: token.facility_id, query: params || {} });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"assessments_${token.facility_id}.csv\"`);
      res.status(200).send(csv);
    } else if (token.export_type === "audit") {
      const csv = await buildAuditCsv({ facilityId: token.facility_id, query: params || {} });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"audit_${token.facility_id}.csv\"`);
      res.status(200).send(csv);
    } else if (token.export_type === "post_fall_rollup") {
      const csv = await buildPostFallRollupCsv({ facilityId: token.facility_id, params: params || {} });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"post_fall_rollup_${token.facility_id}.csv\"`);
      res.status(200).send(csv);
    } else if (token.export_type === "bundle") {
      const includes = normalizeIncludeList(params?.include)
        || ["residents", "assessments"];
      const invalid = includes.filter((entry) => !allowedBundleIncludes.has(entry));
      if (invalid.length) {
        return res.status(400).json({ message: "Invalid bundle include" });
      }
      const entries = [];
      if (includes.includes("residents")) {
        const residentsCsv = await buildResidentsCsv({ facilityId: token.facility_id });
        entries.push({ name: `residents_${token.facility_id}.csv`, content: residentsCsv });
      }
      if (includes.includes("assessments")) {
        const assessmentsCsv = await buildAssessmentsCsv({ facilityId: token.facility_id, query: {} });
        entries.push({ name: `assessments_${token.facility_id}.csv`, content: assessmentsCsv });
      }
      if (includes.includes("audit")) {
        const auditCsv = await buildAuditCsv({ facilityId: token.facility_id, query: {} });
        entries.push({ name: `audit_${token.facility_id}.csv`, content: auditCsv });
      }
      const filename = `stride_exports_${token.facility_id}_${new Date().toISOString().slice(0, 10)}.zip`;
      await streamZip(res, filename, entries);
    }

    await logExport({
      userId: token.user_id || token.created_by,
      facilityId: token.facility_id,
      exportType: token.export_type,
      params,
      status: "completed",
      tokenId: token.id,
    });
    await audit(
      token.created_by || token.user_id,
      "export.downloaded",
      "export_token",
      token.id,
      {
        facility_id: token.facility_id,
        export_type: token.export_type,
        scope: token.scope,
      }
    );
  } catch (error) {
    await logExport({
      userId: token.user_id || token.created_by,
      facilityId: token.facility_id,
      exportType: token.export_type,
      params,
      status: "failed",
      tokenId: token.id,
    });
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

app.get("/export-schedules", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const facilityId = normalizeString(req.query.facility_id || "");
  const values = [];
  let whereClause = "";
  if (facilityId) {
    if (!isUuid(facilityId)) {
      return res.status(400).json({ message: "Invalid facility_id" });
    }
    values.push(facilityId);
    whereClause = "WHERE s.facility_id = $1";
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.facility_id, f.name AS facility_name,
            s.created_by, u.full_name AS created_by_name,
            s.name, s.export_type, s.params, s.include, s.expires_hours,
            s.frequency, s.day_of_week, s.hour, s.minute, s.status,
            s.last_run_at, s.next_run_at, s.created_at, s.updated_at
     FROM export_schedules s
     JOIN facilities f ON f.id = s.facility_id
     LEFT JOIN users u ON u.id = s.created_by
     ${whereClause}
     ORDER BY s.created_at DESC`,
    values
  );
  res.json(rows);
}));

app.post("/export-schedules", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = normalizeString(body.name);
  if (!name) {
    return res.status(400).json({ message: "Name is required" });
  }
  const exportType = normalizeString(body.export_type).toLowerCase();
  if (!allowedExportTypes.has(exportType)) {
    return res.status(400).json({ message: "Invalid export_type" });
  }
  const frequency = normalizeString(body.frequency).toLowerCase();
  if (!allowedScheduleFrequencies.has(frequency)) {
    return res.status(400).json({ message: "Invalid frequency" });
  }
  const hour = Number(body.hour);
  const minute = Number(body.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return res.status(400).json({ message: "Invalid hour" });
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return res.status(400).json({ message: "Invalid minute" });
  }
  const dayOfWeek = body.day_of_week === undefined ? null : Number(body.day_of_week);
  if (frequency === "weekly") {
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ message: "Invalid day_of_week" });
    }
  }
  const status = normalizeString(body.status).toLowerCase() || "active";
  if (!allowedScheduleStatuses.has(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  const expiresHoursRaw = body.expires_hours;
  let expiresHours = 72;
  if (expiresHoursRaw !== undefined && expiresHoursRaw !== null && expiresHoursRaw !== "") {
    const parsed = Number(expiresHoursRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
      return res.status(400).json({ message: "Invalid expires_hours" });
    }
    expiresHours = parsed;
  }
  const facilityId = normalizeString(body.facility_id || "") || req.user.facility_id;
  if (!facilityId || !isUuid(facilityId)) {
    return res.status(400).json({ message: "Invalid facility_id" });
  }

  let params = null;
  let include = null;
  if (exportType === "assessments") {
    params = sanitizeAssessmentExportParams(body.params || {});
  } else if (exportType === "audit") {
    params = sanitizeAuditExportParams(body.params || {});
  } else if (exportType === "post_fall_rollup") {
    params = sanitizePostFallRollupParams(body.params || {});
  } else if (exportType === "bundle") {
    const includes = resolveBundleIncludes(body.include ?? body.params?.include, req.user.role);
    include = includes;
  }

  const { rows } = await pool.query(
    `INSERT INTO export_schedules (
       facility_id, created_by, name, export_type, params, include, expires_hours,
       frequency, day_of_week, hour, minute, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      facilityId,
      req.user.id,
      name,
      exportType,
      params,
      include,
      expiresHours,
      frequency,
      frequency === "weekly" ? dayOfWeek : null,
      hour,
      minute,
      status,
    ]
  );
  const schedule = rows[0];
  if (status === "active") {
    await scheduleNextExportRun(schedule);
  }
  await audit(req.user.id, "export_schedule.created", "export_schedule", schedule.id, null);
  res.status(201).json(schedule);
}));

app.patch("/export-schedules/:id", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const { rows: scheduleRows } = await pool.query(
    `SELECT * FROM export_schedules WHERE id = $1`,
    [id]
  );
  const schedule = scheduleRows[0];
  if (!schedule) {
    return res.status(404).json({ message: "Schedule not found" });
  }

  const updateFields = {};
  if (body.name !== undefined) {
    const name = normalizeString(body.name);
    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    updateFields.name = name;
  }
  if (body.export_type !== undefined) {
    const exportType = normalizeString(body.export_type).toLowerCase();
    if (!allowedExportTypes.has(exportType)) {
      return res.status(400).json({ message: "Invalid export_type" });
    }
    updateFields.export_type = exportType;
  }
  if (body.frequency !== undefined) {
    const frequency = normalizeString(body.frequency).toLowerCase();
    if (!allowedScheduleFrequencies.has(frequency)) {
      return res.status(400).json({ message: "Invalid frequency" });
    }
    updateFields.frequency = frequency;
  }
  if (body.hour !== undefined) {
    const hour = Number(body.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return res.status(400).json({ message: "Invalid hour" });
    }
    updateFields.hour = hour;
  }
  if (body.minute !== undefined) {
    const minute = Number(body.minute);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      return res.status(400).json({ message: "Invalid minute" });
    }
    updateFields.minute = minute;
  }
  if (body.day_of_week !== undefined) {
    const dayOfWeek = body.day_of_week === null ? null : Number(body.day_of_week);
    if (dayOfWeek !== null && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
      return res.status(400).json({ message: "Invalid day_of_week" });
    }
    updateFields.day_of_week = dayOfWeek;
  }
  if (body.status !== undefined) {
    const status = normalizeString(body.status).toLowerCase();
    if (!allowedScheduleStatuses.has(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    updateFields.status = status;
  }
  if (body.expires_hours !== undefined) {
    const expiresHours = Number(body.expires_hours);
    if (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 168) {
      return res.status(400).json({ message: "Invalid expires_hours" });
    }
    updateFields.expires_hours = expiresHours;
  }

  const nextExportType = updateFields.export_type || schedule.export_type;
  if (body.params !== undefined && nextExportType !== "bundle") {
    if (nextExportType === "assessments") {
      updateFields.params = sanitizeAssessmentExportParams(body.params || {});
    } else if (nextExportType === "audit") {
      updateFields.params = sanitizeAuditExportParams(body.params || {});
    } else if (nextExportType === "post_fall_rollup") {
      updateFields.params = sanitizePostFallRollupParams(body.params || {});
    } else {
      updateFields.params = null;
    }
  }
  if (body.include !== undefined || body.params?.include !== undefined) {
    const includeRaw = body.include ?? body.params?.include;
    updateFields.include = resolveBundleIncludes(includeRaw, req.user.role);
  }

  if (updateFields.frequency === "weekly" && updateFields.day_of_week === null) {
    return res.status(400).json({ message: "day_of_week required for weekly schedules" });
  }

  const update = buildUpdate(updateFields);
  if (update) {
    const { setClauses, values } = update;
    await pool.query(
      `UPDATE export_schedules SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
  }

  const { rows: updatedRows } = await pool.query(
    `SELECT * FROM export_schedules WHERE id = $1`,
    [id]
  );
  const updated = updatedRows[0];
  if (updated.status === "active") {
    await scheduleNextExportRun(updated);
  } else {
    await pool.query(
      `UPDATE export_schedules SET next_run_at = NULL, updated_at = now() WHERE id = $1`,
      [id]
    );
  }
  await audit(req.user.id, "export_schedule.updated", "export_schedule", id, null);
  res.json(updated);
}));

app.post("/export-schedules/:id/run", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const token = await runExportSchedule({ schedule_id: id });
  if (!token) {
    return res.status(404).json({ message: "Schedule not found or inactive" });
  }
  res.status(201).json({
    token_id: token.id,
    download_url: `/exports/download?token=${token.id}`,
    expires_at: token.expires_at,
  });
}));

app.get("/exports/logs", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const requestedFacility = normalizeString(req.query.facility_id);
  const facilityId = getFacilityIdForExport(requestedFacility || undefined, req.user);
  if (!facilityId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const limitRaw = req.query.limit;
  const limit = limitRaw === undefined ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ message: "Invalid limit" });
  }
  const exportType = normalizeString(req.query.export_type).toLowerCase();
  if (exportType && !allowedExportTypes.has(exportType)) {
    return res.status(400).json({ message: "Invalid export type" });
  }

  const filters = ["facility_id = $1"];
  const values = [facilityId];
  let index = 2;
  if (exportType) {
    filters.push(`export_type = $${index}`);
    values.push(exportType);
    index += 1;
  }

  const { rows } = await pool.query(
    `SELECT id, user_id, export_token_id, export_type, params, status, created_at
     FROM export_logs
     WHERE ${filters.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${index}`,
    [...values, limit]
  );
  res.json(rows);
}));

app.get("/notifications", authMiddleware, asyncHandler(async (req, res) => {
  const limitRaw = req.query.limit;
  const limit = limitRaw === undefined ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return res.status(400).json({ message: "Invalid limit" });
  }
  const statusRaw = normalizeString(req.query.status).toLowerCase();
  let statusClause = "";
  const values = [req.user.id, req.user.facility_id];
  let index = values.length + 1;
  if (statusRaw) {
    if (!allowedNotificationStatuses.has(statusRaw)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }
    statusClause = `AND status = $${index}`;
    values.push(statusRaw);
    index += 1;
  }
  values.push(limit);
  const { rows } = await pool.query(
    `SELECT id, facility_id, user_id, type, title, body, data, channel, status, created_at, read_at
     FROM notifications
     WHERE (user_id = $1 OR (user_id IS NULL AND facility_id = $2))
     ${statusClause}
     ORDER BY created_at DESC
     LIMIT $${index}`,
    values
  );
  res.json(rows);
}));

app.patch("/notifications/read-all", authMiddleware, asyncHandler(async (req, res) => {
  const statusRaw = normalizeString(req.query.status).toLowerCase();
  if (statusRaw && statusRaw !== "all" && !allowedNotificationStatuses.has(statusRaw)) {
    return res.status(400).json({ message: "Invalid status filter" });
  }
  if (statusRaw === "read") {
    return res.json({ updated: 0 });
  }
  const statusClause = "status = 'unread'";
  const { rows } = await pool.query(
    `UPDATE notifications
     SET status = 'read', read_at = now()
     WHERE ${statusClause}
       AND (user_id = $1 OR (user_id IS NULL AND facility_id = $2))
     RETURNING id`,
    [req.user.id, req.user.facility_id]
  );
  res.json({ updated: rows.length });
}));

app.patch("/notifications/:id/read", authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT id, user_id, facility_id, status
     FROM notifications WHERE id = $1`,
    [id]
  );
  const notification = rows[0];
  if (!notification) {
    return res.status(404).json({ message: "Notification not found" });
  }
  if (notification.facility_id !== req.user.facility_id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  if (notification.user_id && notification.user_id !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { rows: updated } = await pool.query(
    `UPDATE notifications
     SET status = 'read', read_at = now()
     WHERE id = $1
     RETURNING id, facility_id, user_id, type, title, body, data, channel, status, created_at, read_at`,
    [id]
  );
  res.json(updated[0]);
}));

app.get("/analytics/summary", authMiddleware, asyncHandler(async (req, res) => {
  const facilityId = req.user.facility_id;
  const windowDaysRaw = req.query.days;
  const windowDays = windowDaysRaw === undefined ? 7 : Number(windowDaysRaw);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    return res.status(400).json({ message: "Invalid days window" });
  }

  const { rows: assessmentRows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1 AND a.created_at >= now() - ($2 * interval '1 day')`,
    [facilityId, windowDays]
  );

  const { rows: totalsRows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE a.risk_tier = 'high')::int AS high_risk
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1`,
    [facilityId]
  );

  const { rows: timeRows } = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (a.updated_at - a.created_at)) / 60) AS avg_minutes
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1 AND a.status = 'completed'`,
    [facilityId]
  );

  const { rows: reassessmentRows } = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM (
        SELECT resident_id FROM assessments a
        JOIN residents r ON r.id = a.resident_id
        WHERE r.facility_id = $1
        GROUP BY resident_id
        HAVING COUNT(*) > 1
      ) t)::float
      /
      NULLIF((SELECT COUNT(*) FROM residents WHERE facility_id = $1), 0) AS rate`,
    [facilityId]
  );

  const { rows: dueRows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE a.due_date = CURRENT_DATE AND a.status != 'completed')::int AS due_today,
       COUNT(*) FILTER (WHERE a.due_date < CURRENT_DATE AND a.status != 'completed')::int AS overdue
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1`,
    [facilityId]
  );

  const { rows: videoRows } = await pool.query(
    `SELECT COUNT(v.id)::int AS videos_total,
            COUNT(DISTINCT v.assessment_id)::int AS assessment_count
     FROM videos v
     JOIN assessments a ON a.id = v.assessment_id
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1`,
    [facilityId]
  );

  const { rows: reportRows } = await pool.query(
    `SELECT COUNT(rp.id)::int AS reports_total,
            COUNT(DISTINCT rp.assessment_id)::int AS assessment_count,
            AVG(EXTRACT(EPOCH FROM (rp.created_at - a.created_at)) / 60) AS avg_minutes
     FROM reports rp
     JOIN assessments a ON a.id = rp.assessment_id
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1 AND rp.report_type = 'assessment'`,
    [facilityId]
  );

  const { rows: fallRows } = await pool.query(
    `WITH events AS (
       SELECT fe.id,
              fe.occurred_at::date AS occurred_date,
              COALESCE(jsonb_array_length(f.fall_checklist), 0) AS required_count
       FROM fall_events fe
       JOIN facilities f ON f.id = fe.facility_id
       WHERE fe.facility_id = $1
         AND fe.occurred_at >= now() - ($2 * interval '1 day')
     ),
     completed AS (
       SELECT fall_event_id, COUNT(DISTINCT check_type) AS completed_count
       FROM post_fall_checks
       WHERE status = 'completed'
       GROUP BY fall_event_id
     )
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE required_count > 0)::int AS required,
       COUNT(*) FILTER (
         WHERE required_count > 0
           AND COALESCE(completed_count, 0) >= required_count
       )::int AS completed,
       COUNT(*) FILTER (
         WHERE required_count > 0
           AND COALESCE(completed_count, 0) < required_count
       )::int AS open,
       COUNT(*) FILTER (
         WHERE required_count > 0
           AND COALESCE(completed_count, 0) < required_count
           AND (occurred_date + $3::int) < CURRENT_DATE
       )::int AS overdue
     FROM events
     LEFT JOIN completed ON completed.fall_event_id = events.id`,
    [facilityId, windowDays, postFallFollowupDays]
  );

  const totalAssessments = totalsRows[0]?.total || 0;
  const completedAssessments = totalsRows[0]?.completed || 0;
  const videoAssessmentCount = videoRows[0]?.assessment_count || 0;
  const reportAssessmentCount = reportRows[0]?.assessment_count || 0;
  const videoCoverageRate = totalAssessments ? Number(videoAssessmentCount) / totalAssessments : 0;
  const reportCoverageRate = totalAssessments ? Number(reportAssessmentCount) / totalAssessments : 0;
  const postFallRequired = fallRows[0]?.required || 0;
  const postFallCompleted = fallRows[0]?.completed || 0;
  const postFallCompletionRate = postFallRequired ? postFallCompleted / postFallRequired : 0;

  res.json({
    window_days: windowDays,
    assessments_per_week: assessmentRows[0]?.count || 0,
    assessments_total: totalAssessments,
    assessments_completed: completedAssessments,
    assessments_high_risk: totalsRows[0]?.high_risk || 0,
    videos_uploaded: videoRows[0]?.videos_total || 0,
    reports_generated: reportRows[0]?.reports_total || 0,
    video_coverage_rate: videoCoverageRate,
    report_coverage_rate: reportCoverageRate,
    avg_time_to_report_minutes: reportRows[0]?.avg_minutes ? Number(reportRows[0].avg_minutes) : 0,
    avg_assessment_minutes: timeRows[0]?.avg_minutes ? Number(timeRows[0].avg_minutes) : 0,
    reassessment_rate: reassessmentRows[0]?.rate ? Number(reassessmentRows[0].rate) : 0,
    assessments_due_today: dueRows[0]?.due_today || 0,
    assessments_overdue: dueRows[0]?.overdue || 0,
    post_fall_total: fallRows[0]?.total || 0,
    post_fall_required: postFallRequired,
    post_fall_completed: postFallCompleted,
    post_fall_open: fallRows[0]?.open || 0,
    post_fall_overdue: fallRows[0]?.overdue || 0,
    post_fall_completion_rate: postFallCompletionRate,
    post_fall_followup_days: postFallFollowupDays,
  });
}));

app.get("/analytics/post-fall-rollup", authMiddleware, asyncHandler(async (req, res) => {
  const facilityId = req.user.facility_id;
  const windowDaysRaw = req.query.days;
  const limitRaw = req.query.limit;
  const unitIdRaw = normalizeString(req.query.unit_id || "");
  const windowDays = windowDaysRaw === undefined ? 30 : Number(windowDaysRaw);
  const limit = limitRaw === undefined ? 50 : Number(limitRaw);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    return res.status(400).json({ message: "Invalid days window" });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return res.status(400).json({ message: "Invalid limit" });
  }
  let unitFilter = null;
  if (unitIdRaw) {
    if (!isUuid(unitIdRaw)) {
      return res.status(400).json({ message: "Invalid unit_id filter" });
    }
    unitFilter = unitIdRaw;
  }
  const rollup = await fetchPostFallRollup({
    facilityId,
    days: windowDays,
    unitId: unitFilter,
    limit,
  });
  res.json(rollup);
}));

app.get("/analytics/outcomes", authMiddleware, asyncHandler(async (req, res) => {
  const facilityId = req.user.facility_id;
  const daysRaw = req.query.days;
  const weeksRaw = req.query.weeks;
  const limitRaw = req.query.limit;
  const windowDays = daysRaw === undefined ? 90 : Number(daysRaw);
  const weeks = weeksRaw === undefined ? 8 : Number(weeksRaw);
  const limit = limitRaw === undefined ? 12 : Number(limitRaw);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
    return res.status(400).json({ message: "Invalid days window" });
  }
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) {
    return res.status(400).json({ message: "Invalid weeks window" });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return res.status(400).json({ message: "Invalid limit" });
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.assessment_date, a.risk_tier, a.status, a.resident_id,
            r.first_name, r.last_name, r.external_id
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1
       AND a.assessment_date >= CURRENT_DATE - ($2 * interval '1 day')
     ORDER BY a.resident_id, a.assessment_date DESC`,
    [facilityId, windowDays]
  );

  const residentMap = new Map();
  rows.forEach((row) => {
    const key = row.resident_id;
    if (!residentMap.has(key)) {
      residentMap.set(key, {
        resident_id: row.resident_id,
        first_name: row.first_name,
        last_name: row.last_name,
        external_id: row.external_id,
        assessments: [],
      });
    }
    residentMap.get(key).assessments.push({
      id: row.id,
      assessment_date: row.assessment_date,
      risk_tier: row.risk_tier,
      status: row.status,
    });
  });

  const trendRank = {
    worsened: 0,
    improved: 1,
    stable: 2,
    unknown: 3,
  };
  const totals = {
    residents: residentMap.size,
    assessed_residents: 0,
    improved: 0,
    worsened: 0,
    stable: 0,
    unknown: 0,
  };
  const residentTrends = [];

  residentMap.forEach((entry) => {
    const assessments = entry.assessments;
    const riskAssessments = assessments.filter((item) => item.risk_tier);
    const latestRisk = riskAssessments[0]?.risk_tier || null;
    const previousRisk = riskAssessments[1]?.risk_tier || null;
    const latestScore = latestRisk ? riskScoreMap[latestRisk] : null;
    const previousScore = previousRisk ? riskScoreMap[previousRisk] : null;
    let trend = "unknown";
    if (latestScore && previousScore) {
      if (latestScore < previousScore) {
        trend = "improved";
      } else if (latestScore > previousScore) {
        trend = "worsened";
      } else {
        trend = "stable";
      }
    }
    if (riskAssessments.length) {
      totals.assessed_residents += 1;
    }
    totals[trend] += 1;

    residentTrends.push({
      resident_id: entry.resident_id,
      first_name: entry.first_name,
      last_name: entry.last_name,
      external_id: entry.external_id,
      latest_risk: latestRisk,
      previous_risk: previousRisk,
      trend,
      last_assessment_date: assessments[0]?.assessment_date || null,
      assessments: assessments.slice(0, 3),
    });
  });

  residentTrends.sort((a, b) => {
    const rank = trendRank[a.trend] - trendRank[b.trend];
    if (rank !== 0) {
      return rank;
    }
    const dateA = a.last_assessment_date ? new Date(a.last_assessment_date) : 0;
    const dateB = b.last_assessment_date ? new Date(b.last_assessment_date) : 0;
    return dateB - dateA;
  });

  const startOfWeek = (value) => {
    const date = new Date(value);
    const day = date.getDay();
    const diff = (day + 6) % 7;
    date.setDate(date.getDate() - diff);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const currentWeek = startOfWeek(new Date());
  const firstWeek = new Date(currentWeek);
  firstWeek.setDate(currentWeek.getDate() - (weeks - 1) * 7);
  const startWeekDate = formatDateOnly(firstWeek);

  const { rows: weekRows } = await pool.query(
    `SELECT date_trunc('week', a.assessment_date)::date AS week_start,
            COUNT(*) FILTER (WHERE a.risk_tier = 'low')::int AS low,
            COUNT(*) FILTER (WHERE a.risk_tier = 'moderate')::int AS moderate,
            COUNT(*) FILTER (WHERE a.risk_tier = 'high')::int AS high
     FROM assessments a
     JOIN residents r ON r.id = a.resident_id
     WHERE r.facility_id = $1
       AND a.assessment_date >= $2
     GROUP BY week_start
     ORDER BY week_start ASC`,
    [facilityId, startWeekDate]
  );

  const weekMap = new Map();
  weekRows.forEach((row) => {
    const key = row.week_start instanceof Date
      ? formatDateOnly(row.week_start)
      : String(row.week_start).slice(0, 10);
    weekMap.set(key, {
      week_start: key,
      low: row.low || 0,
      moderate: row.moderate || 0,
      high: row.high || 0,
    });
  });

  const trendByWeek = [];
  for (let i = 0; i < weeks; i += 1) {
    const cursor = new Date(firstWeek);
    cursor.setDate(firstWeek.getDate() + i * 7);
    const key = formatDateOnly(cursor);
    const snapshot = weekMap.get(key) || {
      week_start: key,
      low: 0,
      moderate: 0,
      high: 0,
    };
    trendByWeek.push({
      ...snapshot,
      total: snapshot.low + snapshot.moderate + snapshot.high,
    });
  }

  res.json({
    window_days: windowDays,
    weeks,
    totals,
    trend_by_week: trendByWeek,
    resident_trends: residentTrends.slice(0, limit),
  });
}));

app.get("/analytics/facility-rollup", authMiddleware, requireRole("admin"), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.city, f.state,
            COALESCE(r.residents, 0)::int AS residents,
            COALESCE(a.assessments_total, 0)::int AS assessments_total,
            COALESCE(a.assessments_completed, 0)::int AS assessments_completed,
            COALESCE(a.assessments_high_risk, 0)::int AS assessments_high_risk,
            COALESCE(a.due_today, 0)::int AS assessments_due_today,
            COALESCE(a.overdue, 0)::int AS assessments_overdue,
            COALESCE(rp.reports_generated, 0)::int AS reports_generated
     FROM facilities f
     LEFT JOIN (
       SELECT facility_id, COUNT(*) AS residents
       FROM residents
       GROUP BY facility_id
     ) r ON r.facility_id = f.id
     LEFT JOIN (
       SELECT r.facility_id,
              COUNT(a.id) AS assessments_total,
              COUNT(*) FILTER (WHERE a.status = 'completed') AS assessments_completed,
              COUNT(*) FILTER (WHERE a.risk_tier = 'high') AS assessments_high_risk,
              COUNT(*) FILTER (WHERE a.due_date = CURRENT_DATE AND a.status != 'completed') AS due_today,
              COUNT(*) FILTER (WHERE a.due_date < CURRENT_DATE AND a.status != 'completed') AS overdue
       FROM assessments a
       JOIN residents r ON r.id = a.resident_id
       GROUP BY r.facility_id
     ) a ON a.facility_id = f.id
    LEFT JOIN (
       SELECT r.facility_id, COUNT(rp.id) AS reports_generated
       FROM reports rp
       JOIN assessments a ON a.id = rp.assessment_id
       JOIN residents r ON r.id = a.resident_id
       WHERE rp.report_type = 'assessment'
       GROUP BY r.facility_id
    ) rp ON rp.facility_id = f.id
     ORDER BY f.name`
  );
  res.json(rows);
}));

app.get("/audit", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const facilityId = req.user.facility_id;
  const limitRaw = req.query.limit;
  const limit = limitRaw === undefined ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ message: "Invalid limit" });
  }
  const filters = ["u.facility_id = $1"];
  const values = [facilityId];
  let index = 2;

  if (req.query.action) {
    const action = normalizeString(req.query.action);
    if (!action) {
      return res.status(400).json({ message: "Invalid action filter" });
    }
    filters.push(`l.action = $${index}`);
    values.push(action);
    index += 1;
  }

  if (req.query.entity_type) {
    const entityType = normalizeString(req.query.entity_type);
    if (!entityType) {
      return res.status(400).json({ message: "Invalid entity_type filter" });
    }
    filters.push(`l.entity_type = $${index}`);
    values.push(entityType);
    index += 1;
  }

  if (req.query.user_id) {
    const userId = normalizeString(req.query.user_id);
    if (!userId) {
      return res.status(400).json({ message: "Invalid user_id filter" });
    }
    filters.push(`l.user_id = $${index}`);
    values.push(userId);
    index += 1;
  }

  if (req.query.from) {
    const fromDate = parseDateTime(req.query.from);
    if (!fromDate) {
      return res.status(400).json({ message: "Invalid from date" });
    }
    filters.push(`l.created_at >= $${index}`);
    values.push(fromDate);
    index += 1;
  }

  if (req.query.to) {
    const toDate = parseDateTime(req.query.to);
    if (!toDate) {
      return res.status(400).json({ message: "Invalid to date" });
    }
    filters.push(`l.created_at <= $${index}`);
    values.push(toDate);
    index += 1;
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT l.id, l.user_id, u.email AS user_email, u.full_name AS user_name, u.role AS user_role,
            l.action, l.entity_type, l.entity_id, l.metadata, l.created_at
     FROM audit_logs l
     JOIN users u ON u.id = l.user_id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${index}`,
    [...values, limit]
  );
  res.json(rows);
}));

async function cleanupOrphanedVideos() {
  if (!fs.existsSync(path.resolve(storageRoot, "videos"))) {
    return;
  }
  const cutoff = Date.now() - orphanCleanupHours * 60 * 60 * 1000;
  const { rows } = await pool.query("SELECT storage_key FROM videos");
  const keep = new Set(rows.map((row) => row.storage_key));

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath);
        }
        continue;
      }
      const stat = fs.statSync(fullPath);
      const relativeKey = normalizeStorageKey(path.relative(storageRoot, fullPath));
      if (!keep.has(relativeKey) && stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
      }
    }
  };

  walk(path.resolve(storageRoot, "videos"));
}

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: `File too large. Max ${maxVideoSizeMb} MB.` });
  }
  if (err && err.code === "23505") {
    return res.status(409).json({ message: "Duplicate record" });
  }
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

app.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`StrideSafe API listening on http://${displayHost}:${port}`);
  console.log(`OpenAPI docs: http://${displayHost}:${port}/docs`);
});

seedDueScanTasks().catch((error) => {
  console.error("Failed to seed due scan tasks", error.message);
});

seedExportScheduleTasks().catch((error) => {
  console.error("Failed to seed export schedule tasks", error.message);
});

if (taskPollIntervalSeconds > 0) {
  setInterval(() => {
    processTaskQueue().catch((error) => {
      console.error("Task processing failed", error.message);
    });
  }, taskPollIntervalSeconds * 1000);
}

if (orphanCleanupIntervalMinutes > 0) {
  setInterval(() => {
    cleanupOrphanedVideos().catch((error) => {
      console.error("Orphan cleanup failed", error.message);
    });
  }, orphanCleanupIntervalMinutes * 60 * 1000);
}
