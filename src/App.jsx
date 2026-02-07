import { useEffect, useRef, useState } from "react";

const getLocaleFromRoute = (route) => (route.startsWith("/es") ? "es" : "en");

const stripLocaleFromRoute = (route, locale) => {
  if (locale !== "es") {
    return route;
  }
  const stripped = route.replace(/^\/es/, "");
  return stripped === "" ? "/" : stripped;
};

const buildHref = (path, locale) => {
  const prefix = locale === "es" ? "/es" : "";
  const normalizedPath = path === "/" ? "" : path;
  if (!prefix && normalizedPath === "") {
    return "#/";
  }
  return `#${prefix}${normalizedPath}`;
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const TOKEN_STORAGE_KEY = "stridesafe_token";
const USER_STORAGE_KEY = "stridesafe_user";
const ONBOARDING_STORAGE_KEY = "stridesafe_onboarding_v1";
const rawMaxVideoSizeMb = Number.parseInt(import.meta.env.VITE_MAX_VIDEO_MB || "", 10);
const MAX_VIDEO_SIZE_MB = Number.isFinite(rawMaxVideoSizeMb) ? rawMaxVideoSizeMb : 100;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

const getStoredValue = (key, fallback = "") => {
  if (typeof window === "undefined") {
    return fallback;
  }
  return window.localStorage.getItem(key) || fallback;
};

const NOTIFICATION_CONFIRM_KEY = "stridesafe_notifications_skip_confirm";

const getStoredJson = (key) => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const sanitizeOnboardingState = (state) => {
  const next = state && typeof state === "object" ? state : {};
  const checks = next.checks && typeof next.checks === "object" ? next.checks : {};
  return {
    completed: Boolean(next.completed),
    dismissed: Boolean(next.dismissed),
    checks,
  };
};

const assertOnboardingStateSafe = (state) => {
  if (!import.meta?.env?.DEV) {
    return;
  }
  const serialized = JSON.stringify(state);
  const suspiciousKeys = [
    "first_name",
    "last_name",
    "dob",
    "resident",
    "video",
    "storage_key",
    "assessment_id",
  ];
  const hit = suspiciousKeys.find((key) => serialized.includes(`"${key}"`));
  if (hit) {
    console.error("Onboarding state contains a PHI key:", hit);
    throw new Error(`Onboarding state contains PHI key: ${hit}`);
  }
};

const formatDate = (value) => {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  const parsed = typeof value === "string" && value.length >= 10
    ? new Date(`${value.slice(0, 10)}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
};

const parseDateOnly = (value) => {
  if (!value) {
    return null;
  }
  const parsed = typeof value === "string" && value.length >= 10
    ? new Date(`${value.slice(0, 10)}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const getAge = (value) => {
  if (!value) {
    return null;
  }
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsed.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
};

const formatPercent = (value) => {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${(value * 100).toFixed(1)}%`;
};

const formatHours = (hours) => {
  if (!Number.isFinite(hours)) {
    return "--";
  }
  const rounded = Math.abs(hours);
  if (rounded >= 48) {
    return `${(hours / 24).toFixed(1)}d`;
  }
  return `${hours.toFixed(1)}h`;
};

const shortenId = (value, size = 8) => {
  if (!value || typeof value !== "string") {
    return "--";
  }
  if (value.length <= size) {
    return value;
  }
  return `${value.slice(0, size)}...`;
};

const formatDateTime = (value) => {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString();
};

const formatInputDateTime = (value) => {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
};

const buildFallEventForm = (resident) => ({
  occurred_at: formatInputDateTime(new Date()),
  building: resident?.building || "",
  floor: resident?.floor || "",
  unit: resident?.unit || "",
  room: resident?.room || "",
  injury_severity: "none",
  ems_called: false,
  hospital_transfer: false,
  witness: "",
  assistive_device: "",
  contributing_factors: "",
  notes: "",
});

const parseNumber = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readVideoMetadata = (file) => new Promise((resolve, reject) => {
  if (!file) {
    reject(new Error("missing_file"));
    return;
  }
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);
  let settled = false;
  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  };
  const finish = (result, error) => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    if (error) {
      reject(error);
    } else {
      resolve(result);
    }
  };
  video.preload = "metadata";
  video.onloadedmetadata = () => {
    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    const width = Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? video.videoWidth : null;
    const height = Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? video.videoHeight : null;
    finish({ durationSeconds, width, height });
  };
  video.onerror = () => finish(null, new Error("metadata_unavailable"));
  video.src = objectUrl;
});

const buildHeaders = ({ token, headers = {}, isJson }) => {
  const next = { ...headers };
  if (token) {
    next.Authorization = `Bearer ${token}`;
  }
  if (isJson) {
    next["Content-Type"] = "application/json";
  }
  return next;
};

const readResponseJson = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
};

const apiRequest = async (path, { method = "GET", body, token, headers } = {}) => {
  const isJson = body && !(body instanceof FormData);
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildHeaders({ token, headers, isJson }),
    body: isJson ? JSON.stringify(body) : body,
  });
  const data = await readResponseJson(response);
  if (!response.ok) {
    const message = data?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
};

const downloadProtected = async (path, token, filename) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders({ token }),
  });
  if (!response.ok) {
    const data = await readResponseJson(response);
    const message = data?.message || `Download failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const fetchBlobUrl = async (path, token) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders({ token }),
  });
  if (!response.ok) {
    const data = await readResponseJson(response);
    const message = data?.message || `Download failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

const uploadWithProgress = (path, token, formData, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}${path}`);
  if (token) {
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
  }
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) {
      return;
    }
    const percent = Math.round((event.loaded / event.total) * 100);
    onProgress(percent);
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
      } catch (error) {
        resolve(null);
      }
      return;
    }
    let message = `Upload failed (${xhr.status})`;
    try {
      const data = JSON.parse(xhr.responseText || "{}");
      message = data.message || message;
    } catch (error) {
      // ignore JSON parsing failures
    }
    const uploadError = new Error(message);
    uploadError.status = xhr.status;
    reject(uploadError);
  };
  xhr.onerror = () => {
    const uploadError = new Error("Network error during upload");
    uploadError.status = 0;
    reject(uploadError);
  };
  xhr.send(formData);
});

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) {
    return "--";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const pickMostRecentAssessmentWithVideo = (assessments = []) => {
  const withVideo = assessments.filter((assessment) => {
    const count = Number(assessment?.video_count || 0);
    return Number.isFinite(count) && count > 0;
  });
  if (withVideo.length === 0) {
    return null;
  }
  return withVideo
    .slice()
    .sort((left, right) => {
      const leftDate = new Date(left.latest_video_at || left.assessment_date || 0).getTime();
      const rightDate = new Date(right.latest_video_at || right.assessment_date || 0).getTime();
      return rightDate - leftDate;
    })[0];
};

const downloadCsv = (filename, headers, rows) => {
  const escapeValue = (value) => {
    if (value === null || value === undefined) {
      return "";
    }
    const stringValue = String(value);
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, "\"\"")}"`;
    }
    return stringValue;
  };
  const csvRows = [
    headers.map(escapeValue).join(","),
    ...rows.map((row) => row.map(escapeValue).join(",")),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const buildQueryString = (params) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "" || value === "all") {
      return;
    }
    search.set(key, value);
  });
  const query = search.toString();
  return query ? `?${query}` : "";
};

const landingStats = [
  { value: "1 in 4", label: "U.S. adults 65+ who fall each year" },
  { value: "3M", label: "ED visits for older adult falls annually" },
  { value: "1M", label: "fall-related hospitalizations each year" },
  { value: "1 in 10", label: "falls cause injury needing care or activity limits" },
];

const landingStatsEs = [
  { value: "1 de 4", label: "adultos de 65+ en EE.UU. se caen cada ano" },
  { value: "3M", label: "visitas a urgencias por caidas al ano" },
  { value: "1M", label: "hospitalizaciones por caidas al ano" },
  { value: "1 de 10", label: "caidas causan lesion que requiere atencion o limitar actividad" },
];

const landingChallenges = [
  "Falls remain a leading cause of injury among older adults",
  "Fall prevention screenings are required but time-consuming",
  "Manual gait assessments can be subjective and inconsistent",
  "Primary care visits are already time constrained",
];

const landingChallengesEs = [
  "Las caidas siguen siendo una de las principales causas de lesiones en adultos mayores",
  "Las evaluaciones de prevencion de caidas son obligatorias pero consumen tiempo",
  "Las evaluaciones manuales de la marcha pueden ser subjetivas e inconsistentes",
  "Las visitas de atencion primaria ya estan limitadas por tiempo",
];

const landingOpportunities = [
  "Reimbursement pathways exist for fall prevention services",
  "Remote Therapeutic Monitoring enables recurring care",
  "Objective mobility data improves outcomes and care plans",
  "Value-based care incentives reward fall reduction",
];

const landingOpportunitiesEs = [
  "Existen vias de reembolso para servicios de prevencion de caidas",
  "El monitoreo terapeutico remoto permite cuidados recurrentes",
  "Los datos objetivos de movilidad mejoran resultados y planes de cuidado",
  "Los incentivos de atencion basada en valor premian la reduccion de caidas",
];

const landingPillars = [
  {
    icon: "insights",
    title: "Objective gait analysis in minutes",
    body: "Turn a smartphone into a motion capture lab with consistent, repeatable results.",
    path: "/gait-lab",
    linkLabel: "See MotionLab",
  },
  {
    icon: "shield",
    title: "Evidence-aligned screening",
    body: "Standardize fall risk screening and intervention planning across teams.",
    path: "/pt-workflow",
    linkLabel: "See StrideSafe TherapyFlow",
  },
  {
    icon: "target",
    title: "Reduce fall risk at scale",
    body: "Deploy a single workflow across senior living, outpatient, and home health.",
    path: "/stridesafe-home",
    linkLabel: "See Home Solution",
  },
];

const landingPillarsEs = [
  {
    icon: "insights",
    title: "Analisis objetivo de la marcha en minutos",
    body: "Convierte un smartphone en un laboratorio de captura de movimiento con resultados consistentes.",
    path: "/gait-lab",
    linkLabel: "Ver MotionLab",
  },
  {
    icon: "shield",
    title: "Evaluacion alineada con evidencia",
    body: "Estandariza la evaluacion de riesgo de caidas y la planificacion de intervencion.",
    path: "/pt-workflow",
    linkLabel: "Ver StrideSafe TherapyFlow",
  },
  {
    icon: "target",
    title: "Reducir el riesgo de caidas a escala",
    body: "Implementa un flujo unico en residencias, ambulatorios y salud en el hogar.",
    path: "/stridesafe-home",
    linkLabel: "Ver Solucion Home",
  },
];

const landingBenefits = [
  {
    title: "RTM and CPT-ready workflows",
    bullets: [
      "Auto-generated documentation for billing support",
      "Objective measures and longitudinal tracking",
      "Staff-friendly workflows that scale across sites",
    ],
    highlight: "Supports common CPT and RTM pathways",
  },
  {
    title: "Consistent, clinician-grade assessments",
    bullets: [
      "Standardized scores across evaluators",
      "Risk stratification in minutes",
      "Clear insights for care planning",
    ],
    highlight: "Built for clinical consistency",
  },
  {
    title: "Operational savings and ROI",
    bullets: [
      "Reduce manual assessment time",
      "Increase daily capacity without added staff",
      "Improve outcomes reporting and compliance",
    ],
    highlight: "Designed to pay for itself",
  },
];

const landingBenefitsEs = [
  {
    title: "Flujos listos para RTM y CPT",
    bullets: [
      "Documentacion autogenerada para soporte de facturacion",
      "Mediciones objetivas y seguimiento longitudinal",
      "Flujos faciles para el personal que escalan entre sitios",
    ],
    highlight: "Compatibles con rutas CPT y RTM comunes",
  },
  {
    title: "Evaluaciones consistentes de nivel clinico",
    bullets: [
      "Puntuaciones estandarizadas entre evaluadores",
      "Estratificacion de riesgo en minutos",
      "Insights claros para planificar el cuidado",
    ],
    highlight: "Disenado para consistencia clinica",
  },
  {
    title: "Ahorros operativos y ROI",
    bullets: [
      "Reducir tiempo de evaluacion manual",
      "Aumentar capacidad diaria sin mas personal",
      "Mejorar reportes de resultados y cumplimiento",
    ],
    highlight: "Disenado para pagar su propio costo",
  },
];

const reimbursementBlocks = [
  {
    title: "In-clinic assessment",
    tag: "CPT 97750, 97116",
    body: "Support documentation for physical performance tests and gait training when medically necessary.",
    bullets: [
      "Auto-generated summaries",
      "Time-stamped evaluation notes",
      "Objective gait parameters",
    ],
  },
  {
    title: "Primary care integration",
    tag: "Annual wellness workflows",
    body: "Streamline fall risk screening within primary care visits using structured reports.",
    bullets: [
      "Standardized screening protocol",
      "Risk stratification in minutes",
      "Shareable summaries for care teams",
    ],
  },
  {
    title: "Remote therapeutic monitoring",
    tag: "CPT 98975-98981",
    body: "Enable recurring monitoring with patient engagement and longitudinal tracking.",
    bullets: [
      "Monthly patient tracking",
      "Progress dashboards",
      "Exportable documentation",
    ],
  },
];

const reimbursementBlocksEs = [
  {
    title: "Evaluacion en clinica",
    tag: "CPT 97750, 97116",
    body: "Soporta documentacion para pruebas de rendimiento fisico y entrenamiento de marcha cuando es necesario.",
    bullets: [
      "Resumenes autogenerados",
      "Notas de evaluacion con sello de tiempo",
      "Parametros objetivos de marcha",
    ],
  },
  {
    title: "Integracion en atencion primaria",
    tag: "Flujos de bienestar anual",
    body: "Agiliza la evaluacion de riesgo de caidas en visitas de atencion primaria con informes estructurados.",
    bullets: [
      "Protocolo de evaluacion estandarizado",
      "Estratificacion de riesgo en minutos",
      "Resumenes compartibles para equipos de cuidado",
    ],
  },
  {
    title: "Monitoreo terapeutico remoto",
    tag: "CPT 98975-98981",
    body: "Permite monitoreo recurrente con participacion del paciente y seguimiento longitudinal.",
    bullets: [
      "Seguimiento mensual del paciente",
      "Paneles de progreso",
      "Documentacion exportable",
    ],
  },
];

const landingSteps = [
  {
    icon: "camera",
    label: "Step 1",
    title: "Record (25 seconds)",
    bullets: [
      "Capture a short walk with any smartphone",
      "Works with assistive devices",
      "Can be performed by trained staff",
    ],
  },
  {
    icon: "scan",
    label: "Step 2",
    title: "Assess (2 minutes)",
    bullets: [
      "AI analyzes gait parameters automatically",
      "Instant risk scoring with clear indicators",
      "Objective results for consistent scoring",
    ],
  },
  {
    icon: "plan",
    label: "Step 3",
    title: "Intervene (2 minutes)",
    bullets: [
      "Evidence-based recommendations",
      "Care plan summary and next steps",
      "Documentation ready to export",
    ],
  },
];

const landingStepsEs = [
  {
    icon: "camera",
    label: "Paso 1",
    title: "Grabar (25 segundos)",
    bullets: [
      "Captura una caminata corta con cualquier smartphone",
      "Funciona con dispositivos de asistencia",
      "Puede realizarlo personal capacitado",
    ],
  },
  {
    icon: "scan",
    label: "Paso 2",
    title: "Evaluar (2 minutos)",
    bullets: [
      "La IA analiza parametros de marcha automaticamente",
      "Puntuacion de riesgo instantanea con indicadores claros",
      "Resultados objetivos para puntuaciones consistentes",
    ],
  },
  {
    icon: "plan",
    label: "Paso 3",
    title: "Intervenir (2 minutos)",
    bullets: [
      "Recomendaciones basadas en evidencia",
      "Resumen del plan de cuidado y proximos pasos",
      "Documentacion lista para exportar",
    ],
  },
];

const landingImpact = [
  { value: "41,400", label: "older adult fall deaths (2023)" },
  { value: "69.9 / 100k", label: "fall death rate for 65+ (2023)" },
  { value: "339.5 / 100k", label: "fall death rate for age 85+ (2023)" },
  { value: "319,000", label: "older adults hospitalized for hip fractures yearly" },
];

const landingImpactEs = [
  { value: "41,400", label: "muertes por caidas en 2023 (65+)" },
  { value: "69.9 / 100k", label: "tasa de muertes por caidas en 65+ (2023)" },
  { value: "339.5 / 100k", label: "tasa de muertes por caidas en 85+ (2023)" },
  { value: "319,000", label: "adultos mayores hospitalizados por fracturas de cadera al ano" },
];

const aboutStats = [
  { value: "2-3 min", label: "average screening time" },
  { value: "14", label: "mobility factors tracked" },
  { value: "3", label: "care settings served" },
  { value: "SOC 2", label: "Type II-aligned security" },
];

const aboutStatsEs = [
  { value: "2-3 min", label: "tiempo promedio de evaluacion" },
  { value: "14", label: "factores de movilidad seguidos" },
  { value: "3", label: "entornos de atencion" },
  { value: "SOC 2", label: "seguridad tipo II" },
];

const aboutHighlights = [
  {
    icon: "insights",
    title: "Objective mobility insights",
    body: "Standardize fall-risk screening with consistent, quantifiable gait data.",
  },
  {
    icon: "doc",
    title: "Documentation-ready reporting",
    body: "Auto-generated summaries support care planning and reimbursement workflows.",
  },
  {
    icon: "shield",
    title: "Security-first platform",
    body: "Designed for HIPAA-aligned workflows with SOC 2 Type II controls.",
  },
  {
    icon: "target",
    title: "Operational clarity",
    body: "Give clinical leaders visibility across sites, teams, and outcomes.",
  },
  {
    icon: "home",
    title: "Built for US care settings",
    body: "Designed with senior living, home health, and outpatient PT in mind.",
  },
  {
    icon: "badge",
    title: "Clinician-led approach",
    body: "Workflows shaped by PTs and care teams to fit real operations.",
  },
];

const aboutHighlightsEs = [
  {
    icon: "insights",
    title: "Insights objetivos de movilidad",
    body: "Estandariza la evaluacion de riesgo de caidas con datos de marcha cuantificables.",
  },
  {
    icon: "doc",
    title: "Reportes listos para documentacion",
    body: "Resumenes autogenerados que apoyan planes de cuidado y reembolso.",
  },
  {
    icon: "shield",
    title: "Plataforma con seguridad primero",
    body: "Disenada para flujos HIPAA con controles SOC 2 Tipo II.",
  },
  {
    icon: "target",
    title: "Claridad operativa",
    body: "Visibilidad para lideres clinicos en sitios, equipos y resultados.",
  },
  {
    icon: "home",
    title: "Pensada para EE.UU.",
    body: "Disenada para residencias, salud en el hogar y PT ambulatorio.",
  },
  {
    icon: "badge",
    title: "Enfoque liderado por clinicos",
    body: "Flujos definidos con PT y equipos de cuidado en operaciones reales.",
  },
];

const aboutPrinciples = [
  "Clinical rigor over vanity metrics",
  "Simple workflows that scale across care teams",
  "Evidence-based recommendations, not guesswork",
  "Respect for privacy, consent, and data stewardship",
];

const aboutPrinciplesEs = [
  "Rigor clinico sobre metricas de vanidad",
  "Flujos simples que escalan entre equipos",
  "Recomendaciones basadas en evidencia, no conjeturas",
  "Respeto por privacidad, consentimiento y uso de datos",
];

const aboutTimeline = [
  {
    title: "Capture",
    body: "A 25-30 second video with a smartphone.",
  },
  {
    title: "Analyze",
    body: "Automated gait analysis with validated mobility parameters.",
  },
  {
    title: "Assess",
    body: "Objective risk tiering with clear indicators.",
  },
  {
    title: "Act",
    body: "Care plan recommendations and documentation for teams.",
  },
];

const aboutTimelineEs = [
  {
    title: "Captura",
    body: "Un video de 25-30 segundos con smartphone.",
  },
  {
    title: "Analiza",
    body: "Analisis automatico con parametros validados.",
  },
  {
    title: "Evalua",
    body: "Clasificacion de riesgo con indicadores claros.",
  },
  {
    title: "Actua",
    body: "Recomendaciones y documentacion para equipos.",
  },
];

const featureHighlights = [
  {
    icon: "phone",
    title: "Smartphone-based movement analysis",
    body: "Capture a short video at home. No sensors, no external cameras.",
  },
  {
    icon: "layers",
    title: "14 mobility assessment factors",
    body: "Comprehensive movement evaluation using scientifically validated parameters.",
  },
  {
    icon: "insights",
    title: "Simple visual indicator system",
    body: "Easy-to-understand mobility insights to support aging-in-place conversations.",
  },
  {
    icon: "assist",
    title: "Mobility aids welcome",
    body: "Works with walkers, canes, and caregiver assistance - no problem.",
  },
  {
    icon: "home",
    title: "Supporting independent living",
    body: "Receive personalized wellness insights with each assessment.",
  },
  {
    icon: "shield",
    title: "Evidence-based technology",
    body: "Built on peer-reviewed research and clinical validation.",
  },
];

const featureHighlightsEs = [
  {
    icon: "phone",
    title: "Analisis de movimiento con smartphone",
    body: "Captura un video corto en casa. Sin sensores ni camaras externas.",
  },
  {
    icon: "layers",
    title: "14 factores de evaluacion de movilidad",
    body: "Evaluacion completa basada en parametros validados.",
  },
  {
    icon: "insights",
    title: "Indicadores visuales simples",
    body: "Insights faciles de entender para conversaciones de cuidado.",
  },
  {
    icon: "assist",
    title: "Se admiten ayudas de movilidad",
    body: "Funciona con andadores, bastones y asistencia del cuidador.",
  },
  {
    icon: "home",
    title: "Apoyo a la vida independiente",
    body: "Recibe insights personalizados en cada evaluacion.",
  },
  {
    icon: "shield",
    title: "Tecnologia basada en evidencia",
    body: "Construida con investigacion revisada por pares y validacion clinica.",
  },
];

const processSteps = [
  {
    icon: "camera",
    title: "Record a short movement sequence",
    body: "Stand up, take three steps, return, and sit. The app guides the capture.",
  },
  {
    icon: "survey",
    title: "Answer a short lifestyle questionnaire",
    body: "Simple questions about daily routines help contextualize the analysis.",
  },
  {
    icon: "trend",
    title: "Review insights and progress",
    body: "Get a mobility overview and educational recommendations to discuss.",
  },
];

const processStepsEs = [
  {
    icon: "camera",
    title: "Graba una secuencia corta",
    body: "Levantate, da tres pasos, regresa y sientate. La app guia la captura.",
  },
  {
    icon: "survey",
    title: "Responde un breve cuestionario",
    body: "Preguntas simples contextualizan el analisis.",
  },
  {
    icon: "trend",
    title: "Revisa insights y progreso",
    body: "Obtiene un resumen de movilidad y recomendaciones educativas.",
  },
];

const detailCards = [
  {
    icon: "video",
    title: "Video capture",
    body: "A 40-second smartphone video captures the full movement pattern.",
  },
  {
    icon: "heart",
    title: "Health and lifestyle",
    body: "Guided questions build a holistic mobility picture.",
  },
  {
    icon: "grid",
    title: "Six categories",
    body: "Movement, strength, balance, environment, medication, and lifestyle factors.",
  },
  {
    icon: "insights",
    title: "Ongoing insights",
    body: "Track trends over time and access age-appropriate exercise guidance.",
  },
];

const detailCardsEs = [
  {
    icon: "video",
    title: "Captura de video",
    body: "Un video de 40 segundos captura el patron completo de movimiento.",
  },
  {
    icon: "heart",
    title: "Salud y estilo de vida",
    body: "Preguntas guiadas crean una vision integral de movilidad.",
  },
  {
    icon: "grid",
    title: "Seis categorias",
    body: "Movimiento, fuerza, equilibrio, entorno, medicacion y estilo de vida.",
  },
  {
    icon: "insights",
    title: "Insights continuos",
    body: "Sigue tendencias y accede a guias de ejercicio por edad.",
  },
];

const featuredIn = [
  "Home Health Review",
  "Senior Living Today",
  "Aging Care Digest",
  "Rehab and Mobility",
  "U.S. Health Innovations",
];

const featuredInEs = [
  "Home Health Review",
  "Senior Living Today",
  "Aging Care Digest",
  "Rehab and Mobility",
  "U.S. Health Innovations",
];

const pricing = [
  {
    title: "One-time mobility evaluation",
    subtitle: "No subscription, no commitment",
    price: "$21.99",
    cadence: "one-time",
    features: [
      "14 mobility-related lifestyle factors",
      "Research-validated technology",
      "Personalized wellness summary",
      "Educational movement guidance",
    ],
  },
  {
    title: "6-month mobility tracking",
    subtitle: "Progress monitoring built-in",
    price: "$8.99",
    cadence: "per month",
    featured: true,
    features: [
      "Up to 6 movement evaluations",
      "Progress tracking reports",
      "Tailored exercise education",
      "Updates with each assessment",
    ],
  },
  {
    title: "Ongoing mobility tracking",
    subtitle: "Unlimited assessments",
    price: "$6.99",
    cadence: "per month",
    features: [
      "Unlimited movement evaluations",
      "Comprehensive 14-factor review",
      "Updated wellness summaries",
      "Trend analysis and insights",
    ],
  },
];

const pricingEs = [
  {
    title: "Evaluacion unica de movilidad",
    subtitle: "Sin suscripcion, sin compromiso",
    price: "$21.99",
    cadence: "pago unico",
    features: [
      "14 factores de movilidad y estilo de vida",
      "Tecnologia validada por investigacion",
      "Resumen de bienestar personalizado",
      "Guia educativa de movimiento",
    ],
  },
  {
    title: "Seguimiento de movilidad por 6 meses",
    subtitle: "Monitoreo de progreso incluido",
    price: "$8.99",
    cadence: "por mes",
    featured: true,
    features: [
      "Hasta 6 evaluaciones de movimiento",
      "Reportes de seguimiento",
      "Educacion de ejercicios personalizada",
      "Actualizaciones en cada evaluacion",
    ],
  },
  {
    title: "Seguimiento continuo de movilidad",
    subtitle: "Evaluaciones ilimitadas",
    price: "$6.99",
    cadence: "por mes",
    features: [
      "Evaluaciones de movimiento ilimitadas",
      "Revision completa de 14 factores",
      "Resumenes actualizados de bienestar",
      "Analisis de tendencias e insights",
    ],
  },
];

const faqs = [
  {
    question: "What smartphone or tablet is required?",
    answer:
      "A recent iOS or Android device with a camera and a stable internet connection. App Store listings include the latest device requirements.",
  },
  {
    question: "How do I get the app?",
    answer:
      "Download the StrideSafe Home App from the Apple App Store or Google Play Store and follow the in-app setup.",
  },
  {
    question: "How long does an assessment take?",
    answer:
      "Most assessments take about 7 minutes, including the video capture and short questionnaire.",
  },
  {
    question: "Is the data secure?",
    answer:
      "Designed to support HIPAA-aligned privacy practices with encryption in transit and at rest.",
  },
];

const faqsEs = [
  {
    question: "Que smartphone o tablet se requiere?",
    answer:
      "Un dispositivo iOS o Android reciente con camara y conexion estable. Las tiendas incluyen requisitos actualizados.",
  },
  {
    question: "Como obtengo la app?",
    answer:
      "Descarga la app StrideSafe Home desde App Store o Google Play y sigue la configuracion.",
  },
  {
    question: "Cuanto dura una evaluacion?",
    answer:
      "La mayoria tarda unos 7 minutos, incluyendo video y cuestionario.",
  },
  {
    question: "Los datos son seguros?",
    answer:
      "Disenado para practicas HIPAA con cifrado en transito y en reposo.",
  },
];

const ptHighlights = [
  { value: "90% faster", label: "assessment time" },
  { value: "75% savings", label: "workflow cost reduction" },
  { value: "Clinical-grade", label: "precision and consistency" },
];

const ptHighlightsEs = [
  { value: "90% mas rapido", label: "tiempo de evaluacion" },
  { value: "75% ahorro", label: "reduccion de costos" },
  { value: "Nivel clinico", label: "precision y consistencia" },
];

const ptChallenges = [
  {
    icon: "clock",
    title: "Time constraints",
    body: "Traditional assessments can take 20-45 minutes per resident, making high caseloads hard to manage.",
  },
  {
    icon: "dollar",
    title: "Limited reimbursement",
    body: "Manual workflows cap how many billable evaluations you can deliver per day.",
  },
  {
    icon: "target",
    title: "Subjective results",
    body: "Observation-based scoring varies between clinicians, reducing comparability over time.",
  },
];

const ptChallengesEs = [
  {
    icon: "clock",
    title: "Restricciones de tiempo",
    body: "Las evaluaciones tradicionales pueden tomar 20-45 minutos por residente.",
  },
  {
    icon: "dollar",
    title: "Reembolso limitado",
    body: "Los flujos manuales limitan cuantas evaluaciones facturables haces al dia.",
  },
  {
    icon: "target",
    title: "Resultados subjetivos",
    body: "La observacion varia entre clinicos y reduce la comparabilidad.",
  },
];

const ptSteps = [
  {
    icon: "camera",
    label: "Step 1",
    title: "Quick video capture (30 seconds)",
    bullets: [
      "Record a short walk from a smartphone or tablet",
      "No special equipment or markers needed",
      "Can be performed by PT, PTA, or trained staff",
    ],
  },
  {
    icon: "scan",
    label: "Step 2",
    title: "Instant AI analysis (90 seconds)",
    bullets: [
      "Frame-by-frame analysis generates a 3D model",
      "Calculates key gait parameters automatically",
      "Consistent results across clinicians",
    ],
  },
  {
    icon: "shield",
    label: "Step 3",
    title: "Comprehensive risk assessment",
    bullets: [
      "Multifactor risk score with clear indicators",
      "Risk profile highlights specific concerns",
      "Objective tracking across visits",
    ],
  },
  {
    icon: "plan",
    label: "Step 4",
    title: "Personalized care plan",
    bullets: [
      "Evidence-based recommendations",
      "Exercise guidance with clear next steps",
      "Printable summary for residents and teams",
    ],
  },
  {
    icon: "doc",
    label: "Step 5",
    title: "Documentation and billing support",
    bullets: [
      "Auto-generated clinical summaries",
      "Supports CPT-ready documentation",
      "Exportable for EHR workflows",
    ],
  },
];

const ptStepsEs = [
  {
    icon: "camera",
    label: "Paso 1",
    title: "Captura rapida de video (30 segundos)",
    bullets: [
      "Graba una caminata corta con smartphone o tablet",
      "No se necesitan equipos especiales",
      "Puede hacerlo PT, PTA o personal capacitado",
    ],
  },
  {
    icon: "scan",
    label: "Paso 2",
    title: "Analisis de IA instantaneo (90 segundos)",
    bullets: [
      "Analisis cuadro a cuadro genera un modelo 3D",
      "Calcula parametros clave automaticamente",
      "Resultados consistentes entre clinicos",
    ],
  },
  {
    icon: "shield",
    label: "Paso 3",
    title: "Evaluacion de riesgo integral",
    bullets: [
      "Puntaje multifactor con indicadores claros",
      "Perfil de riesgo con hallazgos clave",
      "Seguimiento objetivo entre visitas",
    ],
  },
  {
    icon: "plan",
    label: "Paso 4",
    title: "Plan de cuidado personalizado",
    bullets: [
      "Recomendaciones basadas en evidencia",
      "Guia de ejercicios con proximos pasos",
      "Resumen imprimible para residentes y equipos",
    ],
  },
  {
    icon: "doc",
    label: "Paso 5",
    title: "Documentacion y soporte de facturacion",
    bullets: [
      "Resumenes clinicos autogenerados",
      "Soporta documentacion CPT",
      "Exportable para flujos EHR",
    ],
  },
];

const ptValidation = [
  {
    icon: "badge",
    title: "Published research",
    body: "Peer-reviewed validation against clinical gait standards and strong reliability.",
  },
  {
    icon: "insights",
    title: "Real-world evidence",
    body: "Used across senior living settings to track outcomes and reduce fall risk.",
  },
  {
    icon: "shield",
    title: "Regulatory readiness",
    body: "HIPAA-aligned, SOC 2 Type II, and integration-ready for care teams.",
  },
];

const ptValidationEs = [
  {
    icon: "badge",
    title: "Investigacion publicada",
    body: "Validacion revisada por pares con estandares clinicos de marcha.",
  },
  {
    icon: "insights",
    title: "Evidencia en el mundo real",
    body: "Usado en residencias para medir resultados y reducir riesgo.",
  },
  {
    icon: "shield",
    title: "Preparado para regulacion",
    body: "HIPAA, SOC 2 Tipo II e integracion lista para equipos.",
  },
];

const adminReviewStats = [
  { value: "24", label: "assessments pending review" },
  { value: "6", label: "high-risk flags today" },
  { value: "92%", label: "on-time QA completion" },
  { value: "2.1 hrs", label: "median review time" },
];

const adminReviewStatsEs = [
  { value: "24", label: "evaluaciones pendientes" },
  { value: "6", label: "alertas de alto riesgo hoy" },
  { value: "92%", label: "QA en tiempo" },
  { value: "2.1 hrs", label: "tiempo medio de revision" },
];

const adminReviewKpis = [
  { value: "18", label: "needs review" },
  { value: "5", label: "in review" },
  { value: "4", label: "overdue" },
  { value: "3.4", label: "avg fall risk score" },
];

const adminReviewKpisEs = [
  { value: "18", label: "por revisar" },
  { value: "5", label: "en revision" },
  { value: "4", label: "vencidas" },
  { value: "3.4", label: "puntaje promedio" },
];

const adminReviewQueue = [
  {
    id: "ASMT-1042",
    resident: "Evelyn Rogers",
    facility: "Sunrise Senior Living",
    risk: "high",
    tug: "15.2s",
    status: "needs_review",
    updated: "Today, 9:12 AM",
  },
  {
    id: "ASMT-1041",
    resident: "Marvin Cole",
    facility: "Bayview Rehab",
    risk: "moderate",
    tug: "13.4s",
    status: "in_review",
    updated: "Today, 8:38 AM",
  },
  {
    id: "ASMT-1039",
    resident: "Helen Park",
    facility: "CareBridge Home Health",
    risk: "high",
    tug: "16.1s",
    status: "needs_review",
    updated: "Yesterday, 4:05 PM",
  },
  {
    id: "ASMT-1037",
    resident: "Robert Hayes",
    facility: "Sunrise Senior Living",
    risk: "low",
    tug: "10.8s",
    status: "completed",
    updated: "Yesterday, 1:22 PM",
  },
  {
    id: "ASMT-1034",
    resident: "Maria Lewis",
    facility: "Pacific Ortho Clinic",
    risk: "moderate",
    tug: "12.9s",
    status: "needs_review",
    updated: "Feb 3, 2:11 PM",
  },
];

const adminReviewQueueEs = [
  {
    id: "ASMT-1042",
    resident: "Evelyn Rogers",
    facility: "Sunrise Senior Living",
    risk: "high",
    tug: "15.2s",
    status: "needs_review",
    updated: "Hoy, 9:12 AM",
  },
  {
    id: "ASMT-1041",
    resident: "Marvin Cole",
    facility: "Bayview Rehab",
    risk: "moderate",
    tug: "13.4s",
    status: "in_review",
    updated: "Hoy, 8:38 AM",
  },
  {
    id: "ASMT-1039",
    resident: "Helen Park",
    facility: "CareBridge Home Health",
    risk: "high",
    tug: "16.1s",
    status: "needs_review",
    updated: "Ayer, 4:05 PM",
  },
  {
    id: "ASMT-1037",
    resident: "Robert Hayes",
    facility: "Sunrise Senior Living",
    risk: "low",
    tug: "10.8s",
    status: "completed",
    updated: "Ayer, 1:22 PM",
  },
  {
    id: "ASMT-1034",
    resident: "Maria Lewis",
    facility: "Pacific Ortho Clinic",
    risk: "moderate",
    tug: "12.9s",
    status: "needs_review",
    updated: "3 feb, 2:11 PM",
  },
];

const adminReviewAlerts = [
  "2 assessments missing video metadata",
  "1 high-risk case without care plan",
  "3 reports pending physician signature",
];

const adminReviewAlertsEs = [
  "2 evaluaciones sin metadatos de video",
  "1 caso de alto riesgo sin plan de cuidado",
  "3 reportes pendientes de firma medica",
];

const adminReviewFilters = {
  status: ["all", "needs_review", "in_review", "completed"],
  risk: ["high", "moderate", "low"],
  facilities: ["Sunrise Senior Living", "Bayview Rehab", "CareBridge Home Health"],
  reviewers: ["Clinical QA", "PT Lead", "Medical Director"],
};

const adminTabs = ["all", "needs_review", "in_review", "completed"];

const adminStatusClass = {
  needs_review: "status-pill status-open",
  in_review: "status-pill status-review",
  completed: "status-pill status-done",
};

const adminRiskClass = {
  high: "risk-pill risk-high",
  moderate: "risk-pill risk-moderate",
  low: "risk-pill risk-low",
};

const adminStatusLabels = {
  en: {
    all: "All",
    needs_review: "Needs review",
    in_review: "In review",
    completed: "Completed",
  },
  es: {
    all: "Todo",
    needs_review: "Por revisar",
    in_review: "En revision",
    completed: "Completado",
  },
};

const adminRiskLabels = {
  en: { all: "All", high: "High", moderate: "Moderate", low: "Low" },
  es: { all: "Todo", high: "Alto", moderate: "Moderado", low: "Bajo" },
};

const adminReviewDetails = {
  "ASMT-1042": {
    age: 81,
    device: "Walker",
    flags: ["Balance below threshold", "Left stride variability"],
    notes: "Recommend PT follow-up within 2 weeks. Resident reports recent dizziness.",
    nextSteps: ["Schedule PT consult", "Notify facility RN", "Add fall prevention plan"],
  },
  "ASMT-1041": {
    age: 76,
    device: "None",
    flags: ["Moderate TUG time", "Reports knee pain"],
    notes: "Continue monitoring. Consider orthopedic consult.",
    nextSteps: ["Add home exercise plan", "Reassess in 30 days"],
  },
  "ASMT-1039": {
    age: 84,
    device: "Cane",
    flags: ["High risk score", "Chair stand below 10th percentile"],
    notes: "Coordinate care plan and review medication list.",
    nextSteps: ["Escalate to care manager", "Schedule OT visit"],
  },
};

const adminReviewDetailsEs = {
  "ASMT-1042": {
    age: 81,
    device: "Andador",
    flags: ["Equilibrio bajo umbral", "Variabilidad de zancada izquierda"],
    notes: "Recomendar seguimiento de PT en 2 semanas. Reporta mareos recientes.",
    nextSteps: ["Programar consulta PT", "Notificar RN del centro", "Agregar plan de prevencion"],
  },
  "ASMT-1041": {
    age: 76,
    device: "Ninguno",
    flags: ["Tiempo TUG moderado", "Reporta dolor de rodilla"],
    notes: "Continuar monitoreo. Considerar consulta ortopedica.",
    nextSteps: ["Agregar plan de ejercicios en casa", "Reevaluar en 30 dias"],
  },
  "ASMT-1039": {
    age: 84,
    device: "Baston",
    flags: ["Puntaje de alto riesgo", "Chair stand bajo percentil 10"],
    notes: "Coordinar plan de cuidado y revisar medicacion.",
    nextSteps: ["Escalar a gestor de cuidado", "Programar visita de OT"],
  },
};

const gaitStats = [
  { value: "47+", label: "movement parameters" },
  { value: "3D", label: "pose tracking" },
];

const gaitStatsEs = [
  { value: "47+", label: "parametros de movimiento" },
  { value: "3D", label: "seguimiento de pose" },
];

const gaitHighlights = [
  {
    icon: "phone",
    title: "Gait lab via smartphone",
    body: "No additional sensors or specialized cameras required.",
  },
  {
    icon: "badge",
    title: "Clinical-grade precision",
    body: "Validated gait parameters with consistent, repeatable results.",
  },
  {
    icon: "doc",
    title: "Integration-ready",
    body: "Exportable reports designed for clinical documentation workflows.",
  },
  {
    icon: "trend",
    title: "Progress tracking",
    body: "Create longitudinal data series to monitor change over time.",
  },
  {
    icon: "insights",
    title: "Decision support",
    body: "Turn movement data into actionable care insights.",
  },
  {
    icon: "dollar",
    title: "Cost-efficient",
    body: "A fraction of traditional multi-camera gait lab costs.",
  },
  {
    icon: "home",
    title: "Real-world data",
    body: "Capture movement in clinics, gyms, or home settings.",
  },
  {
    icon: "shield",
    title: "Compliance-ready",
    body: "Built for secure, HIPAA-aligned deployments.",
  },
];

const gaitHighlightsEs = [
  {
    icon: "phone",
    title: "Laboratorio de marcha en smartphone",
    body: "Sin sensores adicionales ni camaras especializadas.",
  },
  {
    icon: "badge",
    title: "Precision de nivel clinico",
    body: "Parametros validados con resultados consistentes.",
  },
  {
    icon: "doc",
    title: "Listo para integracion",
    body: "Reportes exportables para flujos clinicos.",
  },
  {
    icon: "trend",
    title: "Seguimiento de progreso",
    body: "Crea series longitudinales para monitorear cambios.",
  },
  {
    icon: "insights",
    title: "Soporte de decisiones",
    body: "Convierte datos en insights accionables.",
  },
  {
    icon: "dollar",
    title: "Costo eficiente",
    body: "Una fraccion del costo de laboratorios tradicionales.",
  },
  {
    icon: "home",
    title: "Datos del mundo real",
    body: "Captura movimiento en clinicas, gimnasios o hogares.",
  },
  {
    icon: "shield",
    title: "Listo para cumplimiento",
    body: "Despliegues seguros alineados con HIPAA.",
  },
];

const gaitPartners = [
  "Rehab networks",
  "University labs",
  "Sports medicine clinics",
  "Senior living operators",
  "Telehealth providers",
];

const gaitPartnersEs = [
  "Redes de rehabilitacion",
  "Laboratorios universitarios",
  "Clinicas de medicina deportiva",
  "Operadores de residencias",
  "Proveedores de telesalud",
];

const gaitBenefits = ["No sensors", "No extra cameras", "AI-powered", "Clinical-grade"];

const gaitBenefitsEs = ["Sin sensores", "Sin camaras extra", "Impulsado por IA", "Nivel clinico"];

const gaitProgressPoints = [
  "Capture key gait parameters in a single session",
  "Track step length, symmetry, and velocity over time",
  "Generate progress charts automatically",
  "Visualize changes with customizable dashboards",
  "Identify trends and improvement potential quickly",
  "Support rehab, orthopedics, sports, and therapy programs",
  "Provide objective documentation for care plans",
];

const gaitProgressPointsEs = [
  "Captura parametros clave de marcha en una sola sesion",
  "Sigue longitud de paso, simetria y velocidad con el tiempo",
  "Genera graficas de progreso automaticamente",
  "Visualiza cambios con paneles personalizables",
  "Identifica tendencias y oportunidades rapidamente",
  "Soporta programas de rehab, ortopedia, deporte y terapia",
  "Provee documentacion objetiva para planes de cuidado",
];

const gaitFaq = [
  {
    question: "What does StrideSafe MotionLab cost?",
    answer:
      "We tailor pricing to your use case. Costs include setup for app deployment or integration plus licensing.",
  },
  {
    question: "How does it differ from open-source tools?",
    answer:
      "StrideSafe MotionLab delivers real-time 3D pose tracking, multi-person detection, validated gait parameters, range-of-motion analysis, and clinical documentation support.",
  },
  {
    question: "Who is StrideSafe MotionLab designed for?",
    answer:
      "Clinicians, therapists, researchers, orthopedists, and performance teams who need validated movement analysis without traditional gait lab hardware.",
  },
];

const gaitFaqEs = [
  {
    question: "Cuanto cuesta StrideSafe MotionLab?",
    answer:
      "Ajustamos el precio segun el caso. Incluye implementacion, integracion y licencias.",
  },
  {
    question: "En que se diferencia de herramientas open-source?",
    answer:
      "Entrega seguimiento 3D en tiempo real, deteccion multi-persona, parametros validados y soporte clinico.",
  },
  {
    question: "Para quien esta disenado StrideSafe MotionLab?",
    answer:
      "Para clinicos, terapeutas, investigadores y equipos que requieren analisis validado sin hardware especializado.",
  },
];

const iconMap = {
  phone: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M10 17h4" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4 7l8 4 8-4-8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 17 8 4 8-4" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V5" />
      <path d="M8 19V9" />
      <path d="M12 19V13" />
      <path d="M16 19V7" />
      <path d="M20 19V11" />
    </svg>
  ),
  assist: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a4 4 0 0 1 0 8" />
      <path d="M6 21v-2a6 6 0 0 1 12 0v2" />
      <path d="M3 12h4" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10 12 3l9 7" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 6v6c0 5 7 9 7 9s7-4 7-9V6l-7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h3l2-2h6l2 2h3v12H4Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  ),
  survey: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 12h8" />
      <path d="M8 17h5" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 16l6-6 4 4 6-8" />
      <path d="M20 8v5h-5" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="m17 10 4-2v8l-4-2" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10Z" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v18" />
      <path d="M16 7a4 4 0 0 0-4-2H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6h-3a4 4 0 0 1-4-2" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  scan: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M8 12h8" />
    </svg>
  ),
  plan: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12v16H6z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  ),
  badge: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="10" r="5" />
      <path d="m9 14-2 7 5-3 5 3-2-7" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
};

function Icon({ name }) {
  return <span className="icon">{iconMap[name]}</span>;
}

function AppMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="app-mark-svg">
      <path d="M10 32c5-8 14-10 22-16" />
      <circle cx="16" cy="18" r="4" />
      <circle cx="30" cy="30" r="4" />
      <path d="M32 14h6v6" />
    </svg>
  );
}

function useHashRoute() {
  const getHash = () => {
    if (typeof window === "undefined") {
      return "/";
    }
    return window.location.hash.replace(/^#/, "") || "/";
  };
  const [route, setRoute] = useState(() => getHash());

  useEffect(() => {
    function handleChange() {
      setRoute(getHash());
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
      }
    }
    window.addEventListener("hashchange", handleChange);
    return () => window.removeEventListener("hashchange", handleChange);
  }, []);

  return route;
}

function usePageMeta(locale, route) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const metaConfig = locale === "es"
      ? [
          {
            match: (value) => value.startsWith("/about"),
            title: "Sobre StrideSafe | Plataforma de prevencion de caidas",
            description:
              "StrideSafe es una plataforma de prevencion para residencias, salud en el hogar y PT ambulatorio. Combinamos analisis de marcha, evaluacion basada en evidencia y reportes listos.",
          },
          {
            match: (value) => value.startsWith("/admin-review"),
            title: "Consola de revision administrativa | StrideSafe",
            description:
              "Revisa evaluaciones, prioriza riesgo y gestiona QA clinico con la consola centralizada de StrideSafe.",
          },
          {
            match: (value) => value.startsWith("/portal"),
            title: "Portal clinico | StrideSafe",
            description:
              "Inicia sesiones clinicas, carga video, captura pruebas TUG y balance, y genera reportes de riesgo de caidas listos para documentacion.",
          },
        ]
      : [
          {
            match: (value) => value.startsWith("/about"),
            title: "About StrideSafe | Fall Prevention Platform",
            description:
              "StrideSafe is a fall-prevention platform for senior living, home health, and outpatient PT. We combine smartphone gait analysis, evidence-based screening, and documentation-ready reporting.",
          },
          {
            match: (value) => value.startsWith("/admin-review"),
            title: "Admin Review Console | StrideSafe",
            description:
              "Review assessments, prioritize risk, and manage clinical QA with a centralized StrideSafe admin console.",
          },
          {
            match: (value) => value.startsWith("/portal"),
            title: "Clinician Portal | StrideSafe",
            description:
              "Log in, upload video, capture TUG and balance scores, and generate fall-risk reports in the StrideSafe clinician portal.",
          },
        ];

    const fallback = locale === "es"
      ? {
          title: "StrideSafe | Plataforma de prevencion de caidas",
          description:
            "StrideSafe ofrece evaluaciones rapidas y objetivas de riesgo de caidas para residencias, salud en el hogar y atencion ambulatoria.",
        }
      : {
          title: "StrideSafe | Fall prevention platform",
          description:
            "StrideSafe delivers fast, objective fall-risk screening and gait analysis for senior living, home health, and outpatient care.",
        };

    const current = metaConfig.find((entry) => entry.match(route)) || fallback;
    document.title = current.title;

    const setMeta = (attr, key, content) => {
      let tag = document.querySelector(`meta[${attr}="${key}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    setMeta("name", "description", current.description);
    setMeta("property", "og:title", current.title);
    setMeta("property", "og:description", current.description);
  }, [locale, route]);
}

function useStoredAuth() {
  const [token, setToken] = useState(() => getStoredValue(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState(() => getStoredJson(USER_STORAGE_KEY));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (user) {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [user]);

  return { token, setToken, user, setUser };
}

function SiteHeader({ locale, buildHrefFor, currentPath }) {
  const [activeLanguages, setActiveLanguages] = useState({
    en: true,
    es: false,
  });

  useEffect(() => {
    setActiveLanguages({ en: locale === "en", es: locale === "es" });
  }, [locale]);

  const navCopy = locale === "es"
    ? {
        home: "Inicio",
        products: "Productos",
        solutions: "Soluciones",
        about: "Acerca de",
        portal: "Portal clinico",
        login: "Iniciar sesion",
        requestDemo: "Solicitar demo",
        productHome: "StrideSafe Home",
        productGait: "StrideSafe MotionLab",
        productPt: "StrideSafe TherapyFlow",
        productAdmin: "Consola Admin",
        solutionPrimary: "Atencion primaria",
        solutionSenior: "Residencias",
        solutionHome: "Salud en el hogar",
        solutionOrtho: "Ortopedia",
        brandSub: "Prevencion de caidas",
      }
    : {
        home: "Home",
        products: "Products",
        solutions: "Solutions",
        about: "About",
        portal: "Portal",
        login: "Login",
        requestDemo: "Request a Demo",
        productHome: "StrideSafe Home",
        productGait: "StrideSafe MotionLab",
        productPt: "StrideSafe TherapyFlow",
        productAdmin: "Admin Review Console",
        solutionPrimary: "Primary Care",
        solutionSenior: "Senior Living",
        solutionHome: "Home Health",
        solutionOrtho: "Orthopedics",
        brandSub: "Fall prevention",
      };

  const toggleLanguage = (code) => {
    setActiveLanguages({ en: code === "en", es: code === "es" });
    if (code !== locale) {
      window.location.hash = buildHrefFor(currentPath, code);
    }
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="brand">
          <span className="brand-mark"><AppMark /></span>
          <div>
            <span className="brand-name">StrideSafe</span>
            <span className="brand-sub">{navCopy.brandSub}</span>
          </div>
        </div>
        <nav className="site-nav" aria-label="Primary">
          <a href={buildHrefFor("/")} className="nav-link">{navCopy.home}</a>
          <div className="nav-dropdown">
            <button className="nav-link nav-button" type="button" aria-haspopup="true">
              {navCopy.products}
            </button>
            <div className="dropdown-menu">
              <a href={buildHrefFor("/stridesafe-home")}>{navCopy.productHome}</a>
              <a href={buildHrefFor("/gait-lab")}>{navCopy.productGait}</a>
              <a href={buildHrefFor("/pt-workflow")}>{navCopy.productPt}</a>
              <a href={buildHrefFor("/admin-review")}>{navCopy.productAdmin}</a>
            </div>
          </div>
          <div className="nav-dropdown">
            <button className="nav-link nav-button" type="button" aria-haspopup="true">
              {navCopy.solutions}
            </button>
            <div className="dropdown-menu">
              <a href={buildHrefFor("/solutions/primary-care")}>{navCopy.solutionPrimary}</a>
              <a href={buildHrefFor("/solutions/senior-living")}>{navCopy.solutionSenior}</a>
              <a href={buildHrefFor("/solutions/home-health")}>{navCopy.solutionHome}</a>
              <a href={buildHrefFor("/solutions/orthopedics")}>{navCopy.solutionOrtho}</a>
            </div>
          </div>
          <a href={buildHrefFor("/about")} className="nav-link">{navCopy.about}</a>
          <a href={buildHrefFor("/portal")} className="nav-link">{navCopy.portal}</a>
          <a href={buildHrefFor("/portal")} className="nav-link">{navCopy.login}</a>
          <div className="language-tags" role="group" aria-label="Languages">
            {[
              { code: "en", label: "English" },
              { code: "es", label: "Espanol" },
            ].map((lang) => (
              <button
                key={lang.code}
                className={`language-tag ${activeLanguages[lang.code] ? "active" : ""}`}
                type="button"
                onClick={() => toggleLanguage(lang.code)}
                aria-pressed={activeLanguages[lang.code]}
              >
                {lang.label}
              </button>
            ))}
          </div>
          <button className="button primary" type="button">{navCopy.requestDemo}</button>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter({ locale, buildHrefFor }) {
  const footerCopy = locale === "es"
    ? {
        division: "StrideSafe, una division de Techeze AI",
        products: "Productos",
        resources: "Recursos",
        security: "Seguridad y cumplimiento",
        dataPrivacy: "Privacidad de datos",
        compatibility: "Compatibilidad",
        support: "Soporte",
        faq: "Preguntas frecuentes",
        imprint: "Aviso legal",
        terms: "Terminos",
        cookies: "Politica de cookies",
        rights: "Todos los derechos reservados.",
        phoneLabel: "Telefono",
        productHome: "StrideSafe Home",
        productGait: "StrideSafe MotionLab",
        productPt: "StrideSafe TherapyFlow",
        productAdmin: "Consola Admin",
      }
    : {
        division: "StrideSafe, a division of Techeze AI",
        products: "Products",
        resources: "Resources",
        security: "Security and Compliance Focus",
        dataPrivacy: "Data privacy",
        compatibility: "Compatibility",
        support: "Support",
        faq: "FAQ",
        imprint: "Imprint",
        terms: "Terms",
        cookies: "Cookie Policy",
        rights: "All Rights reserved.",
        phoneLabel: "Phone",
        productHome: "StrideSafe Home",
        productGait: "StrideSafe MotionLab",
        productPt: "StrideSafe TherapyFlow",
        productAdmin: "Admin Review Console",
      };
  const certChips = locale === "es"
    ? ["HIPAA alineado", "SOC 2 Tipo II", "Guiado por NIST", "Accesibilidad primero"]
    : ["HIPAA-aligned", "SOC 2 Type II", "NIST-guided", "Accessibility-first"];

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="brand footer-brand">
            <span className="brand-mark"><AppMark /></span>
            <span className="brand-name">StrideSafe</span>
          </div>
          <p>{footerCopy.division}</p>
          <p>602 Hurst Rd, Suite #1</p>
          <p>Palm Bay, FL 32907</p>
          <p>{footerCopy.phoneLabel}: (321) 953-5199</p>
          <p>Email: hello@stridesafe.com</p>
        </div>
          <div>
            <h4>{footerCopy.products}</h4>
            <a href={buildHrefFor("/stridesafe-home")}>{footerCopy.productHome}</a>
            <a href={buildHrefFor("/gait-lab")}>{footerCopy.productGait}</a>
            <a href={buildHrefFor("/pt-workflow")}>{footerCopy.productPt}</a>
            <a href={buildHrefFor("/admin-review")}>{footerCopy.productAdmin}</a>
            <a href="#">StrideSafe Clinic</a>
            <a href="#">StrideSafe Motion Lab</a>
          </div>
        <div>
          <h4>{footerCopy.resources}</h4>
          <a href="#">{footerCopy.dataPrivacy}</a>
          <a href="#">{footerCopy.compatibility}</a>
          <a href="#">{footerCopy.support}</a>
          <a href="#">{footerCopy.faq}</a>
        </div>
        <div>
          <h4>{footerCopy.security}</h4>
          <div className="cert-grid">
            {certChips.map((chip) => (
              <div key={chip} className="cert-chip">{chip}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <p>© 2026 StrideSafe Health, Inc. {footerCopy.rights}</p>
        <div className="footer-links">
          <a href="#">{footerCopy.imprint}</a>
          <a href="#">{footerCopy.terms}</a>
          <a href="#">{footerCopy.cookies}</a>
        </div>
      </div>
    </footer>
  );
}

function Layout({ children, locale, buildHrefFor, currentPath }) {
  return (
    <div className="page">
      <SiteHeader locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath} />
      <main>{children}</main>
      <SiteFooter locale={locale} buildHrefFor={buildHrefFor} />
    </div>
  );
}

function LandingPage({ locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const stats = isEs ? landingStatsEs : landingStats;
  const challenges = isEs ? landingChallengesEs : landingChallenges;
  const opportunities = isEs ? landingOpportunitiesEs : landingOpportunities;
  const pillars = isEs ? landingPillarsEs : landingPillars;
  const benefits = isEs ? landingBenefitsEs : landingBenefits;
  const reimburseBlocks = isEs ? reimbursementBlocksEs : reimbursementBlocks;
  const steps = isEs ? landingStepsEs : landingSteps;
  const impact = isEs ? landingImpactEs : landingImpact;

  const copy = isEs
    ? {
        badge: "Plataforma StrideSafe",
        eyebrow: "Plataforma de prevencion de caidas en EE.UU.",
        heading: "Convierte la prevencion de caidas en resultados medibles",
        lead:
          "StrideSafe ayuda a equipos de PT, atencion primaria y residencias a completar evaluaciones de riesgo de caidas en minutos, con consistencia clinica y soporte de facturacion.",
        ctaPrimary: "Solicitar demo",
        ctaSecondary: "Ver evidencia clinica",
        finePrint:
          "Fuentes: CDC (Older Adult Falls, 27 Ene 2026) y NCHS (Data Brief No. 532, 2023).",
        timeline: "Linea de tiempo de evaluacion",
        nodeRecord: "Grabar",
        nodeAssess: "Evaluar",
        nodeIntervene: "Intervenir",
        nodeDocument: "Documentar",
        summaryTitle: "Resumenes listos para facturacion",
        summaryBody: "La documentacion autogenerada soporta flujos de reembolso comunes.",
        metricTime: "Tiempo ahorrado promedio",
        metricAssessments: "Evaluaciones por dia",
        challengeHeading: "Las caidas cuestan miles de millones al sistema de salud en EE.UU.",
        challengeBody:
          "StrideSafe ayuda a actuar antes, documentar mas rapido y escalar programas de prevencion.",
        challengeTitle: "El reto",
        opportunityTitle: "La oportunidad",
        pillarHeading: "Prevencion de caidas de nivel clinico que se adapta a tu flujo",
        pillarBody:
          "Implementa una plataforma en PT, atencion primaria y residencias.",
        benefitsHeading: "Beneficios clave para equipos en EE.UU.",
        reimburseHeading: "Guia de reembolso",
        reimburseBody:
          "La cobertura varia. StrideSafe soporta documentacion para rutas comunes.",
        reimburseCalloutTitle: "Necesitas un analisis de reembolso?",
        reimburseCalloutBody: "Ofrecemos guias CPT, flujos y plantillas.",
        reimburseButton: "Descargar guia",
        validationHeading: "Impulsado por IA, validado por ciencia",
        validationBody: "Resultados consistentes sin equipo adicional.",
        validationCards: [
          {
            title: "Analisis 3D sin marcadores",
            body: "Analisis de marcha con IA desde video de smartphone.",
          },
          {
            title: "Precision de nivel clinico",
            body: "Protocolos validados alineados con estandares clinicos.",
          },
          {
            title: "Recomendaciones basadas en evidencia",
            body: "Guia accionable para apoyar planes de prevencion.",
          },
        ],
        howHeading: "Como funciona",
        howBody: "Tres pasos de captura a intervencion.",
        highlightTotal: "Tiempo total: 2-3 minutos",
        highlightTraditional: "Metodo tradicional: 20-45 minutos",
        highlightButton: "Ver demo de 3 minutos",
        numbersHeading: "Panorama de caidas en EE.UU.",
        numbersFinePrint: "Fuentes: CDC y NCHS (muertes 2023).",
      }
    : {
        badge: "StrideSafe Platform",
        eyebrow: "U.S. fall prevention platform",
        heading: "Transform fall prevention into measurable outcomes",
        lead:
          "StrideSafe helps PT, primary care, and senior living teams complete fall risk assessments in minutes - with clinical-grade consistency and billing support.",
        ctaPrimary: "Request a Demo",
        ctaSecondary: "See Clinical Evidence",
        finePrint:
          "Sources: CDC Older Adult Falls (Jan 27, 2026) and NCHS Data Brief No. 532 (2023 deaths).",
        timeline: "Assessment timeline",
        nodeRecord: "Record",
        nodeAssess: "Assess",
        nodeIntervene: "Intervene",
        nodeDocument: "Document",
        summaryTitle: "Revenue-ready summaries",
        summaryBody: "Auto-generated documentation supports common reimbursement workflows.",
        metricTime: "Avg. time saved",
        metricAssessments: "Assessments per day",
        challengeHeading: "Falls cost U.S. healthcare billions every year",
        challengeBody:
          "StrideSafe helps teams act earlier, document faster, and scale prevention programs.",
        challengeTitle: "The challenge",
        opportunityTitle: "The opportunity",
        pillarHeading: "Clinical-grade fall prevention that fits your workflow",
        pillarBody: "Deploy one platform across PT, primary care, and senior living settings.",
        benefitsHeading: "Key benefits for U.S. care teams",
        reimburseHeading: "Reimbursement guide",
        reimburseBody: "Coverage varies. StrideSafe supports documentation for common pathways.",
        reimburseCalloutTitle: "Need a reimbursement deep dive?",
        reimburseCalloutBody: "We provide CPT guidance, workflows, and documentation templates.",
        reimburseButton: "Download Guide",
        validationHeading: "Powered by AI, validated by science",
        validationBody: "Deliver consistent results without extra equipment.",
        validationCards: [
          {
            title: "Markerless 3D analysis",
            body: "AI-driven gait analysis from ordinary smartphone video.",
          },
          {
            title: "Clinical-grade accuracy",
            body: "Validated protocols aligned with clinical assessment standards.",
          },
          {
            title: "Evidence-based recommendations",
            body: "Actionable guidance to support safer living and prevention plans.",
          },
        ],
        howHeading: "How it works",
        howBody: "Three steps from capture to intervention.",
        highlightTotal: "Total time: 2-3 minutes",
        highlightTraditional: "Traditional method: 20-45 minutes",
        highlightButton: "Watch 3-Min Demo",
        numbersHeading: "U.S. fall snapshot",
        numbersFinePrint: "Sources: CDC and NCHS (2023 deaths).",
      };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero landing-hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>{copy.badge}</span>
            </div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
            <p className="lead">{copy.lead}</p>
            <div className="cta-row">
              <button className="button primary" type="button">{copy.ctaPrimary}</button>
              <button className="button ghost" type="button">{copy.ctaSecondary}</button>
            </div>
            <div className="landing-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="stat-card">
                  <span className="stat-number">{stat.value}</span>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
            <p className="fine-print">{copy.finePrint}</p>
          </div>
          <div className="hero-media">
            <div className="workflow-card floating">
              <div className="workflow-header">
                <span>{copy.timeline}</span>
                <span className="media-chip">2-3 min</span>
              </div>
              <div className="workflow-track">
                <div className="workflow-node">{copy.nodeRecord}</div>
                <div className="workflow-node">{copy.nodeAssess}</div>
                <div className="workflow-node">{copy.nodeIntervene}</div>
                <div className="workflow-node">{copy.nodeDocument}</div>
              </div>
            </div>
            <div className="workflow-card light">
              <h3>{copy.summaryTitle}</h3>
              <p>{copy.summaryBody}</p>
              <div className="workflow-metrics">
                <div>
                  <span className="metric-label">{copy.metricTime}</span>
                  <strong>3 hrs / week</strong>
                </div>
                <div>
                  <span className="metric-label">{copy.metricAssessments}</span>
                  <strong>12-18</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.challengeHeading}</h2>
            <p>{copy.challengeBody}</p>
          </div>
          <div className="dual-card-grid">
            <div className="panel-card">
              <h3>{copy.challengeTitle}</h3>
              <ul>
                {challenges.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="panel-card accent">
              <h3>{copy.opportunityTitle}</h3>
              <ul>
                {opportunities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.pillarHeading}</h2>
            <p>{copy.pillarBody}</p>
          </div>
          <div className="pillar-grid">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="pillar-card">
                <Icon name={pillar.icon} />
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
                <a href={buildHrefFor(pillar.path)}>{pillar.linkLabel}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.benefitsHeading}</h2>
          </div>
          <div className="benefit-grid">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="benefit-card">
                <h3>{benefit.title}</h3>
                <ul>
                  {benefit.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <span className="benefit-highlight">{benefit.highlight}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.reimburseHeading}</h2>
            <p>{copy.reimburseBody}</p>
          </div>
          <div className="reimburse-grid">
            {reimburseBlocks.map((block) => (
              <div key={block.title} className="reimburse-card">
                <div className="tag">{block.tag}</div>
                <h3>{block.title}</h3>
                <p>{block.body}</p>
                <ul>
                  {block.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="callout secondary">
            <div>
              <h2>{copy.reimburseCalloutTitle}</h2>
              <p>{copy.reimburseCalloutBody}</p>
            </div>
            <button className="button ghost" type="button">{copy.reimburseButton}</button>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.validationHeading}</h2>
            <p>{copy.validationBody}</p>
          </div>
          <div className="validation-grid">
            <div className="validation-card">
              <Icon name="insights" />
              <h3>{copy.validationCards[0].title}</h3>
              <p>{copy.validationCards[0].body}</p>
            </div>
            <div className="validation-card">
              <Icon name="badge" />
              <h3>{copy.validationCards[1].title}</h3>
              <p>{copy.validationCards[1].body}</p>
            </div>
            <div className="validation-card">
              <Icon name="shield" />
              <h3>{copy.validationCards[2].title}</h3>
              <p>{copy.validationCards[2].body}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.howHeading}</h2>
            <p>{copy.howBody}</p>
          </div>
          <div className="steps-grid">
            {steps.map((step) => (
              <div key={step.title} className="step-card">
                <span className="step-label">{step.label}</span>
                <Icon name={step.icon} />
                <h3>{step.title}</h3>
                <ul>
                  {step.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="highlight-bar">
            <div>
              <strong>{copy.highlightTotal}</strong>
              <span>{copy.highlightTraditional}</span>
            </div>
            <button className="button ghost" type="button">{copy.highlightButton}</button>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.numbersHeading}</h2>
          </div>
          <div className="impact-grid">
            {impact.map((stat) => (
              <div key={stat.label} className="impact-card">
                <span className="impact-value">{stat.value}</span>
                <p>{stat.label}</p>
              </div>
            ))}
          </div>
          <p className="fine-print">{copy.numbersFinePrint}</p>
        </div>
      </section>
    </Layout>
  );
}

function StrideSafeHomePage({ locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const highlights = isEs ? featureHighlightsEs : featureHighlights;
  const steps = isEs ? processStepsEs : processSteps;
  const details = isEs ? detailCardsEs : detailCards;
  const featured = isEs ? featuredInEs : featuredIn;
  const pricingPlans = isEs ? pricingEs : pricing;
  const faqItems = isEs ? faqsEs : faqs;

  const copy = isEs
    ? {
        badge: "App StrideSafe Home",
        eyebrow: "Plataforma de prevencion de caidas en EE.UU.",
        heading: "StrideSafe Home - evaluacion de movilidad para vivir con seguridad",
        lead:
          "Una evaluacion de movimiento con smartphone para familias, salud en el hogar y residencias. Detecta riesgos temprano y apoya el envejecimiento en casa.",
        ctaPrimary: "Unete a la lista de espera",
        ctaSecondary: "Agenda una demo en EE.UU.",
        storeApple: "Descargar en App Store",
        storeGoogle: "Obtener en Google Play",
        statLabel: "factores de movilidad evaluados por evaluacion",
        statSubTitle: "Listo para clinica",
        statSubBody: "resumenes claros para equipos",
        mediaHeader: "Resumen de movilidad",
        balanceLabel: "Equilibrio",
        balanceValue: "Estable",
        trendLabel: "Tendencia",
        riskLabel: "Puntaje de riesgo",
        riskValue: "Bajo",
        trendCardLabel: "Tendencia de movilidad",
        nextAssessmentLabel: "Proxima evaluacion",
        nextAssessmentValue: "2 semanas",
        introEyebrow: "Que es StrideSafe Home?",
        introHeading: "Insights de movilidad para familias y equipos en EE.UU.",
        introBody1:
          "StrideSafe Home es una app disenada para ayudar a familias y proveedores a seguir patrones de movilidad en casa.",
        introBody2:
          "La app hace que las evaluaciones sean simples, repetibles y accesibles sin equipo adicional.",
        introCta: "Probar StrideSafe",
        visualTitle: "Enfoque smartphone",
        visualBody: "Captura un video corto y recibe resultados en minutos.",
        visualHighlightTitle: "Coordinacion de cuidado",
        visualHighlightBody: "Comparte insights con familiares y proveedores.",
        supportHeading: "Monitoreo de movimiento y coordinacion de cuidado",
        supportBody:
          "Sigue tendencias con factores validados, pensado para seguridad y claridad en EE.UU.",
        howHeading: "Como funciona StrideSafe Home",
        howBody: "Pasos simples y guiados para evaluaciones consistentes.",
        insideHeading: "Dentro de cada evaluacion",
        insideBody: "Todo es rapido, repetible y facil de entender.",
        featuredHeading: "Destacado en",
        pricingHeading: "Nuestros precios",
        pricingBody: "Elige el plan que se ajuste a tus necesidades (USD).",
        pricingCta: "Unete a la lista",
        faqHeading: "Preguntas frecuentes",
        newsletterHeading: "Mantente informado sobre prevencion de caidas en EE.UU.",
        newsletterBody: "Recibe actualizaciones de insights, seguridad y nuevas funciones.",
        newsletterPlaceholder: "Correo electronico",
        newsletterButton: "Suscribirse",
      }
    : {
        badge: "StrideSafe Home App",
        eyebrow: "U.S. fall prevention platform",
        heading: "StrideSafe Home - mobility screening for safer living",
        lead:
          "A smartphone-based movement screening designed for families, home health, and senior living teams. Track mobility patterns, identify risks earlier, and support aging in place with confidence.",
        ctaPrimary: "Join the Waitlist",
        ctaSecondary: "Book a U.S. Demo",
        storeApple: "Download on the App Store",
        storeGoogle: "Get it on Google Play",
        statLabel: "mobility factors evaluated per assessment",
        statSubTitle: "Clinic-ready",
        statSubBody: "clear summaries for care teams",
        mediaHeader: "Mobility overview",
        balanceLabel: "Balance",
        balanceValue: "Stable",
        trendLabel: "Trend",
        riskLabel: "Risk score",
        riskValue: "Low",
        trendCardLabel: "Mobility trend",
        nextAssessmentLabel: "Next assessment",
        nextAssessmentValue: "2 weeks",
        introEyebrow: "What is StrideSafe Home?",
        introHeading: "Mobility insights for families and U.S. care teams.",
        introBody1:
          "StrideSafe Home is a mobility screening app designed to help families and healthcare providers track mobility patterns at home.",
        introBody2:
          "The app is designed to make movement assessments simple, repeatable, and accessible - without extra equipment.",
        introCta: "Try StrideSafe",
        visualTitle: "Smartphone-first",
        visualBody: "Capture a short video and receive results in minutes.",
        visualHighlightTitle: "Care coordination",
        visualHighlightBody: "Share insights with family members and healthcare providers.",
        supportHeading: "Movement monitoring and care coordination support",
        supportBody:
          "Track mobility trends with validated factors - built for safety, clarity, and care coordination across U.S. settings.",
        howHeading: "How StrideSafe Home works",
        howBody: "Simple, guided steps that keep assessments consistent and safe.",
        insideHeading: "Inside each assessment",
        insideBody: "Everything is designed to be quick, repeatable, and easy to understand.",
        featuredHeading: "As featured in",
        pricingHeading: "Our pricing",
        pricingBody: "Choose the plan that fits your monitoring needs (USD).",
        pricingCta: "Join Waitlist",
        faqHeading: "FAQ",
        newsletterHeading: "Stay informed about fall prevention in the U.S.",
        newsletterBody: "Get updates on mobility insights, safety tips, and new StrideSafe features.",
        newsletterPlaceholder: "Email address",
        newsletterButton: "Subscribe",
      };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>{copy.badge}</span>
            </div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
            <p className="lead">{copy.lead}</p>
            <div className="cta-row">
              <button className="button primary" type="button">{copy.ctaPrimary}</button>
              <button className="button ghost" type="button">{copy.ctaSecondary}</button>
            </div>
            <div className="store-row">
              <button className="store-button" type="button">{copy.storeApple}</button>
              <button className="store-button" type="button">{copy.storeGoogle}</button>
            </div>
            <div className="stat-row">
              <div className="stat-card">
                <span className="stat-number">14</span>
                <p>{copy.statLabel}</p>
              </div>
              <div className="stat-card subtle">
                <span className="stat-number">{copy.statSubTitle}</span>
                <p>{copy.statSubBody}</p>
              </div>
            </div>
          </div>
          <div className="hero-media">
            <div className="media-card floating">
              <div className="media-header">
                <span>{copy.mediaHeader}</span>
                <span className="media-chip">AI</span>
              </div>
              <div className="media-screen">
                <div className="ring" />
                <div className="ring small" />
              </div>
              <div className="media-stats">
                <div>
                  <p>{copy.balanceLabel}</p>
                  <strong>{copy.balanceValue}</strong>
                </div>
                <div>
                  <p>{copy.trendLabel}</p>
                  <strong>+8%</strong>
                </div>
              </div>
            </div>
            <div className="media-phone">
              <div className="phone-notch" />
              <div className="phone-body">
                <div className="phone-card">
                  <p>{copy.riskLabel}</p>
                  <strong>{copy.riskValue}</strong>
                </div>
                <div className="phone-card wide">
                  <p>{copy.trendCardLabel}</p>
                  <div className="mini-bars">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div className="phone-card">
                  <p>{copy.nextAssessmentLabel}</p>
                  <strong>{copy.nextAssessmentValue}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div className="split-content">
            <p className="eyebrow">{copy.introEyebrow}</p>
            <h2>{copy.introHeading}</h2>
            <p>{copy.introBody1}</p>
            <p>{copy.introBody2}</p>
            <button className="button primary" type="button">{copy.introCta}</button>
          </div>
          <div className="split-visual">
            <div className="visual-card">
              <h3>{copy.visualTitle}</h3>
              <p>{copy.visualBody}</p>
              <div className="visual-grid">
                <div className="visual-tile" />
                <div className="visual-tile" />
                <div className="visual-tile" />
                <div className="visual-tile" />
              </div>
            </div>
            <div className="visual-card highlight">
              <h3>{copy.visualHighlightTitle}</h3>
              <p>{copy.visualHighlightBody}</p>
              <div className="progress-line" />
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.supportHeading}</h2>
            <p>{copy.supportBody}</p>
          </div>
          <div className="grid features-grid">
            {highlights.map((item, index) => (
              <div
                key={item.title}
                className="feature-card fade-up"
                style={{ "--delay": `${index * 0.06}s` }}
              >
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.howHeading}</h2>
            <p>{copy.howBody}</p>
          </div>
          <div className="process-grid">
            {steps.map((step, index) => (
              <div key={step.title} className="process-card">
                <span className="process-number">0{index + 1}</span>
                <Icon name={step.icon} />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.insideHeading}</h2>
            <p>{copy.insideBody}</p>
          </div>
          <div className="grid detail-grid">
            {details.map((card) => (
              <div key={card.title} className="detail-card">
                <Icon name={card.icon} />
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.featuredHeading}</h2>
          </div>
          <div className="logo-row">
            {featured.map((logo) => (
              <div key={logo} className="logo-card">{logo}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.pricingHeading}</h2>
            <p>{copy.pricingBody}</p>
          </div>
          <div className="pricing-grid">
            {pricingPlans.map((plan) => (
              <div key={plan.title} className={`price-card${plan.featured ? " featured" : ""}`}>
                <h3>{plan.title}</h3>
                <p className="price-sub">{plan.subtitle}</p>
                <div className="price-line">
                  <span className="price">{plan.price}</span>
                  <span className="cadence">{plan.cadence}</span>
                </div>
                <ul>
                  {plan.features.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <button className="button primary" type="button">{copy.pricingCta}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.faqHeading}</h2>
          </div>
          <div className="faq">
            {faqItems.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container callout">
          <div>
            <h2>{copy.newsletterHeading}</h2>
            <p>{copy.newsletterBody}</p>
          </div>
          <div className="callout-actions">
            <input
              type="email"
              placeholder={copy.newsletterPlaceholder}
              aria-label={copy.newsletterPlaceholder}
            />
            <button className="button primary" type="button">{copy.newsletterButton}</button>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function GaitLabPage({ locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const stats = isEs ? gaitStatsEs : gaitStats;
  const highlights = isEs ? gaitHighlightsEs : gaitHighlights;
  const partners = isEs ? gaitPartnersEs : gaitPartners;
  const benefits = isEs ? gaitBenefitsEs : gaitBenefits;
  const progressPoints = isEs ? gaitProgressPointsEs : gaitProgressPoints;
  const faqItems = isEs ? gaitFaqEs : gaitFaq;

  const copy = isEs
    ? {
        eyebrow: "Analisis clinico de marcha via smartphone",
        heading: "StrideSafe MotionLab - el laboratorio de marcha en tu bolsillo",
        lead:
          "Analisis de movimiento con IA para clinicas, terapia e investigacion. Captura datos objetivos en minutos.",
        ctaPrimary: "Solicitar demo",
        ctaSecondary: "Agendar piloto",
        mediaHeader: "Captura en vivo",
        strideLabel: "Longitud de zancada",
        symmetryLabel: "Simetria",
        phoneScore: "Puntaje de marcha",
        phoneTracking: "Seguimiento de progreso",
        phoneNext: "Proxima revision",
        phoneNextValue: "2 semanas",
        howHeading: "Como funciona StrideSafe MotionLab",
        howBody: "Inteligencia de movimiento validada para equipos clinicos y de investigacion.",
        partnersHeading: "Socios white-label",
        partnersBody: "Confiado por clinicas, universidades y lideres de salud digital.",
        splitEyebrow: "Analisis de marcha via app",
        splitHeading: "Analisis de marcha preciso, en cualquier lugar.",
        splitBody1:
          "StrideSafe MotionLab hace accesible el analisis complejo sin marcadores ni hardware dedicado.",
        splitBody2:
          "Captura datos con smartphone y convierte en metricas estructuradas.",
        splitCta: "Agendar demo",
        visualTitle: "Captura en segundos",
        visualBody: "Analisis instantaneo desde cualquier angulo.",
        visualHighlightTitle: "Claridad clinica",
        visualHighlightBody: "Resultados comprensibles para pacientes y equipos.",
        progressEyebrow: "Seguimiento con StrideSafe",
        progressHeading: "Analisis modular de marcha en el tiempo",
        progressBody:
          "Sigue rehabilitacion, cambios de rendimiento y resultados con evaluaciones consistentes.",
        progressCta: "Agendar demo",
        progressTitle: "Simetria de marcha",
        progressSubtitle: "Tendencia semanal",
        progressScoreTitle: "Puntaje de movilidad",
        progressScoreBody: "Mejora consistente detectada.",
        calloutTitle: "Disena tu laboratorio de marcha con nosotros",
        calloutBody: "Solucion white-label como app independiente o integrada.",
        calloutButton: "Agendar cita",
        faqHeading: "Preguntas frecuentes",
        finalTitle: "Listo para conversar sobre tu caso?",
        finalBody: "Agenda una llamada demo y crea un flujo StrideSafe a tu medida.",
        finalButton: "Programar llamada demo",
      }
    : {
        eyebrow: "Clinical gait analysis via smartphone",
        heading: "StrideSafe MotionLab - the gait lab for your pocket",
        lead:
          "Precise AI-powered movement analysis designed for clinics, therapy, and research teams. Capture objective gait data in minutes.",
        ctaPrimary: "Request a Demo",
        ctaSecondary: "Book a Pilot",
        mediaHeader: "Live capture",
        strideLabel: "Stride length",
        symmetryLabel: "Symmetry",
        phoneScore: "Gait score",
        phoneTracking: "Progress tracking",
        phoneNext: "Next review",
        phoneNextValue: "2 weeks",
        howHeading: "How StrideSafe MotionLab works",
        howBody: "Validated movement intelligence designed for clinical and research teams.",
        partnersHeading: "Our white-label partners",
        partnersBody: "Trusted by clinics, universities, and digital health leaders.",
        splitEyebrow: "Gait analysis via app",
        splitHeading: "Precision gait analysis, anytime and anywhere.",
        splitBody1:
          "StrideSafe MotionLab makes complex gait analysis accessible without markers or dedicated lab hardware.",
        splitBody2:
          "Capture movement data with a smartphone and turn it into structured gait metrics for clinicians, patients, and researchers.",
        splitCta: "Book a Demo",
        visualTitle: "Capture in seconds",
        visualBody: "Instant gait analysis from any angle.",
        visualHighlightTitle: "Clinical clarity",
        visualHighlightBody: "Understandable results for patients and care teams.",
        progressEyebrow: "Progress tracking with StrideSafe",
        progressHeading: "Modular gait analysis over time",
        progressBody:
          "Track rehabilitation progress, performance changes, and therapy outcomes with consistent assessments and longitudinal reporting.",
        progressCta: "Book a Demo",
        progressTitle: "Gait symmetry",
        progressSubtitle: "Weekly trend",
        progressScoreTitle: "Mobility score",
        progressScoreBody: "Consistent improvement detected.",
        calloutTitle: "Design your gait lab with us",
        calloutBody: "White-label solution as a standalone app or integrated into your system.",
        calloutButton: "Book an Appointment",
        faqHeading: "FAQ",
        finalTitle: "Ready to discuss your use case?",
        finalBody: "Schedule a demo call and build a tailored StrideSafe workflow.",
        finalButton: "Schedule a Demo Call",
      };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>StrideSafe MotionLab</span>
            </div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
            <p className="lead">{copy.lead}</p>
            <div className="cta-row">
              <button className="button primary" type="button">{copy.ctaPrimary}</button>
              <button className="button ghost" type="button">{copy.ctaSecondary}</button>
            </div>
            <div className="stat-row">
              {stats.map((stat) => (
                <div key={stat.label} className="stat-card">
                  <span className="stat-number">{stat.value}</span>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="pill-row">
              {benefits.map((benefit) => (
                <span key={benefit} className="pill">{benefit}</span>
              ))}
            </div>
          </div>
          <div className="hero-media">
            <div className="media-card floating">
              <div className="media-header">
                <span>{copy.mediaHeader}</span>
                <span className="media-chip">AI</span>
              </div>
              <div className="media-screen">
                <div className="ring" />
                <div className="ring small" />
              </div>
              <div className="media-stats">
                <div>
                  <p>{copy.strideLabel}</p>
                  <strong>1.22 m</strong>
                </div>
                <div>
                  <p>{copy.symmetryLabel}</p>
                  <strong>96%</strong>
                </div>
              </div>
            </div>
            <div className="media-phone">
              <div className="phone-notch" />
              <div className="phone-body">
                <div className="phone-card">
                  <p>{copy.phoneScore}</p>
                  <strong>82</strong>
                </div>
                <div className="phone-card wide">
                  <p>{copy.phoneTracking}</p>
                  <div className="mini-bars">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div className="phone-card">
                  <p>{copy.phoneNext}</p>
                  <strong>{copy.phoneNextValue}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.howHeading}</h2>
            <p>{copy.howBody}</p>
          </div>
          <div className="grid features-grid">
            {highlights.map((item, index) => (
              <div
                key={item.title}
                className="feature-card fade-up"
                style={{ "--delay": `${index * 0.05}s` }}
              >
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.partnersHeading}</h2>
            <p>{copy.partnersBody}</p>
          </div>
          <div className="logo-row">
            {partners.map((partner) => (
              <div key={partner} className="logo-card">{partner}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div className="split-content">
            <p className="eyebrow">{copy.splitEyebrow}</p>
            <h2>{copy.splitHeading}</h2>
            <p>{copy.splitBody1}</p>
            <p>{copy.splitBody2}</p>
            <div className="pill-row">
              {benefits.map((benefit) => (
                <span key={benefit} className="pill">{benefit}</span>
              ))}
            </div>
            <button className="button primary" type="button">{copy.splitCta}</button>
          </div>
          <div className="split-visual">
            <div className="visual-card">
              <h3>{copy.visualTitle}</h3>
              <p>{copy.visualBody}</p>
              <div className="visual-grid">
                <div className="visual-tile" />
                <div className="visual-tile" />
                <div className="visual-tile" />
                <div className="visual-tile" />
              </div>
            </div>
            <div className="visual-card highlight">
              <h3>{copy.visualHighlightTitle}</h3>
              <p>{copy.visualHighlightBody}</p>
              <div className="progress-line" />
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container split reverse">
          <div className="split-content">
            <p className="eyebrow">{copy.progressEyebrow}</p>
            <h2>{copy.progressHeading}</h2>
            <p>{copy.progressBody}</p>
            <ul className="checklist">
              {progressPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <button className="button ghost" type="button">{copy.progressCta}</button>
          </div>
          <div className="split-visual">
            <div className="progress-card">
              <div className="progress-header">
                <div>
                  <h3>{copy.progressTitle}</h3>
                  <p>{copy.progressSubtitle}</p>
                </div>
                <span className="trend-tag">+12%</span>
              </div>
              <div className="progress-bars">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="progress-card muted">
              <h3>{copy.progressScoreTitle}</h3>
              <div className="progress-ring">
                <span>82</span>
              </div>
              <p>{copy.progressScoreBody}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container callout">
          <div>
            <h2>{copy.calloutTitle}</h2>
            <p>{copy.calloutBody}</p>
          </div>
          <button className="button primary" type="button">{copy.calloutButton}</button>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.faqHeading}</h2>
          </div>
          <div className="faq">
            {faqItems.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container callout secondary">
          <div>
            <h2>{copy.finalTitle}</h2>
            <p>{copy.finalBody}</p>
          </div>
          <button className="button ghost" type="button">{copy.finalButton}</button>
        </div>
      </section>
    </Layout>
  );
}

function PtWorkflowPage({ locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const highlights = isEs ? ptHighlightsEs : ptHighlights;
  const challenges = isEs ? ptChallengesEs : ptChallenges;
  const steps = isEs ? ptStepsEs : ptSteps;
  const validation = isEs ? ptValidationEs : ptValidation;

  const copy = isEs
    ? {
        eyebrow: "StrideSafe TherapyFlow para residencias y atencion ambulatoria",
        heading: "Convierte evaluaciones PT en un flujo de 2-3 minutos",
        lead:
          "StrideSafe TherapyFlow permite evaluaciones completas de riesgo de caidas y marcha sin sacrificar precision ni tiempo de reembolso.",
        ctaPrimary: "Solicitar demo",
        ctaSecondary: "Ver en accion",
        timeline: "Linea de tiempo de evaluacion",
        nodeCapture: "Captura",
        nodeAnalyze: "Analiza",
        nodeAssess: "Evalua",
        nodePlan: "Planifica",
        nodeDocument: "Documenta",
        summaryTitle: "Resumenes listos para facturacion",
        summaryBody: "Documentacion autogenerada con soporte CPT y exportacion a EHR.",
        metricTime: "Tiempo promedio ahorrado",
        metricAssessments: "Evaluaciones por dia",
        painHeading: "Tu tiempo es demasiado valioso para evaluaciones de 45 minutos",
        howHeading: "Como usan StrideSafe los terapeutas",
        howBody: "Proceso de cinco pasos para evaluaciones consistentes y escalables.",
        highlightTotal: "Tiempo total: 2-3 minutos",
        highlightTraditional: "Metodo tradicional: 20-45 minutos",
        highlightButton: "Calcular ROI",
        trustHeading: "Confiado por clinicos. Validado por ciencia.",
        trustBody: "Validacion clinica y evidencia real integrada en cada flujo.",
        calloutTitle: "Listo para modernizar tu flujo PT?",
        calloutBody: "Agenda una demo y ve como StrideSafe encaja en tu programa.",
        calloutButton: "Agendar demo",
        contactHeading: "Estamos listos para responder tus preguntas",
        salesRole: "Gerente de ventas",
        salesRegion: "Alianzas clinicas en EE.UU.",
        salesButton: "Contactar ventas",
        hqRole: "Oficina central",
        hqName: "StrideSafe, una division de Techeze AI",
        phoneLabel: "Telefono",
      }
    : {
        eyebrow: "PT workflow for senior living and outpatient care",
        heading: "Transform PT assessments into a 2-3 minute workflow",
        lead:
          "StrideSafe TherapyFlow empowers physical therapists to deliver comprehensive fall risk and gait assessments without sacrificing accuracy or reimbursement time.",
        ctaPrimary: "Request a Demo",
        ctaSecondary: "See It In Action",
        timeline: "Assessment timeline",
        nodeCapture: "Capture",
        nodeAnalyze: "Analyze",
        nodeAssess: "Assess",
        nodePlan: "Plan",
        nodeDocument: "Document",
        summaryTitle: "Billing-ready summaries",
        summaryBody: "Auto-generated documentation supports CPT-ready workflows and EHR exports.",
        metricTime: "Average time saved",
        metricAssessments: "Assessments per day",
        painHeading: "Your time is too valuable for 45-minute assessments",
        howHeading: "How physical therapists use StrideSafe",
        howBody: "A five-step process designed for consistent, scalable evaluations.",
        highlightTotal: "Total time: 2-3 minutes",
        highlightTraditional: "Traditional method: 20-45 minutes",
        highlightButton: "Calculate Your ROI",
        trustHeading: "Trusted by clinicians. Validated by science.",
        trustBody: "Clinical validation and real-world evidence built into every workflow.",
        calloutTitle: "Ready to modernize your PT workflow?",
        calloutBody: "Schedule a demo and see how StrideSafe fits into your senior living program.",
        calloutButton: "Book a Demo",
        contactHeading: "We are happy to answer your questions",
        salesRole: "Sales Manager",
        salesRegion: "US Clinical Partnerships",
        salesButton: "Contact Sales",
        hqRole: "Headquarters",
        hqName: "StrideSafe, a division of Techeze AI",
        phoneLabel: "Phone",
      };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>StrideSafe TherapyFlow</span>
            </div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
            <p className="lead">{copy.lead}</p>
            <div className="cta-row">
              <button className="button primary" type="button">{copy.ctaPrimary}</button>
              <button className="button ghost" type="button">{copy.ctaSecondary}</button>
            </div>
            <div className="stat-row">
              {highlights.map((stat) => (
                <div key={stat.value} className="stat-card">
                  <span className="stat-number">{stat.value}</span>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-media">
            <div className="workflow-card floating">
              <div className="workflow-header">
                <span>{copy.timeline}</span>
                <span className="media-chip">2-3 min</span>
              </div>
              <div className="workflow-track">
                <div className="workflow-node">{copy.nodeCapture}</div>
                <div className="workflow-node">{copy.nodeAnalyze}</div>
                <div className="workflow-node">{copy.nodeAssess}</div>
                <div className="workflow-node">{copy.nodePlan}</div>
                <div className="workflow-node">{copy.nodeDocument}</div>
              </div>
            </div>
            <div className="workflow-card light">
              <h3>{copy.summaryTitle}</h3>
              <p>{copy.summaryBody}</p>
              <div className="workflow-metrics">
                <div>
                  <span className="metric-label">{copy.metricTime}</span>
                  <strong>3 hrs / week</strong>
                </div>
                <div>
                  <span className="metric-label">{copy.metricAssessments}</span>
                  <strong>12-18</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.painHeading}</h2>
          </div>
          <div className="grid features-grid">
            {challenges.map((item) => (
              <div key={item.title} className="feature-card">
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.howHeading}</h2>
            <p>{copy.howBody}</p>
          </div>
          <div className="steps-grid">
            {steps.map((step) => (
              <div key={step.title} className="step-card">
                <span className="step-label">{step.label}</span>
                <Icon name={step.icon} />
                <h3>{step.title}</h3>
                <ul>
                  {step.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="highlight-bar">
            <div>
              <strong>{copy.highlightTotal}</strong>
              <span>{copy.highlightTraditional}</span>
            </div>
            <button className="button ghost" type="button">{copy.highlightButton}</button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.trustHeading}</h2>
            <p>{copy.trustBody}</p>
          </div>
          <div className="validation-grid">
            {validation.map((item) => (
              <div key={item.title} className="validation-card">
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container callout">
          <div>
            <h2>{copy.calloutTitle}</h2>
            <p>{copy.calloutBody}</p>
          </div>
          <button className="button primary" type="button">{copy.calloutButton}</button>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.contactHeading}</h2>
          </div>
          <div className="contact-grid">
            <div className="person-card">
              <span className="person-role">{copy.salesRole}</span>
              <h3>Jordan Fields, PT, DPT</h3>
              <p>{copy.salesRegion}</p>
              <button className="button ghost" type="button">{copy.salesButton}</button>
            </div>
            <div className="person-card">
              <span className="person-role">{copy.hqRole}</span>
              <h3>{copy.hqName}</h3>
              <p>602 Hurst Rd, Suite #1</p>
              <p>Palm Bay, FL 32907</p>
              <p>{copy.phoneLabel}: (321) 953-5199</p>
              <p>Email: hello@stridesafe.com</p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function AdminReviewPage({ locale, buildHrefFor, currentPath }) {
  const { token } = useStoredAuth();
  const [activeTab, setActiveTab] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(adminReviewQueue[0]?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [exportNotice, setExportNotice] = useState("");
  const [exportNoticeTone, setExportNoticeTone] = useState("info");
  const [facilityOptions, setFacilityOptions] = useState([]);
  const [facilityLoading, setFacilityLoading] = useState(false);

  const stats = locale === "es" ? adminReviewStatsEs : adminReviewStats;
  const kpis = locale === "es" ? adminReviewKpisEs : adminReviewKpis;
  const alerts = locale === "es" ? adminReviewAlertsEs : adminReviewAlerts;
  const statusLabels = adminStatusLabels[locale];
  const riskLabels = adminRiskLabels[locale];
  const detailsLookup = locale === "es" ? adminReviewDetailsEs : adminReviewDetails;

  const reviewQueue = locale === "es" ? adminReviewQueueEs : adminReviewQueue;

  const filteredQueue = reviewQueue.filter((row) => {
    const matchesTab = activeTab === "all" ? true : row.status === activeTab;
    const matchesRisk = riskFilter === "all" ? true : row.risk === riskFilter;
    const facilityName = facilityFilter === "all"
      ? ""
      : (facilityOptions.find((option) => option.id === facilityFilter)?.name || facilityFilter);
    const matchesFacility = facilityFilter === "all" ? true : row.facility === facilityName;
    const needle = searchQuery.trim().toLowerCase();
    const matchesSearch = !needle
      ? true
      : `${row.resident} ${row.facility} ${row.id}`.toLowerCase().includes(needle);
    return matchesTab && matchesRisk && matchesFacility && matchesSearch;
  });

  useEffect(() => {
    if (!token) {
      setFacilityOptions([]);
      setFacilityFilter("all");
      return;
    }
    let isActive = true;
    setFacilityLoading(true);
    apiRequest("/facilities", { token })
      .then((data) => {
        if (!isActive) {
          return;
        }
        const facilities = Array.isArray(data) ? data : [];
        setFacilityOptions(facilities);
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setFacilityOptions([]);
      })
      .finally(() => {
        if (!isActive) {
          return;
        }
        setFacilityLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [token]);

  const selected = filteredQueue.find((row) => row.id === selectedId) || filteredQueue[0] || null;
  const selectedDetails = selected ? (detailsLookup[selected.id] || {}) : {};
  const activeSelectedId = selected?.id || null;
  const showDetails = drawerOpen && selected;

  const copy = locale === "es"
    ? {
        badge: "Consola de revision administrativa",
        eyebrow: "Dashboard de operaciones clinicas",
        heading: "Revisa evaluaciones, prioriza riesgo y cierra el ciclo rapido.",
        lead:
          "Centraliza QA clinico para cada sitio y equipo. Mantiene tiempos rapidos y documentacion consistente.",
        ctaPrimary: "Solicitar acceso admin",
        ctaSecondary: "Ver cola de ejemplo",
        previewTitle: "Cola de revision en vivo",
        previewChip: "Ultimas 24 horas",
        previewFooterLeft: "Tiempo medio de revision",
        previewFooterRight: "Alertas generadas",
        qualityTitle: "Controles de calidad integrados",
        qualityBody: "Alertas automaticas, variacion de puntajes y auditoria completa.",
        coverageLabel: "Cobertura",
        qaLabel: "Revision QA",
        filterTitle: "Filtros de revision",
        filterBody: "Enfoca la cola por estado, riesgo y sitio.",
        filterStatus: "Estado",
        filterRisk: "Riesgo",
        filterFacilities: "Instalaciones",
        filterAllFacilities: "Todas las instalaciones",
        filterReviewer: "Revisor",
        alertsTitle: "Alertas de calidad",
        alertsCount: "3 abiertas",
        alertsButton: "Abrir alertas",
        queueTitle: "Cola de evaluaciones",
        queueBody: "Revisiones priorizadas en instalaciones y equipos.",
        exportCsv: "Exportar CSV",
        exportRequiresLogin: "Inicia sesion para exportar desde la consola.",
        exportFailed: "No se pudo exportar. Intenta de nuevo.",
        startReview: "Iniciar revision",
        searchPlaceholder: "Buscar residente, instalacion o ID",
        resultsLabel: "resultados",
        tableResident: "Residente",
        tableFacility: "Instalacion",
        tableRisk: "Riesgo",
        tableTug: "TUG",
        tableStatus: "Estado",
        tableUpdated: "Actualizado",
        drawerTitle: "Detalle de evaluacion",
        drawerBody: "Revisa y asigna siguientes pasos.",
        drawerClose: "Cerrar",
        drawerFacility: "Instalacion",
        drawerUpdated: "Actualizado",
        drawerDevice: "Dispositivo",
        deviceFallback: "Desconocido",
        flagsTitle: "Alertas de calidad",
        flagsFallback: "Sin alertas de calidad.",
        notesTitle: "Notas del revisor",
        nextStepsTitle: "Proximos pasos",
        notesFallback: "Agrega notas contextuales para esta evaluacion.",
        nextFallback: "Asignar siguiente accion",
        approve: "Aprobar y cerrar",
        followUp: "Enviar a seguimiento",
        emptyClosed: "Panel cerrado.",
        emptyNoMatch: "No hay evaluaciones con este filtro.",
        emptyOpen: "Abrir detalles",
      }
    : {
        badge: "Admin Review Console",
        eyebrow: "Clinical operations dashboard",
        heading: "Review assessments, prioritize risk, and close the loop fast.",
        lead:
          "Centralize clinical QA for every site and clinician. Keep turnaround fast, ensure documentation quality, and route next steps with confidence.",
        ctaPrimary: "Request Admin Access",
        ctaSecondary: "View Sample Queue",
        previewTitle: "Live review queue",
        previewChip: "Last 24 hours",
        previewFooterLeft: "Median review time",
        previewFooterRight: "Flags auto-surfaced",
        qualityTitle: "Quality controls built-in",
        qualityBody: "Automated alerts, score variance checks, and audit logs for every review.",
        coverageLabel: "Coverage",
        qaLabel: "QA sign-off",
        filterTitle: "Review filters",
        filterBody: "Focus the queue by status, risk tier, and site.",
        filterStatus: "Status",
        filterRisk: "Risk tier",
        filterFacilities: "Facilities",
        filterAllFacilities: "All facilities",
        filterReviewer: "Reviewer",
        alertsTitle: "Quality alerts",
        alertsCount: "3 open",
        alertsButton: "Open Alerts",
        queueTitle: "Assessment queue",
        queueBody: "Prioritized reviews across facilities and care teams.",
        exportCsv: "Export CSV",
        exportRequiresLogin: "Sign in to export from the admin console.",
        exportFailed: "Export failed. Please try again.",
        startReview: "Start Review",
        searchPlaceholder: "Search resident, facility, or ID",
        resultsLabel: "results",
        tableResident: "Resident",
        tableFacility: "Facility",
        tableRisk: "Risk",
        tableTug: "TUG",
        tableStatus: "Status",
        tableUpdated: "Updated",
        drawerTitle: "Assessment detail",
        drawerBody: "Review and assign next steps.",
        drawerClose: "Close",
        drawerFacility: "Facility",
        drawerUpdated: "Updated",
        drawerDevice: "Device",
        deviceFallback: "Unknown",
        flagsTitle: "Quality flags",
        flagsFallback: "No quality flags.",
        notesTitle: "Reviewer notes",
        nextStepsTitle: "Next steps",
        notesFallback: "Add contextual notes for this assessment.",
        nextFallback: "Assign next action",
        approve: "Approve & Close",
        followUp: "Send for Follow-up",
        emptyClosed: "Drawer closed.",
        emptyNoMatch: "No assessments match this filter.",
        emptyOpen: "Open details",
      };
  const previewQueue = reviewQueue.slice(0, 3);
  const riskFilterOptions = ["all", ...adminReviewFilters.risk];
  const facilityFilterOptions = facilityOptions.length
    ? [
        { id: "all", name: copy.filterAllFacilities },
        ...facilityOptions.map((facility) => ({ id: facility.id, name: facility.name })),
      ]
    : [
        { id: "all", name: copy.filterAllFacilities },
        ...adminReviewFilters.facilities.map((name) => ({ id: name, name })),
      ];

  const handleAdminExport = async () => {
    setExportNotice("");
    if (!token) {
      setExportNoticeTone("info");
      setExportNotice(copy.exportRequiresLogin);
      return;
    }
    const facilityId = facilityOptions.find((facility) => facility.id === facilityFilter)?.id || "";
    const query = buildQueryString({
      status: activeTab === "all" ? "" : activeTab,
      risk_tier: riskFilter === "all" ? "" : riskFilter,
      facility_id: facilityId,
    });
    try {
      await downloadProtected(`/exports/assessments${query}`, token, "admin_assessments.csv");
    } catch (_error) {
      setExportNoticeTone("error");
      setExportNotice(copy.exportFailed);
    }
  };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero admin-hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>{copy.badge}</span>
            </div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
            <p className="lead">{copy.lead}</p>
            <div className="cta-row">
              <button className="button primary" type="button">{copy.ctaPrimary}</button>
              <button className="button ghost" type="button">{copy.ctaSecondary}</button>
            </div>
            <div className="stat-row">
              {stats.map((stat) => (
                <div key={stat.label} className="stat-card">
                  <span className="stat-number">{stat.value}</span>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-media">
            <div className="admin-preview-card">
              <div className="admin-preview-header">
                <span>{copy.previewTitle}</span>
                <span className="media-chip">{copy.previewChip}</span>
              </div>
              <div className="admin-preview-list">
                {previewQueue.map((item) => (
                  <div key={item.id} className="admin-preview-item">
                    <div>
                      <strong>{item.resident}</strong>
                      <p className="text-muted">{item.facility}</p>
                    </div>
                    <span className={adminRiskClass[item.risk]}>{riskLabels[item.risk]}</span>
                  </div>
                ))}
              </div>
              <div className="admin-preview-footer">
                <div>
                  <span className="metric-label">{copy.previewFooterLeft}</span>
                  <strong>2.1 hrs</strong>
                </div>
                <div>
                  <span className="metric-label">{copy.previewFooterRight}</span>
                  <strong>6 today</strong>
                </div>
              </div>
            </div>
            <div className="workflow-card light">
              <h3>{copy.qualityTitle}</h3>
              <p>{copy.qualityBody}</p>
              <div className="workflow-metrics">
                <div>
                  <span className="metric-label">{copy.coverageLabel}</span>
                  <strong>98% weekly</strong>
                </div>
                <div>
                  <span className="metric-label">{copy.qaLabel}</span>
                  <strong>Same-day</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container admin-shell">
          <aside className="admin-sidebar">
            <div className="filter-card">
              <div>
                <h3>{copy.filterTitle}</h3>
                <p className="text-muted">{copy.filterBody}</p>
              </div>
              <div className="filter-group">
                <span className="filter-label">{copy.filterStatus}</span>
                <div className="filter-list">
                  {adminReviewFilters.status.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`filter-pill ${activeTab === item ? "active" : ""}`}
                      onClick={() => setActiveTab(item)}
                    >
                      {statusLabels[item]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <span className="filter-label">{copy.filterRisk}</span>
                <div className="filter-list">
                  {riskFilterOptions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`filter-pill ${riskFilter === item ? "active" : ""}`}
                      onClick={() => setRiskFilter(item)}
                    >
                      {riskLabels[item]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <span className="filter-label">{copy.filterFacilities}</span>
                <div className="filter-list">
                  {facilityFilterOptions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`filter-pill ${facilityFilter === item.id ? "active" : ""}`}
                      onClick={() => setFacilityFilter(item.id)}
                      disabled={facilityLoading}
                    >
                      {item.id === "all" ? copy.filterAllFacilities : item.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <span className="filter-label">{copy.filterReviewer}</span>
                <div className="filter-list">
                  {adminReviewFilters.reviewers.map((item) => (
                    <span key={item} className="filter-pill">{item}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="filter-card">
              <div className="filter-header">
                <h3>{copy.alertsTitle}</h3>
                <span className="alert-count">{copy.alertsCount}</span>
              </div>
              <ul className="alert-list">
                {alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
              <button className="button ghost small" type="button">{copy.alertsButton}</button>
            </div>
          </aside>

          <div className="admin-main">
            <div className="admin-kpi-grid">
              {kpis.map((metric) => (
                <div key={metric.label} className="admin-kpi">
                  <span>{metric.value}</span>
                  <p>{metric.label}</p>
                </div>
              ))}
            </div>

            <div className="admin-workspace">
              <div className="admin-table-card">
                <div className="table-header">
                  <div>
                    <h3>{copy.queueTitle}</h3>
                    <p>{copy.queueBody}</p>
                  </div>
                  <div className="table-actions">
                    <button className="button ghost small" type="button" onClick={handleAdminExport}>
                      {copy.exportCsv}
                    </button>
                    <button className="button primary small" type="button">{copy.startReview}</button>
                  </div>
                </div>
                {exportNotice ? (
                  <div className={`portal-message ${exportNoticeTone === "error" ? "portal-error" : ""}`}>
                    {exportNotice}
                  </div>
                ) : null}
                <div className="admin-toolbar">
                  <div className="admin-tabs">
                    {adminTabs.map((tab) => (
                      <button
                        key={tab}
                        className={`admin-tab ${activeTab === tab ? "active" : ""}`}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                      >
                        {statusLabels[tab]}
                      </button>
                    ))}
                  </div>
                  <div className="admin-search">
                    <input
                      type="search"
                      placeholder={copy.searchPlaceholder}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label={copy.searchPlaceholder}
                    />
                    <span className="search-count">{filteredQueue.length} {copy.resultsLabel}</span>
                  </div>
                </div>
                <div className="admin-table">
                  <div className="table-row table-head">
                    <span>{copy.tableResident}</span>
                    <span>{copy.tableFacility}</span>
                    <span>{copy.tableRisk}</span>
                    <span>{copy.tableTug}</span>
                    <span>{copy.tableStatus}</span>
                    <span>{copy.tableUpdated}</span>
                  </div>
                  {filteredQueue.map((row) => (
                    <div
                      key={row.id}
                      className={`table-row ${row.id === activeSelectedId ? "is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedId(row.id);
                        setDrawerOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(row.id);
                          setDrawerOpen(true);
                        }
                      }}
                    >
                      <div>
                        <strong>{row.resident}</strong>
                        <p className="text-muted">{row.id}</p>
                      </div>
                      <span>{row.facility}</span>
                      <span className={adminRiskClass[row.risk]}>{riskLabels[row.risk]}</span>
                      <span>{row.tug}</span>
                      <span className={adminStatusClass[row.status]}>{statusLabels[row.status]}</span>
                      <span>{row.updated}</span>
                    </div>
                  ))}
                </div>
              </div>

            {showDetails && (
              <div className="drawer-overlay" role="dialog" aria-modal="true">
                <button
                  className="drawer-backdrop"
                  type="button"
                  aria-label="Close detail drawer"
                  onClick={() => setDrawerOpen(false)}
                />
                <div className="drawer-panel" role="document">
                <div className="drawer-header">
                  <div>
                    <h3>{copy.drawerTitle}</h3>
                    <p className="text-muted">{copy.drawerBody}</p>
                  </div>
                  <button
                    className="button ghost small"
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                  >
                    {copy.drawerClose}
                  </button>
                </div>
                  <div className="drawer-summary">
                    <div>
                      <span className="metric-label">{copy.tableResident}</span>
                      <strong>{selected.resident}</strong>
                      <p className="text-muted">{selected.id}</p>
                    </div>
                    <div className="drawer-pill-row">
                      <span className={adminRiskClass[selected.risk]}>{riskLabels[selected.risk]}</span>
                      <span className={adminStatusClass[selected.status]}>{statusLabels[selected.status]}</span>
                    </div>
                  </div>
                  <div className="drawer-metrics">
                    <div className="detail-card">
                      <span className="metric-label">{copy.drawerFacility}</span>
                      <strong>{selected.facility}</strong>
                    </div>
                    <div className="detail-card">
                      <span className="metric-label">TUG</span>
                      <strong>{selected.tug}</strong>
                    </div>
                    <div className="detail-card">
                      <span className="metric-label">{copy.drawerUpdated}</span>
                      <strong>{selected.updated}</strong>
                    </div>
                    <div className="detail-card">
                      <span className="metric-label">{copy.drawerDevice}</span>
                      <strong>{selectedDetails.device || copy.deviceFallback}</strong>
                    </div>
                  </div>
                  <div className="drawer-section">
                    <h4>{copy.flagsTitle}</h4>
                    <ul>
                      {(selectedDetails.flags || [copy.flagsFallback]).map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="drawer-section">
                    <h4>{copy.notesTitle}</h4>
                    <p>{selectedDetails.notes || copy.notesFallback}</p>
                  </div>
                  <div className="drawer-section">
                    <h4>{copy.nextStepsTitle}</h4>
                    <ul>
                      {(selectedDetails.nextSteps || [copy.nextFallback]).map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="drawer-actions">
                    <button className="button primary small" type="button">{copy.approve}</button>
                    <button className="button ghost small" type="button">{copy.followUp}</button>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function AboutPage({ locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const stats = isEs ? aboutStatsEs : aboutStats;
  const highlights = isEs ? aboutHighlightsEs : aboutHighlights;
  const principles = isEs ? aboutPrinciplesEs : aboutPrinciples;
  const timeline = isEs ? aboutTimelineEs : aboutTimeline;

  const copy = isEs
    ? {
        badge: "Sobre StrideSafe",
        eyebrow: "Plataforma de prevencion de caidas",
        heading: "Ayudamos a equipos de cuidado a reducir el riesgo con evaluaciones objetivas.",
        lead:
          "StrideSafe convierte videos cortos en insights estandarizados, estratificacion de riesgo y reportes listos para documentacion. Servimos residencias, salud en el hogar y PT ambulatorio en EE.UU.",
        platformTitle: "Plataforma StrideSafe",
        platformChip: "Enfocado en EE.UU.",
        workflowTitle: "Disenado para equipos clinicos",
        workflowBody: "Evaluacion estandarizada, reportes claros y resultados medibles.",
        workflowMetric1: "Entornos de atencion",
        workflowMetric2: "Evaluaciones",
        workflowValue1: "Residencias + salud en el hogar",
        workflowValue2: "2-3 minutos",
        missionEyebrow: "Mision",
        missionHeading: "Hacer la prevencion de caidas medible, escalable y facil de adoptar.",
        missionBody:
          "Creemos que la prevencion debe ser accesible a todos los entornos, no solo laboratorios. StrideSafe lleva analisis objetivo, flujos validados y reportes accionables a la operacion diaria.",
        deliverTitle: "Lo que entrega la plataforma",
        deliverBody: "Insights consistentes sin hardware adicional.",
        deliverWorkflow: "Flujo",
        deliverOutputs: "Salidas",
        deliverReporting: "Reportes",
        deliverValue1: "TUG + chair stand + balance",
        deliverValue2: "Riesgo + plan de cuidado",
        deliverValue3: "Listo para documentacion",
        impactTitle: "Impacto clinico",
        impactBody: "Reduce variabilidad y aumenta volumen de evaluaciones.",
        chooseHeading: "Por que equipos eligen StrideSafe",
        chooseBody: "Profesional, compatible y construido para flujos clinicos.",
        complianceEyebrow: "Cumplimiento y privacidad",
        complianceHeading: "Seguridad y cumplimiento desde el primer dia.",
        complianceBody:
          "StrideSafe apoya operaciones alineadas con HIPAA, controles modernos, acceso por roles y auditoria.",
        operateTitle: "Donde operamos",
        operateBody: "Entornos en EE.UU. que requieren prevencion escalable.",
        supportTitle: "Soporte de implementacion",
        supportBody: "Ayudamos a configurar flujos, reportes y capacitacion.",
        enablesHeading: "Lo que permite la plataforma",
        enablesBody: "De captura a plan de cuidado en un solo flujo.",
        calloutTitle: "Habla con nuestro equipo clinico",
        calloutBody: "Te ayudamos a disenar el flujo adecuado para tu organizacion.",
        calloutButton: "Solicitar demo",
      }
    : {
        badge: "About StrideSafe",
        eyebrow: "Fall prevention platform",
        heading: "We help care teams reduce fall risk with fast, objective mobility screening.",
        lead:
          "StrideSafe is a clinical workflow platform that turns short smartphone videos into standardized gait insights, risk stratification, and documentation-ready reports. We serve senior living, home health, and outpatient PT organizations across the US.",
        platformTitle: "StrideSafe platform",
        platformChip: "US-focused",
        workflowTitle: "Designed for clinical teams",
        workflowBody: "Standardized screening, clear documentation, and measurable outcomes.",
        workflowMetric1: "Care settings",
        workflowMetric2: "Assessments",
        workflowValue1: "Senior living + home health",
        workflowValue2: "2-3 minutes",
        missionEyebrow: "Mission",
        missionHeading: "Make fall prevention measurable, scalable, and easy to adopt.",
        missionBody:
          "We believe high-quality fall prevention should be accessible to every care setting, not just research labs. StrideSafe brings objective gait analysis, validated screening workflows, and actionable reporting into everyday clinical operations.",
        deliverTitle: "What the platform delivers",
        deliverBody: "Consistent, repeatable mobility insights without additional hardware.",
        deliverWorkflow: "Workflow",
        deliverOutputs: "Outputs",
        deliverReporting: "Reporting",
        deliverValue1: "TUG + chair stand + balance",
        deliverValue2: "Risk tier + care plan",
        deliverValue3: "Documentation-ready",
        impactTitle: "Clinical impact",
        impactBody: "Reduce variability, improve consistency, and increase assessment volume.",
        chooseHeading: "Why teams choose StrideSafe",
        chooseBody: "Professional, compliant, and built for clinical workflows.",
        complianceEyebrow: "Compliance and privacy",
        complianceHeading: "Security and compliance built in from day one.",
        complianceBody:
          "StrideSafe is designed to support HIPAA-aligned operations with modern security controls, access management, and audit logging. We prioritize data minimization and transparent consent across every workflow.",
        operateTitle: "Where we operate",
        operateBody: "US-focused care settings that need scalable fall prevention.",
        supportTitle: "Implementation support",
        supportBody: "We help teams configure workflows, reporting, and staff training.",
        enablesHeading: "What the platform enables",
        enablesBody: "From capture to care planning in a single workflow.",
        calloutTitle: "Talk with our clinical team",
        calloutBody: "We will help you design the right fall-prevention workflow for your organization.",
        calloutButton: "Request a Demo",
      };

  const carePills = isEs
    ? ["Residencias", "Salud en el hogar", "PT ambulatorio", "Atencion primaria", "Ortopedia"]
    : ["Senior living", "Home health", "Outpatient PT", "Primary care", "Orthopedics"];

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero about-hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>{copy.badge}</span>
            </div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.heading}</h1>
            <p className="lead">{copy.lead}</p>
            <div className="stat-row">
              {stats.map((stat) => (
                <div key={stat.label} className="stat-card">
                  <span className="stat-number">{stat.value}</span>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-media">
            <div className="workflow-card floating">
              <div className="workflow-header">
                <span>{copy.platformTitle}</span>
                <span className="media-chip">{copy.platformChip}</span>
              </div>
              <div className="workflow-track">
                {timeline.map((step) => (
                  <div key={step.title} className="workflow-node">{step.title}</div>
                ))}
              </div>
            </div>
            <div className="workflow-card light">
              <h3>{copy.workflowTitle}</h3>
              <p>{copy.workflowBody}</p>
              <div className="workflow-metrics">
                <div>
                  <span className="metric-label">{copy.workflowMetric1}</span>
                  <strong>{copy.workflowValue1}</strong>
                </div>
                <div>
                  <span className="metric-label">{copy.workflowMetric2}</span>
                  <strong>{copy.workflowValue2}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div className="split-content">
            <p className="eyebrow">{copy.missionEyebrow}</p>
            <h2>{copy.missionHeading}</h2>
            <p>{copy.missionBody}</p>
            <div className="pill-row">
              {principles.map((item) => (
                <span key={item} className="pill">{item}</span>
              ))}
            </div>
          </div>
          <div className="split-visual">
            <div className="visual-card">
              <h3>{copy.deliverTitle}</h3>
              <p>{copy.deliverBody}</p>
              <div className="detail-grid">
                <div className="detail-card">
                  <span className="metric-label">{copy.deliverWorkflow}</span>
                  <strong>{copy.deliverValue1}</strong>
                </div>
                <div className="detail-card">
                  <span className="metric-label">{copy.deliverOutputs}</span>
                  <strong>{copy.deliverValue2}</strong>
                </div>
                <div className="detail-card">
                  <span className="metric-label">{copy.deliverReporting}</span>
                  <strong>{copy.deliverValue3}</strong>
                </div>
              </div>
            </div>
            <div className="visual-card highlight">
              <h3>{copy.impactTitle}</h3>
              <p>{copy.impactBody}</p>
              <div className="progress-line" />
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.chooseHeading}</h2>
            <p>{copy.chooseBody}</p>
          </div>
          <div className="grid features-grid">
            {highlights.map((item) => (
              <div key={item.title} className="feature-card">
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split reverse">
          <div className="split-content">
            <p className="eyebrow">{copy.complianceEyebrow}</p>
            <h2>{copy.complianceHeading}</h2>
            <p>{copy.complianceBody}</p>
            <div className="cert-grid">
              <div className="cert-chip">HIPAA-aligned</div>
              <div className="cert-chip">SOC 2 Type II</div>
              <div className="cert-chip">Role-based access</div>
              <div className="cert-chip">Audit-ready logs</div>
            </div>
          </div>
          <div className="split-visual">
            <div className="visual-card">
              <h3>{copy.operateTitle}</h3>
              <p>{copy.operateBody}</p>
              <div className="pill-row">
                {carePills.map((pill) => (
                  <span key={pill} className="pill">{pill}</span>
                ))}
              </div>
            </div>
            <div className="visual-card highlight">
              <h3>{copy.supportTitle}</h3>
              <p>{copy.supportBody}</p>
              <div className="progress-line" />
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.enablesHeading}</h2>
            <p>{copy.enablesBody}</p>
          </div>
          <div className="timeline">
            {timeline.map((step) => (
              <div key={step.title} className="timeline-card">
                <span className="timeline-step">{step.title}</span>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container callout secondary">
          <div>
            <h2>{copy.calloutTitle}</h2>
            <p>{copy.calloutBody}</p>
          </div>
          <button className="button ghost" type="button">{copy.calloutButton}</button>
        </div>
      </section>
    </Layout>
  );
}

function PortalPage({ locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const copy = isEs
    ? {
        badge: "Portal clinico",
        eyebrow: "MVP listo para piloto en residencias y salud en el hogar",
        heading: "Evalua riesgo de caidas, sube video y genera reportes en minutos.",
        lead:
          "El portal clinico de StrideSafe permite crear residentes, iniciar evaluaciones, capturar TUG/Chair Stand/Balance y generar PDFs listos para documentacion.",
        accessTitle: "Acceso clinico",
        accessBadge: "Acceso seguro",
        accessBody: "Inicia sesion para acceder a residentes, evaluaciones y reportes.",
        accessSecurityTitle: "Resumen de cumplimiento",
        accessSecurityBody: "Disenado para el mercado de EE.UU. con controles listos para auditoria.",
        accessSecurityBullets: [
          "SOC 2 Tipo II y controles de seguridad documentados.",
          "Flujos alineados con HIPAA y registros de auditoria.",
          "Acceso basado en roles y trazabilidad por usuario.",
          "Cifrado en reposo y en transito.",
        ],
        accessSecurityChips: ["SOC 2 Type II", "HIPAA alineado", "EE.UU."],
        roleLabel: "Rol",
        roleAdmin: "Admin",
        roleClinician: "Clinico",
        navOverview: "Panel",
        navNotifications: "Notificaciones",
        navOutcomes: "Resultados",
        navWorkflow: "Workflow",
        navPtWorkflow: "StrideSafe TherapyFlow",
        navResidents: "Residentes",
        navAssessments: "Evaluaciones",
        navIncidents: "Incidentes",
        navUploads: "Carga de video",
        navScores: "Puntajes",
        navReports: "Reportes",
        navUsers: "Usuarios",
        navFacilities: "Instalaciones",
        navUnits: "Unidades",
        navExports: "Exportaciones",
        navAudit: "Auditoria",
        navQa: "QA de piloto",
        onboardingTitle: "Checklist de onboarding",
        onboardingBody: "Completa estos pasos para iniciar el piloto.",
        onboardingProgressLabel: "Progreso",
        onboardingResume: "Continuar onboarding",
        onboardingSkip: "Omitir por ahora",
        onboardingBack: "Atras",
        onboardingNext: "Siguiente",
        onboardingFinish: "Finalizar configuracion",
        onboardingAdminOnly: "Solo admin",
        onboardingAdminNote: "Este paso requiere un admin. Pide a tu admin que lo complete.",
        onboardingChecklistLabel: "Checklist",
        onboardingStepLabel: "Paso",
        onboardingStatusDone: "Completado",
        onboardingStatusPending: "Pendiente",
        overviewTitle: "Resumen operativo",
        overviewBody: "Estado rapido de actividad y flujo clinico.",
        overviewResidents: "Residentes activos",
        overviewAssessments: "Evaluaciones (residente)",
        overviewLastAssessment: "Ultima evaluacion",
        overviewReport: "Reporte reciente",
        overviewReportReady: "Listo",
        overviewReportEmpty: "Pendiente",
        overviewActions: "Acciones rapidas",
        notificationsTitle: "Notificaciones",
        notificationsBody: "Alertas de evaluaciones, reportes listos y actividad clinica.",
        notificationsFilterLabel: "Filtro",
        notificationsFilterUnread: "Sin leer",
        notificationsFilterRead: "Leidas",
        notificationsLoad: "Actualizar",
        notificationsMarkRead: "Marcar como leido",
        notificationsMarkAll: "Marcar todo como leido",
        notificationsConfirmTitle: "Marcar notificaciones como leidas?",
        notificationsConfirmBodyAll: "Esto marcara todas las notificaciones sin leer como leidas.",
        notificationsConfirmBodyUnread: "Esto marcara todas las notificaciones sin leer en este filtro.",
        notificationsConfirmSkip: "No volver a preguntar",
        notificationsConfirmCancel: "Cancelar",
        notificationsConfirmAction: "Confirmar",
        notificationsEmpty: "No hay notificaciones.",
        notificationsStatusUnread: "Sin leer",
        notificationsStatusRead: "Leido",
        notificationsEmailSent: "Correo enviado",
        notificationsEmailQueued: "Correo en cola",
        notificationsDeliveryLabel: "Entrega de correo",
        notificationsDeliveryAll: "Todos",
        notificationsDeliverySent: "Enviado",
        notificationsDeliveryQueued: "En cola",
        outcomesTitle: "Resultados clinicos",
        outcomesBody: "Tendencias de riesgo y cambio clinico por residente.",
        outcomesWindowLabel: "Ventana (dias)",
        outcomesWeeksLabel: "Semanas",
        outcomesLoad: "Actualizar",
        outcomesImproved: "Mejora",
        outcomesWorsened: "Empeora",
        outcomesStable: "Estable",
        outcomesUnknown: "Sin datos",
        outcomesAssessed: "Residentes evaluados",
        outcomesTotalResidents: "Residentes totales",
        outcomesTrendTitle: "Tendencia semanal de riesgo",
        outcomesTrendBody: "Distribucion de riesgo por semana.",
        outcomesResidentsTitle: "Cambios por residente",
        outcomesResidentsBody: "Ultimas evaluaciones por residente.",
        outcomesEmpty: "Sin resultados aun.",
        outcomesTrendImproved: "Mejora",
        outcomesTrendWorsened: "Empeora",
        outcomesTrendStable: "Estable",
        outcomesTrendUnknown: "Sin datos",
        outcomesLatestLabel: "Ultimo",
        outcomesPreviousLabel: "Anterior",
        outcomesRiskLow: "Bajo",
        outcomesRiskModerate: "Moderado",
        outcomesRiskHigh: "Alto",
        workflowTitle: "Cola de workflow",
        workflowBody: "Asignaciones, estado y SLAs para evaluaciones e incidentes post-caida.",
        workflowStatusLabel: "Estado",
        workflowAssignedLabel: "Asignacion",
        workflowUnitLabel: "Unidad",
        workflowAssignedMe: "Asignado a mi",
        workflowAssignedUnassigned: "Sin asignar",
        workflowRefresh: "Actualizar",
        workflowEmpty: "No hay evaluaciones ni incidentes en la cola.",
        workflowAssignedTo: "Asignado",
        workflowSlaLabel: "SLA",
        workflowDueLabel: "Vence",
        workflowClaim: "Tomar",
        workflowUnassign: "Liberar",
        workflowStartReview: "Iniciar revision",
        workflowComplete: "Completar",
        workflowOverdue: "Atrasado",
        workflowOnTrack: "En curso",
        workflowDueSoon: "Por vencer",
        workflowIncidentLabel: "Seguimiento post-caida",
        workflowIncidentOpen: "Ver incidente",
        workflowChecklistLabel: "Checklist",
        ptWorkflowTitle: "StrideSafe TherapyFlow",
        ptWorkflowBody: "Vista guiada del flujo PT para la evaluacion seleccionada.",
        ptWorkflowProgressLabel: "Progreso",
        ptWorkflowStepsTitle: "Pasos PT",
        ptWorkflowActionsTitle: "Acciones rapidas",
        ptWorkflowContextTitle: "Contexto actual",
        ptWorkflowContextBody: "Los pasos reflejan el residente y evaluacion seleccionados.",
        ptWorkflowNextLabel: "Siguiente paso",
        ptWorkflowNextBody: "Usa las acciones rapidas para continuar.",
        ptWorkflowAllDone: "Todos los pasos estan completos.",
        ptWorkflowAllDoneBody: "Puedes iniciar una nueva evaluacion o exportar el reporte.",
        ptWorkflowStepResident: "Selecciona residente",
        ptWorkflowStepAssessment: "Crea evaluacion",
        ptWorkflowStepVideo: "Carga video",
        ptWorkflowStepScores: "Captura puntajes",
        ptWorkflowStepQa: "Completa QA",
        ptWorkflowStepReport: "Genera reporte",
        ptDetailsTitle: "Documentacion PT",
        ptDetailsBody: "Registra CPT, metas y plan de cuidado para el resumen.",
        ptChecklistTitle: "Checklist PT",
        ptChecklistBody: "Completa los requisitos antes de exportar.",
        ptFieldCptLabel: "Codigos CPT",
        ptFieldCptHint: "Separa por comas (ej. 97110, 97112).",
        ptFieldGoalsLabel: "Metas clinicas",
        ptFieldPlanLabel: "Plan de cuidado",
        ptFieldPainLabel: "Escala de dolor (0-10)",
        ptFieldSessionLabel: "Tiempo de sesion (min)",
        ptFieldTimeSavedLabel: "Tiempo ahorrado (min)",
        ptFieldTimeSavedHint: "Estimacion basada en flujo tradicional de 20-45 min.",
        ptFieldPainInvalid: "La escala de dolor debe estar entre 0 y 10.",
        ptFieldMinutesInvalid: "Los minutos deben estar entre 0 y 240.",
        ptSaveButton: "Guardar detalles PT",
        ptSaveSuccess: "Detalles PT guardados.",
        ptSaveError: "No se pudieron guardar los detalles PT.",
        ptTimerTitle: "Temporizador de sesion",
        ptTimerStart: "Iniciar",
        ptTimerPause: "Pausar",
        ptTimerReset: "Reiniciar",
        ptTimerApply: "Usar tiempo",
        ptSummaryTitle: "Resumen PT",
        ptSummaryBody: "Exporta un PDF listo para documentacion.",
        ptSummaryDownload: "Descargar resumen PT",
        ptSummaryBlocked: "Completa la checklist PT para exportar.",
        topbarWelcome: "Bienvenido",
        analyticsTitle: "Analitica operativa",
        analyticsBody: "Indicadores claves para seguimiento del piloto.",
        analyticsPostFallTitle: "Cumplimiento post-caida",
        analyticsPostFallBody: "Checklist y seguimiento de SLA dentro de la ventana.",
        analyticsPostFallIncidents: "Incidentes en ventana",
        analyticsPostFallCompletion: "Checklist completado",
        analyticsPostFallOpen: "Pendientes",
        analyticsPostFallOverdue: "Atrasados",
        analyticsPostFallSla: "SLA de seguimiento (dias)",
        analyticsPostFallFilterLabel: "Filtro por unidad",
        analyticsPostFallExport: "Exportar resumen",
        analyticsPostFallRollupEmpty: "Sin incidentes post-caida por unidad aun.",
        analyticsPostFallUnitUnassigned: "Sin unidad",
        postFallBadgeOverdue: "SLA atrasado",
        postFallBadgeOpen: "SLA pendiente",
        postFallBadgeOnTrack: "SLA en curso",
        analyticsAssessments: "Evaluaciones por semana",
        analyticsAvgTime: "Tiempo promedio (min)",
        analyticsReassessment: "Tasa de reevaluacion",
        analyticsDueToday: "Evaluaciones hoy",
        analyticsOverdue: "Evaluaciones atrasadas",
        analyticsCompletionRate: "Tasa de completado",
        analyticsHighRiskRate: "Riesgo alto",
        analyticsWindowLabel: "Ventana (dias)",
        analyticsTotal: "Evaluaciones totales",
        analyticsCompleted: "Evaluaciones completadas",
        analyticsVideoCoverage: "Cobertura de video",
        analyticsReportCoverage: "Cobertura de reportes",
        analyticsTimeToReport: "Tiempo promedio a reporte (min)",
        analyticsVideos: "Videos cargados",
        analyticsReports: "Reportes generados",
        analyticsUpdated: "Actualizado",
        analyticsLoad: "Actualizar analitica",
        analyticsError: "No se pudo cargar la analitica.",
        qaTitle: "Checklist QA",
        qaBody: "Verifica que cada evaluacion cumpla los requisitos del piloto.",
        qaAdd: "Agregar item",
        qaExport: "Exportar QA",
        qaResident: "Residente",
        qaAssessment: "Evaluacion",
        qaChecklist: "Checklist",
        qaNotes: "Notas",
        qaStatusLabel: "Estado QA",
        qaStatusReady: "Listo",
        qaStatusNeeds: "Pendiente",
        qaStatusEscalated: "Escalado",
        qaEscalateAction: "Escalar",
        qaEmpty: "No hay evaluaciones para revisar.",
        qaStepVideo: "Video claro y estable",
        qaStepLighting: "Iluminacion adecuada",
        qaStepTug: "TUG completado",
        qaStepChair: "Chair Stand completado",
        qaStepBalance: "Balance documentado",
        qaStepRisk: "Riesgo asignado",
        emailLabel: "Correo",
        passwordLabel: "Contrasena",
        loginButton: "Iniciar sesion",
        loginBusy: "Ingresando...",
        saving: "Guardando...",
        logout: "Cerrar sesion",
        signedIn: "Sesion activa",
        facilityLabel: "Instalacion",
        residentsTitle: "Residentes",
        residentsBody: "Busca, selecciona o crea un residente nuevo.",
        residentSearch: "Buscar residente, ID o ubicacion",
        residentEmpty: "No hay residentes todavia.",
        residentFilterEmptyList: "No hay residentes que coincidan.",
        residentCount: "Mostrando",
        residentCountOf: "de",
        residentFilterSex: "Sexo",
        residentFilterLocation: "Ubicacion",
        residentFilterLocationPlaceholder: "Edificio, piso, unidad, habitacion",
        residentFilterAll: "Todos",
        residentSort: "Ordenar",
        residentSortNewest: "Mas recientes",
        residentSortName: "Nombre A-Z",
        residentSelect: "Selecciona un residente para ver evaluaciones.",
        residentNew: "Agregar residente",
        residentFirst: "Nombre",
        residentLastName: "Apellido",
        residentDob: "Fecha de nacimiento",
        residentDobFuture: "La fecha no puede ser en el futuro.",
        residentSex: "Sexo",
        residentSexSelect: "Seleccionar",
        residentExternal: "ID externo",
        residentIdShort: "ID",
        residentAgeLabel: "Edad",
        residentNotes: "Notas",
        residentSave: "Guardar residente",
        residentClear: "Limpiar formulario",
        residentDuplicateWarning: "Posible duplicado detectado. Verifica antes de crear.",
        residentDuplicateAction: "Crear de todas formas",
        residentDrawer: "Detalle del residente",
        residentDrawerToggle: "Ocultar detalle",
        residentDrawerShow: "Ver detalle",
        residentOverview: "Resumen del residente",
        residentHistory: "Historial de evaluaciones",
        residentLastAssessment: "Ultima evaluacion",
        residentTotal: "Total de evaluaciones",
        residentNone: "Sin evaluaciones registradas.",
        residentFilterEmpty: "Ninguna evaluacion coincide con el filtro.",
        residentLabelName: "Nombre",
        residentLabelDob: "Fecha de nacimiento",
        residentLabelAge: "Edad",
        residentLabelSex: "Sexo",
        residentLabelExternal: "ID externo",
        residentLabelBuilding: "Edificio",
        residentLabelFloor: "Piso",
        residentLabelUnit: "Unidad",
        residentLabelRoom: "Habitacion",
        residentLabelUnitAssignment: "Unidad asignada",
        residentLabelNotes: "Notas",
        residentEditTitle: "Editar residente",
        residentEditSave: "Guardar cambios",
        residentEditReset: "Restablecer",
        residentEditSaved: "Cambios guardados.",
        residentEditError: "No se pudieron guardar los cambios.",
        assessmentsTitle: "Evaluaciones",
        assessmentsBody: "Crea una evaluacion para el residente seleccionado.",
        assessmentEmpty: "No hay evaluaciones para este residente.",
        assessmentNew: "Nueva evaluacion",
        assessmentDate: "Fecha de evaluacion",
        assessmentScheduled: "Fecha programada",
        assessmentDue: "Fecha limite",
        assessmentDevice: "Dispositivo de apoyo",
        assessmentSave: "Crear evaluacion",
        assessmentCreated: "Evaluacion creada.",
        assessmentSearch: "Buscar evaluaciones",
        assessmentFilterEmptyList: "No hay evaluaciones que coincidan.",
        assessmentSelected: "Evaluacion seleccionada",
        assessmentStepVideo: "Video",
        assessmentStepScores: "Puntajes",
        assessmentStepReport: "Reporte",
        assessmentStatusDone: "Listo",
        assessmentStatusMissing: "Pendiente",
        assessmentDueToday: "Vence hoy",
        assessmentOverdue: "Atrasado",
        assessmentUpcoming: "Proximo",
        assessmentScheduleTitle: "Programacion",
        assessmentScheduleBody: "Actualiza fechas de esta evaluacion.",
        assessmentScheduleSave: "Guardar programacion",
        assessmentScheduleSaved: "Programacion actualizada.",
        assessmentQuickActions: "Siguientes acciones",
        incidentsTitle: "Incidentes de caidas",
        incidentsBody: "Registra caidas y seguimiento post-caida.",
        incidentSelectResident: "Selecciona un residente para ver incidentes.",
        incidentSelectEvent: "Selecciona un incidente para ver el checklist.",
        incidentEmpty: "No hay incidentes registrados.",
        incidentNew: "Registrar caida",
        incidentOccurredAt: "Fecha y hora",
        incidentSeverity: "Severidad de lesion",
        incidentSeverityNone: "Sin lesion",
        incidentSeverityMinor: "Leve",
        incidentSeverityModerate: "Moderada",
        incidentSeveritySevere: "Severa",
        incidentEmsCalled: "EMS llamado",
        incidentHospitalTransfer: "Traslado a hospital",
        incidentWitness: "Testigo",
        incidentAssistiveDevice: "Dispositivo de apoyo",
        incidentFactors: "Factores contribuyentes",
        incidentFactorsHint: "Separar por comas (iluminacion, calzado, medicamentos).",
        incidentNotes: "Notas",
        incidentSave: "Guardar incidente",
        incidentSaved: "Incidente registrado.",
        incidentChecklistTitle: "Checklist post-caida",
        incidentChecklistEmpty: "No hay items configurados.",
        incidentChecklistPending: "Pendiente",
        incidentChecklistDone: "Completado",
        incidentFollowupDue: "Seguimiento pendiente",
        incidentFollowupOverdue: "Seguimiento atrasado",
        incidentLinkedAssessment: "Ultima evaluacion",
        incidentLinkedRisk: "Riesgo",
        fallCheckVitals: "Signos vitales registrados",
        fallCheckNeuro: "Chequeo neurologico completado",
        fallCheckNotify: "Familia/medico notificado",
        fallCheckEnvironment: "Entorno revisado",
        fallCheckMedReview: "Revision de medicamentos marcada",
        fallCheckFollowUp: "Evaluacion de seguimiento programada",
        uploadTitle: "Carga de video",
        uploadBody: "Sube un MP4 o MOV. Puedes incluir metadatos si estan disponibles.",
        uploadFile: "Archivo de video",
        uploadFileHint: `Max ${MAX_VIDEO_SIZE_MB} MB`,
        uploadGuidelinesTitle: "Guia de carga",
        uploadRuleDuration: "Duracion 10-120 seg",
        uploadRuleResolution: "Resolucion minima 640 x 360",
        uploadRuleFormat: "Archivo MP4 o MOV",
        uploadMetaHint: "Si no se detectan metadatos, ingresa los valores.",
        uploadAutoCreate: "No hay una evaluacion seleccionada. Crearemos una nueva al subir el video.",
        uploadClear: "Limpiar carga",
        uploadSelected: "Archivo seleccionado",
        uploadDuration: "Duracion (segundos)",
        uploadWidth: "Ancho (px)",
        uploadHeight: "Alto (px)",
        uploadButton: "Subir video",
        uploadBusy: "Subiendo...",
        uploadSuccess: "Video cargado correctamente.",
        uploadRequired: "Selecciona un archivo de video.",
        uploadTypeError: "Tipo de archivo no compatible. Usa MP4 o MOV.",
        uploadSizeError: `El archivo supera ${MAX_VIDEO_SIZE_MB} MB.`,
        uploadProgressLabel: "Progreso de carga",
        uploadMetaError: "Ingresa un numero valido.",
        uploadMetaAutoError: "No se pudieron leer los metadatos. Ingresa los valores manualmente.",
        scoresTitle: "Puntajes y riesgo",
        scoresBody: "Registra TUG, Chair Stand y balance.",
        badgeVideo: "Video cargado",
        badgeScores: "Puntajes sincronizados",
        riskLabel: "Nivel de riesgo",
        statusLabel: "Estado",
        tugLabel: "TUG (segundos)",
        chairLabel: "Chair Stand (segundos)",
        balanceSide: "Balance lado a lado",
        balanceSemi: "Balance semi-tandem",
        balanceTandem: "Balance tandem",
        scoreNotes: "Notas clinicas",
        clinicianNotes: "Notas del clinico",
        scoreSave: "Guardar puntajes",
        scoreSuccess: "Puntajes guardados.",
        scoreBusy: "Guardando...",
        scoreInvalid: "Ingresa un numero valido.",
        syncModelScores: "Sincronizar puntajes del modelo",
        syncModelScoresBusy: "Sincronizando...",
        syncModelScoresDone: "Puntajes del modelo sincronizados.",
        syncModelScoresPending: "El modelo aun se esta ejecutando.",
        syncModelScoresNone: "No hay puntajes del modelo disponibles.",
        syncModelScoresError: "No se pudieron sincronizar los puntajes del modelo.",
        runModelNow: "Ejecutar modelo ahora",
        runModelBusy: "Ejecutando modelo...",
        runModelQueued: "El modelo se ha puesto en cola.",
        runModelNoVideo: "Necesitas un video para ejecutar el modelo.",
        runModelConflict: "El modelo ya esta en ejecucion.",
        scoreRange: "El valor debe estar entre 0 y 300.",
        reportTitle: "Reporte",
        reportBody: "Genera y descarga el PDF clinico.",
        reportSummaryTitle: "Resumen del reporte",
        reportSummaryEmpty: "No hay reporte generado.",
        reportCreatedOn: "Generado",
        reportChecklistTitle: "Antes de generar",
        reportChecklistVideo: "Video cargado",
        reportChecklistScores: "Puntajes completos",
        reportChecklistNotes: "Notas clinicas agregadas",
        reportReadyLabel: "Reporte listo",
        reportGenerateHelp: "Puedes generar en cualquier momento, pero completa video y puntajes para mejores resultados.",
        reportGatePrefix: "Completa para generar el reporte:",
        reportGateVideoItem: "cargar un video",
        reportGateScoresItem: "completar puntajes",
        reportGateQaItem: "completar checklist QA",
        reportChecklistQa: "Checklist QA completo",
        reportButton: "Generar reporte",
        reportBusy: "Generando...",
        reportDownload: "Descargar PDF",
        reportPreview: "Vista previa",
        reportHidePreview: "Ocultar vista previa",
        reportPreviewBusy: "Cargando vista previa...",
        reportPreviewError: "No se pudo cargar la vista previa.",
        reportHistoryTitle: "Historial de reportes",
        reportHistoryBody: "Ultimos reportes generados para esta evaluacion.",
        reportHistoryEmpty: "No hay reportes aun.",
        reportHistoryDownload: "Descargar",
        reportTypeAssessment: "Reporte clinico",
        reportTypePtSummary: "Resumen PT",
        refresh: "Actualizar",
        loading: "Cargando...",
        selectAssessment: "Selecciona una evaluacion para continuar.",
        selectResident: "Selecciona un residente para continuar.",
        sessionExpired: "La sesion expiro. Inicia sesion de nuevo.",
        genericError: "Algo salio mal. Intenta de nuevo.",
        residentMissing: "Completa nombre, apellido y fecha de nacimiento.",
        assessmentMissing: "Selecciona una fecha valida.",
        assessmentDueInvalid: "La fecha limite debe ser igual o posterior.",
        filterStatus: "Estado",
        filterRisk: "Riesgo",
        filterFrom: "Desde",
        filterTo: "Hasta",
        filterAll: "Todos",
        exportCsv: "Exportar CSV",
        adminToolsTitle: "Herramientas admin",
        adminToolsBody: "Auditoria y control de actividad.",
        exportCenterTitle: "Centro de exportaciones",
        exportCenterBody: "Genera enlaces seguros y revisa el historial de exportaciones.",
        exportTokenTitle: "Crear token de exportacion",
        exportTokenType: "Tipo de exportacion",
        exportTokenFacility: "Instalacion",
        exportFacilityPlaceholder: "ID de instalacion (opcional)",
        exportTokenExpires: "Expira en (horas)",
        exportTokenCreate: "Crear token",
        exportTokenBusy: "Creando...",
        exportTokenSuccess: "Token creado.",
        exportTokenLink: "Enlace de descarga",
        exportTokenId: "ID del token",
        exportTokenDownload: "Descargar exportacion",
        exportTokenFilters: "Filtros de exportacion",
        exportTokenInclude: "Incluir",
        exportIncludeResidents: "Residentes",
        exportIncludeAssessments: "Evaluaciones",
        exportIncludeAudit: "Auditoria",
        exportIncludeRequired: "Selecciona al menos un elemento para el paquete.",
        exportExpiresInvalid: "Horas invalidas. Usa 1-168.",
        exportLogsTitle: "Registros de exportacion",
        exportLogsBody: "Actividad reciente de exportaciones.",
        exportLogsLoad: "Cargar registros",
        exportLogsEmpty: "Sin actividad de exportacion.",
        exportLogsType: "Tipo",
        exportLogsStatus: "Estado",
        exportLogsWhen: "Fecha",
        exportLogsToken: "Token",
        exportLogsLimit: "Limite",
        exportLogsFilterType: "Tipo",
        exportTypeResidents: "Residentes",
        exportTypeAssessments: "Evaluaciones",
        exportTypeAudit: "Auditoria",
        exportTypeBundle: "Paquete",
        exportTypePostFallRollup: "Post-caida (resumen por unidad)",
        exportFilterResident: "ID de residente",
        exportFilterStatus: "Estado",
        exportFilterRisk: "Riesgo",
        exportFilterFrom: "Desde",
        exportFilterTo: "Hasta",
        exportFilterAssigned: "Asignado a",
        exportFilterScheduledFrom: "Programado desde",
        exportFilterScheduledTo: "Programado hasta",
        exportFilterDueFrom: "Vence desde",
        exportFilterDueTo: "Vence hasta",
        exportAssignedPlaceholder: "ID de usuario o unassigned",
        exportAuditAction: "Accion",
        exportAuditEntity: "Entidad",
        exportAuditUser: "Usuario",
        exportAuditFrom: "Desde",
        exportAuditTo: "Hasta",
        exportAuditLimit: "Limite",
        exportScheduleTitle: "Programaciones de exportacion",
        exportScheduleBody: "Exportaciones recurrentes con filtros.",
        exportScheduleName: "Nombre",
        exportScheduleFrequency: "Frecuencia",
        exportScheduleDaily: "Diaria",
        exportScheduleWeekly: "Semanal",
        exportScheduleDay: "Dia",
        exportScheduleHour: "Hora",
        exportScheduleMinute: "Minuto",
        exportScheduleStatus: "Estado",
        exportScheduleActive: "Activa",
        exportSchedulePaused: "Pausada",
        exportScheduleExpires: "Expira en (horas)",
        exportScheduleCreate: "Guardar programacion",
        exportScheduleEdit: "Editar",
        exportScheduleUpdate: "Actualizar programacion",
        exportScheduleCancel: "Cancelar edicion",
        exportScheduleCreated: "Programacion creada.",
        exportScheduleUpdated: "Programacion actualizada.",
        exportScheduleRun: "Ejecutar ahora",
        exportSchedulePause: "Pausar",
        exportScheduleResume: "Reanudar",
        exportScheduleEmpty: "No hay programaciones.",
        exportScheduleNextRun: "Proxima ejecucion",
        exportScheduleLastRun: "Ultima ejecucion",
        facilityRollupTitle: "Resumen por instalacion",
        facilityRollupBody: "Estado agregado por sitio.",
        facilityRollupResidents: "Residentes",
        facilityRollupAssessments: "Evaluaciones",
        facilityRollupCompleted: "Completadas",
        facilityRollupHighRisk: "Alto riesgo",
        facilityRollupDueToday: "Vence hoy",
        facilityRollupOverdue: "Atrasadas",
        facilityRollupReports: "Reportes",
        facilityRollupLoad: "Actualizar",
        facilityRollupEmpty: "Sin datos de instalaciones.",
        auditFiltersTitle: "Filtros de auditoria",
        auditPresetsLabel: "Atajos",
        auditPreset24h: "Ultimas 24 h",
        auditPreset7d: "Ultimos 7 dias",
        auditPreset30d: "Ultimos 30 dias",
        auditPresetMe: "Solo mi actividad",
        auditFilterAction: "Accion",
        auditFilterEntity: "Entidad",
        auditFilterUser: "Usuario",
        auditFilterUserAll: "Todos los usuarios",
        auditFilterFrom: "Desde",
        auditFilterTo: "Hasta",
        auditFilterLimit: "Limite",
        auditApply: "Aplicar filtros",
        auditReset: "Restablecer",
        auditLoad: "Cargar auditoria",
        auditExport: "Exportar CSV",
        auditExportBusy: "Exportando...",
        auditExportError: "No se pudo exportar la auditoria.",
        auditEmpty: "Sin eventos recientes.",
        auditAction: "Accion",
        auditEntity: "Entidad",
        auditWhen: "Fecha",
        auditUser: "Usuario",
        auditId: "ID",
        auditNotAllowed: "Solo admins pueden ver la auditoria.",
        userAdminTitle: "Gestion de usuarios",
        userAdminBody: "Crea cuentas clinicas, ajusta roles y restablece contrasenas.",
        facilityAdminTitle: "Gestion de instalaciones",
        facilityAdminBody: "Administra perfiles y configuraciones del piloto.",
        facilitySettingsTitle: "Pilot defaults",
        facilitySettingsBody: "Recommended protocols and capture methods for clinical flow.",
        facilityProtocolLabel: "Assessment protocol",
        facilityProtocolOptionDefault: "TUG + Chair Stand + Balance (recommended)",
        facilityProtocolOptionTug: "TUG only",
        facilityProtocolOptionBalance: "Balance only",
        facilityCaptureLabel: "Capture method",
        facilityCaptureOptionRecord: "Record + upload (recommended)",
        facilityCaptureOptionUpload: "Upload only",
        facilityRolePolicyLabel: "Role policy",
        facilityRolePolicyClinicianAdmin: "Clinician + Admin (recommended)",
        facilityRolePolicyAdminOnly: "Admin only",
        facilityListEmpty: "No hay instalaciones.",
        facilitySearch: "Buscar instalaciones",
        facilityAddTitle: "Agregar instalacion",
        facilityEditTitle: "Editar instalacion",
        facilityName: "Nombre de instalacion",
        facilityAddress1: "Direccion linea 1",
        facilityAddress2: "Direccion linea 2",
        facilityCity: "Ciudad",
        facilityState: "Estado",
        facilityZip: "Codigo postal",
        facilityCadence: "Cadencia de reevaluacion (dias)",
        facilityReportSla: "Tiempo a reporte (horas)",
        facilityChecklist: "Checklist QA",
        facilityChecklistHint: "Un item por linea.",
        facilityFallChecklist: "Checklist post-caida",
        facilityFallChecklistHint: "Un item por linea.",
        facilityCreateButton: "Crear instalacion",
        facilitySaveButton: "Guardar cambios",
        facilitySelectHint: "Selecciona una instalacion para editar.",
        facilityCreated: "Instalacion creada.",
        facilityUpdated: "Instalacion actualizada.",
        facilityRequired: "Campo requerido.",
        facilityNumberInvalid: "Ingresa un numero valido.",
        unitsTitle: "Unidades",
        unitsBody: "Gestiona edificios, pisos y unidades para enrutar el trabajo.",
        unitLabel: "Nombre de unidad",
        unitBuilding: "Edificio",
        unitFloor: "Piso",
        unitUnit: "Unidad",
        unitRoom: "Habitacion",
        unitCreate: "Crear unidad",
        unitCreated: "Unidad creada.",
        unitEmpty: "No hay unidades.",
        unitSelectHint: "Selecciona una unidad para asignar.",
        userListTitle: "Usuarios",
        userListEmpty: "No hay usuarios adicionales.",
        userSearch: "Buscar por nombre o correo",
        userAddTitle: "Crear usuario",
        userEditTitle: "Editar usuario",
        userEmailLabel: "Correo",
        userNameLabel: "Nombre completo",
        userRoleLabel: "Rol",
        userStatusLabel: "Estado",
        userPasswordLabel: "Contrasena temporal",
        userPasswordReset: "Nueva contrasena",
        userPasswordHint: "Se requiere para crear usuario.",
        userPasswordOptional: "Deja en blanco para mantener la contrasena actual.",
        userRequired: "Campo requerido.",
        userCreateButton: "Crear usuario",
        userSaveButton: "Guardar cambios",
        userSelectHint: "Selecciona un usuario para editar.",
        userRoleAdmin: "Admin",
        userRoleClinician: "Clinico",
        userStatusActive: "Activo",
        userStatusInactive: "Inactivo",
        userCreated: "Usuario creado.",
        userUpdated: "Usuario actualizado.",
        statusDraft: "Borrador",
        statusNeeds: "Pendiente",
        statusReview: "En revision",
        statusDone: "Completado",
        riskLow: "Bajo",
        riskModerate: "Moderado",
        riskHigh: "Alto",
      }
    : {
        badge: "Clinician Portal",
        eyebrow: "Pilot-ready MVP for senior living and home health",
        heading: "Assess fall risk, upload video, and generate reports in minutes.",
        lead:
          "The StrideSafe clinician portal lets you create residents, start assessments, capture TUG/Chair Stand/Balance, and generate documentation-ready PDFs.",
        accessTitle: "Clinician access",
        accessBadge: "Secure access",
        accessBody: "Sign in to access residents, assessments, and reports.",
        accessSecurityTitle: "Compliance snapshot",
        accessSecurityBody: "Built for the US market with audit-ready controls.",
        accessSecurityBullets: [
          "SOC 2 Type II controls and documented security policies.",
          "HIPAA-aligned workflows with audit logs.",
          "Role-based access and user-level traceability.",
          "Encryption at rest and in transit.",
        ],
        accessSecurityChips: ["SOC 2 Type II", "HIPAA aligned", "US market"],
        roleLabel: "Role",
        roleAdmin: "Admin",
        roleClinician: "Clinician",
        navOverview: "Dashboard",
        navNotifications: "Notifications",
        navOutcomes: "Outcomes",
        navWorkflow: "Workflow",
        navPtWorkflow: "StrideSafe TherapyFlow",
        navResidents: "Residents",
        navAssessments: "Assessments",
        navIncidents: "Incidents",
        navUploads: "Video uploads",
        navScores: "Scores",
        navReports: "Reports",
        navUsers: "Users",
        navFacilities: "Facilities",
        navUnits: "Units",
        navExports: "Exports",
        navAudit: "Audit log",
        navQa: "Pilot QA",
        onboardingTitle: "Onboarding checklist",
        onboardingBody: "Complete these steps to launch the pilot.",
        onboardingProgressLabel: "Progress",
        onboardingResume: "Resume onboarding",
        onboardingSkip: "Skip for now",
        onboardingBack: "Back",
        onboardingNext: "Next",
        onboardingFinish: "Finish setup",
        onboardingAdminOnly: "Admin only",
        onboardingAdminNote: "This step requires an admin. Ask your admin to complete it.",
        onboardingChecklistLabel: "Checklist",
        onboardingStepLabel: "Step",
        onboardingStatusDone: "Complete",
        onboardingStatusPending: "Pending",
        overviewTitle: "Operational overview",
        overviewBody: "Quick status on activity and clinical flow.",
        overviewResidents: "Active residents",
        overviewAssessments: "Assessments (resident)",
        overviewLastAssessment: "Last assessment",
        overviewReport: "Latest report",
        overviewReportReady: "Ready",
        overviewReportEmpty: "Pending",
        overviewActions: "Quick actions",
        notificationsTitle: "Notifications",
        notificationsBody: "Assessment alerts, report-ready messages, and clinical updates.",
        notificationsFilterLabel: "Filter",
        notificationsFilterUnread: "Unread",
        notificationsFilterRead: "Read",
        notificationsLoad: "Refresh",
        notificationsMarkRead: "Mark read",
        notificationsMarkAll: "Mark all read",
        notificationsConfirmTitle: "Mark notifications as read?",
        notificationsConfirmBodyAll: "This will mark every unread notification as read.",
        notificationsConfirmBodyUnread: "This will mark all unread notifications in this filter.",
        notificationsConfirmSkip: "Don't ask again",
        notificationsConfirmCancel: "Cancel",
        notificationsConfirmAction: "Confirm",
        notificationsEmpty: "No notifications yet.",
        notificationsStatusUnread: "Unread",
        notificationsStatusRead: "Read",
        notificationsEmailSent: "Email sent",
        notificationsEmailQueued: "Email queued",
        notificationsDeliveryLabel: "Email delivery",
        notificationsDeliveryAll: "All",
        notificationsDeliverySent: "Sent",
        notificationsDeliveryQueued: "Queued",
        outcomesTitle: "Clinical outcomes",
        outcomesBody: "Risk trends and clinical change by resident.",
        outcomesWindowLabel: "Window (days)",
        outcomesWeeksLabel: "Weeks",
        outcomesLoad: "Refresh",
        outcomesImproved: "Improved",
        outcomesWorsened: "Worsened",
        outcomesStable: "Stable",
        outcomesUnknown: "No data",
        outcomesAssessed: "Residents assessed",
        outcomesTotalResidents: "Total residents",
        outcomesTrendTitle: "Weekly risk trend",
        outcomesTrendBody: "Risk distribution by week.",
        outcomesResidentsTitle: "Resident changes",
        outcomesResidentsBody: "Latest assessments by resident.",
        outcomesEmpty: "No outcomes yet.",
        outcomesTrendImproved: "Improved",
        outcomesTrendWorsened: "Worsened",
        outcomesTrendStable: "Stable",
        outcomesTrendUnknown: "No data",
        outcomesLatestLabel: "Latest",
        outcomesPreviousLabel: "Previous",
        outcomesRiskLow: "Low",
        outcomesRiskModerate: "Moderate",
        outcomesRiskHigh: "High",
        workflowTitle: "Workflow queue",
        workflowBody: "Assignments, status, and SLAs for in-flight assessments and post-fall follow-ups.",
        workflowStatusLabel: "Status",
        workflowAssignedLabel: "Assignment",
        workflowUnitLabel: "Unit",
        workflowAssignedMe: "Assigned to me",
        workflowAssignedUnassigned: "Unassigned",
        workflowRefresh: "Refresh",
        workflowEmpty: "No assessments or incidents in the queue.",
        workflowAssignedTo: "Assigned",
        workflowSlaLabel: "SLA",
        workflowDueLabel: "Due",
        workflowClaim: "Claim",
        workflowUnassign: "Unassign",
        workflowStartReview: "Start review",
        workflowComplete: "Complete",
        workflowOverdue: "Overdue",
        workflowOnTrack: "On track",
        workflowDueSoon: "Due soon",
        workflowIncidentLabel: "Post-fall follow-up",
        workflowIncidentOpen: "Open incident",
        workflowChecklistLabel: "Checklist",
        ptWorkflowTitle: "StrideSafe TherapyFlow",
        ptWorkflowBody: "Guided view of the PT assessment flow for the selected assessment.",
        ptWorkflowProgressLabel: "Progress",
        ptWorkflowStepsTitle: "PT steps",
        ptWorkflowActionsTitle: "Quick actions",
        ptWorkflowContextTitle: "Current context",
        ptWorkflowContextBody: "Steps reflect the selected resident and assessment.",
        ptWorkflowNextLabel: "Next step",
        ptWorkflowNextBody: "Use the quick actions to keep moving.",
        ptWorkflowAllDone: "All steps are complete.",
        ptWorkflowAllDoneBody: "Start a new assessment or export the report.",
        ptWorkflowStepResident: "Select resident",
        ptWorkflowStepAssessment: "Create assessment",
        ptWorkflowStepVideo: "Upload video",
        ptWorkflowStepScores: "Capture scores",
        ptWorkflowStepQa: "Complete QA",
        ptWorkflowStepReport: "Generate report",
        ptDetailsTitle: "PT documentation",
        ptDetailsBody: "Capture CPT, goals, and plan of care for the summary.",
        ptChecklistTitle: "PT checklist",
        ptChecklistBody: "Complete requirements before exporting.",
        ptFieldCptLabel: "CPT codes",
        ptFieldCptHint: "Comma-separated (e.g. 97110, 97112).",
        ptFieldGoalsLabel: "Clinical goals",
        ptFieldPlanLabel: "Plan of care",
        ptFieldPainLabel: "Pain scale (0-10)",
        ptFieldSessionLabel: "Session time (min)",
        ptFieldTimeSavedLabel: "Time saved (min)",
        ptFieldTimeSavedHint: "Estimate based on 20-45 min traditional workflow.",
        ptFieldPainInvalid: "Pain scale must be between 0 and 10.",
        ptFieldMinutesInvalid: "Minutes must be between 0 and 240.",
        ptSaveButton: "Save PT details",
        ptSaveSuccess: "PT details saved.",
        ptSaveError: "Unable to save PT details.",
        ptTimerTitle: "Session timer",
        ptTimerStart: "Start",
        ptTimerPause: "Pause",
        ptTimerReset: "Reset",
        ptTimerApply: "Use time",
        ptSummaryTitle: "PT summary",
        ptSummaryBody: "Export a documentation-ready PDF.",
        ptSummaryDownload: "Download PT summary",
        ptSummaryBlocked: "Complete the PT checklist to export.",
        topbarWelcome: "Welcome",
        analyticsTitle: "Operational analytics",
        analyticsBody: "Key indicators to track pilot performance.",
        analyticsPostFallTitle: "Post-fall compliance",
        analyticsPostFallBody: "Checklist completion and follow-up SLA within the selected window.",
        analyticsPostFallIncidents: "Incidents in window",
        analyticsPostFallCompletion: "Checklist completion",
        analyticsPostFallOpen: "Open follow-ups",
        analyticsPostFallOverdue: "Overdue follow-ups",
        analyticsPostFallSla: "Follow-up SLA (days)",
        analyticsPostFallFilterLabel: "Unit filter",
        analyticsPostFallExport: "Export rollup",
        analyticsPostFallRollupEmpty: "No post-fall incidents by unit yet.",
        analyticsPostFallUnitUnassigned: "Unassigned",
        postFallBadgeOverdue: "SLA overdue",
        postFallBadgeOpen: "SLA open",
        postFallBadgeOnTrack: "SLA on track",
        analyticsAssessments: "Assessments per week",
        analyticsAvgTime: "Avg time (min)",
        analyticsReassessment: "Reassessment rate",
        analyticsDueToday: "Due today",
        analyticsOverdue: "Overdue",
        analyticsCompletionRate: "Completion rate",
        analyticsHighRiskRate: "High-risk rate",
        analyticsWindowLabel: "Window (days)",
        analyticsTotal: "Total assessments",
        analyticsCompleted: "Completed assessments",
        analyticsVideoCoverage: "Video coverage",
        analyticsReportCoverage: "Report coverage",
        analyticsTimeToReport: "Avg time to report (min)",
        analyticsVideos: "Videos uploaded",
        analyticsReports: "Reports generated",
        analyticsUpdated: "Updated",
        analyticsLoad: "Refresh analytics",
        analyticsError: "Unable to load analytics.",
        qaTitle: "QA checklist",
        qaBody: "Verify each assessment meets pilot requirements.",
        qaAdd: "Add item",
        qaExport: "Export QA",
        qaResident: "Resident",
        qaAssessment: "Assessment",
        qaChecklist: "Checklist",
        qaNotes: "Notes",
        qaStatusLabel: "QA status",
        qaStatusReady: "Ready",
        qaStatusNeeds: "Needs review",
        qaStatusEscalated: "Escalated",
        qaEscalateAction: "Escalate",
        qaEmpty: "No assessments to review.",
        qaStepVideo: "Video is clear and stable",
        qaStepLighting: "Lighting is sufficient",
        qaStepTug: "TUG completed",
        qaStepChair: "Chair Stand completed",
        qaStepBalance: "Balance documented",
        qaStepRisk: "Risk tier assigned",
        emailLabel: "Email",
        passwordLabel: "Password",
        loginButton: "Sign in",
        loginBusy: "Signing in...",
        saving: "Saving...",
        logout: "Log out",
        signedIn: "Signed in",
        facilityLabel: "Facility",
        residentsTitle: "Residents",
        residentsBody: "Search, select, or add a new resident.",
        residentSearch: "Search resident, ID, or location",
        residentEmpty: "No residents yet.",
        residentFilterEmptyList: "No matching residents.",
        residentCount: "Showing",
        residentCountOf: "of",
        residentFilterSex: "Sex",
        residentFilterLocation: "Location",
        residentFilterLocationPlaceholder: "Building, floor, unit, room",
        residentFilterAll: "All",
        residentSort: "Sort",
        residentSortNewest: "Newest first",
        residentSortName: "Name A-Z",
        residentSelect: "Select a resident to view assessments.",
        residentNew: "Add resident",
        residentFirst: "First name",
        residentLastName: "Last name",
        residentDob: "Date of birth",
        residentDobFuture: "Date cannot be in the future.",
        residentSex: "Sex",
        residentSexSelect: "Select",
        residentExternal: "External ID",
        residentIdShort: "ID",
        residentAgeLabel: "Age",
        residentNotes: "Notes",
        residentSave: "Save resident",
        residentClear: "Clear form",
        residentDuplicateWarning: "Possible duplicate found. Review before creating.",
        residentDuplicateAction: "Create anyway",
        residentDrawer: "Resident detail",
        residentDrawerToggle: "Hide detail",
        residentDrawerShow: "Show detail",
        residentOverview: "Resident overview",
        residentHistory: "Assessment history",
        residentLastAssessment: "Last assessment",
        residentTotal: "Total assessments",
        residentNone: "No assessments recorded yet.",
        residentFilterEmpty: "No assessments match this filter.",
        residentLabelName: "Name",
        residentLabelDob: "Date of birth",
        residentLabelAge: "Age",
        residentLabelSex: "Sex",
        residentLabelExternal: "External ID",
        residentLabelBuilding: "Building",
        residentLabelFloor: "Floor",
        residentLabelUnit: "Unit",
        residentLabelRoom: "Room",
        residentLabelUnitAssignment: "Assigned unit",
        residentLabelNotes: "Notes",
        residentEditTitle: "Edit resident",
        residentEditSave: "Save changes",
        residentEditReset: "Reset",
        residentEditSaved: "Changes saved.",
        residentEditError: "Unable to save changes.",
        assessmentsTitle: "Assessments",
        assessmentsBody: "Create an assessment for the selected resident.",
        assessmentEmpty: "No assessments for this resident yet.",
        assessmentNew: "New assessment",
        assessmentDate: "Assessment date",
        assessmentScheduled: "Scheduled date",
        assessmentDue: "Due date",
        assessmentDevice: "Assistive device",
        assessmentSave: "Create assessment",
        assessmentCreated: "Assessment created.",
        assessmentSearch: "Search assessments",
        assessmentFilterEmptyList: "No matching assessments.",
        assessmentSelected: "Selected assessment",
        assessmentStepVideo: "Video",
        assessmentStepScores: "Scores",
        assessmentStepReport: "Report",
        assessmentStatusDone: "Complete",
        assessmentStatusMissing: "Missing",
        assessmentDueToday: "Due today",
        assessmentOverdue: "Overdue",
        assessmentUpcoming: "Upcoming",
        assessmentScheduleTitle: "Schedule",
        assessmentScheduleBody: "Update scheduled and due dates.",
        assessmentScheduleSave: "Save schedule",
        assessmentScheduleSaved: "Schedule updated.",
        assessmentQuickActions: "Next actions",
        incidentsTitle: "Fall incidents",
        incidentsBody: "Log falls and track post-fall follow-up.",
        incidentSelectResident: "Select a resident to view incidents.",
        incidentSelectEvent: "Select an incident to view the checklist.",
        incidentEmpty: "No incidents recorded yet.",
        incidentNew: "Log fall incident",
        incidentOccurredAt: "Date & time",
        incidentSeverity: "Injury severity",
        incidentSeverityNone: "No injury",
        incidentSeverityMinor: "Minor",
        incidentSeverityModerate: "Moderate",
        incidentSeveritySevere: "Severe",
        incidentEmsCalled: "EMS called",
        incidentHospitalTransfer: "Hospital transfer",
        incidentWitness: "Witness",
        incidentAssistiveDevice: "Assistive device",
        incidentFactors: "Contributing factors",
        incidentFactorsHint: "Comma-separated (lighting, footwear, meds).",
        incidentNotes: "Notes",
        incidentSave: "Save incident",
        incidentSaved: "Incident logged.",
        incidentChecklistTitle: "Post-fall checklist",
        incidentChecklistEmpty: "No checklist items configured.",
        incidentChecklistPending: "Pending",
        incidentChecklistDone: "Complete",
        incidentFollowupDue: "Follow-up due",
        incidentFollowupOverdue: "Follow-up overdue",
        incidentLinkedAssessment: "Latest assessment",
        incidentLinkedRisk: "Risk",
        fallCheckVitals: "Vitals recorded",
        fallCheckNeuro: "Neuro check completed",
        fallCheckNotify: "Family/physician notified",
        fallCheckEnvironment: "Environment reviewed",
        fallCheckMedReview: "Medication review flagged",
        fallCheckFollowUp: "Follow-up assessment scheduled",
        uploadTitle: "Video upload",
        uploadBody: "Upload an MP4 or MOV. Include metadata if available.",
        uploadFile: "Video file",
        uploadFileHint: `Max ${MAX_VIDEO_SIZE_MB} MB`,
        uploadGuidelinesTitle: "Upload guidelines",
        uploadRuleDuration: "10-120 sec duration",
        uploadRuleResolution: "Minimum 640 x 360 resolution",
        uploadRuleFormat: "MP4 or MOV file",
        uploadMetaHint: "If metadata is not auto-detected, enter values above.",
        uploadAutoCreate: "No assessment selected. We'll create a new one when you upload the video.",
        uploadClear: "Clear upload",
        uploadSelected: "Selected file",
        uploadDuration: "Duration (seconds)",
        uploadWidth: "Width (px)",
        uploadHeight: "Height (px)",
        uploadButton: "Upload video",
        uploadBusy: "Uploading...",
        uploadSuccess: "Video uploaded.",
        uploadRequired: "Select a video file.",
        uploadTypeError: "Unsupported file type. Use MP4 or MOV.",
        uploadSizeError: `File exceeds ${MAX_VIDEO_SIZE_MB} MB.`,
        uploadProgressLabel: "Upload progress",
        uploadMetaError: "Enter a valid number.",
        uploadMetaAutoError: "Unable to read video metadata. Enter values manually.",
        scoresTitle: "Scores and risk",
        scoresBody: "Capture TUG, Chair Stand, and balance tests.",
        badgeVideo: "Video uploaded",
        badgeScores: "Scores synced",
        riskLabel: "Risk tier",
        statusLabel: "Status",
        tugLabel: "TUG (seconds)",
        chairLabel: "Chair Stand (seconds)",
        balanceSide: "Side-by-side balance",
        balanceSemi: "Semi-tandem balance",
        balanceTandem: "Tandem balance",
        scoreNotes: "Score notes",
        clinicianNotes: "Clinician notes",
        scoreSave: "Save scores",
        scoreSuccess: "Scores saved.",
        scoreBusy: "Saving...",
        scoreInvalid: "Enter a valid number.",
        syncModelScores: "Sync model scores",
        syncModelScoresBusy: "Syncing...",
        syncModelScoresDone: "Model scores synced.",
        syncModelScoresPending: "Model run is still in progress.",
        syncModelScoresNone: "No model scores are available yet.",
        syncModelScoresError: "Unable to sync model scores.",
        runModelNow: "Run model now",
        runModelBusy: "Running model...",
        runModelQueued: "Model run queued.",
        runModelNoVideo: "A video is required to run the model.",
        runModelConflict: "Model run already in progress.",
        scoreRange: "Value must be between 0 and 300.",
        reportTitle: "Report",
        reportBody: "Generate and download the clinical PDF.",
        reportSummaryTitle: "Report summary",
        reportSummaryEmpty: "No report generated yet.",
        reportCreatedOn: "Generated",
        reportChecklistTitle: "Before generating",
        reportChecklistVideo: "Video uploaded",
        reportChecklistScores: "Scores completed",
        reportChecklistNotes: "Clinician notes added",
        reportReadyLabel: "Report ready",
        reportGenerateHelp: "You can generate anytime, but complete video and scores for best output.",
        reportGatePrefix: "Complete to generate the report:",
        reportGateVideoItem: "upload a video",
        reportGateScoresItem: "complete scores",
        reportGateQaItem: "complete the QA checklist",
        reportChecklistQa: "QA checklist complete",
        reportButton: "Generate report",
        reportBusy: "Generating...",
        reportDownload: "Download PDF",
        reportPreview: "Preview PDF",
        reportHidePreview: "Hide preview",
        reportPreviewBusy: "Loading preview...",
        reportPreviewError: "Unable to load preview.",
        reportHistoryTitle: "Report history",
        reportHistoryBody: "Latest reports generated for this assessment.",
        reportHistoryEmpty: "No reports yet.",
        reportHistoryDownload: "Download",
        reportTypeAssessment: "Assessment report",
        reportTypePtSummary: "PT summary",
        refresh: "Refresh",
        loading: "Loading...",
        selectAssessment: "Select an assessment to continue.",
        selectResident: "Select a resident to continue.",
        sessionExpired: "Session expired. Please sign in again.",
        genericError: "Something went wrong. Please try again.",
        residentMissing: "Enter first name, last name, and date of birth.",
        assessmentMissing: "Select a valid date.",
        assessmentDueInvalid: "Due date must be on or after the scheduled date.",
        filterStatus: "Status",
        filterRisk: "Risk",
        filterFrom: "From",
        filterTo: "To",
        filterAll: "All",
        exportCsv: "Export CSV",
        adminToolsTitle: "Admin tools",
        adminToolsBody: "Audit activity and access control.",
        exportCenterTitle: "Export center",
        exportCenterBody: "Generate secure download links and review export activity.",
        exportTokenTitle: "Create export token",
        exportTokenType: "Export type",
        exportTokenFacility: "Facility",
        exportFacilityPlaceholder: "Facility ID (optional)",
        exportTokenExpires: "Expires in (hours)",
        exportTokenCreate: "Create token",
        exportTokenBusy: "Creating...",
        exportTokenSuccess: "Token created.",
        exportTokenLink: "Download link",
        exportTokenId: "Token ID",
        exportTokenDownload: "Download export",
        exportTokenFilters: "Export filters",
        exportTokenInclude: "Include",
        exportIncludeResidents: "Residents",
        exportIncludeAssessments: "Assessments",
        exportIncludeAudit: "Audit",
        exportIncludeRequired: "Select at least one bundle item.",
        exportExpiresInvalid: "Invalid hours. Use 1-168.",
        exportLogsTitle: "Export logs",
        exportLogsBody: "Review recent export activity.",
        exportLogsLoad: "Load export logs",
        exportLogsEmpty: "No export activity yet.",
        exportLogsType: "Type",
        exportLogsStatus: "Status",
        exportLogsWhen: "Time",
        exportLogsToken: "Token",
        exportLogsLimit: "Limit",
        exportLogsFilterType: "Type",
        exportTypeResidents: "Residents",
        exportTypeAssessments: "Assessments",
        exportTypeAudit: "Audit",
        exportTypeBundle: "Bundle",
        exportTypePostFallRollup: "Post-fall rollup",
        exportFilterResident: "Resident ID",
        exportFilterStatus: "Status",
        exportFilterRisk: "Risk tier",
        exportFilterFrom: "From",
        exportFilterTo: "To",
        exportFilterAssigned: "Assigned to",
        exportFilterScheduledFrom: "Scheduled from",
        exportFilterScheduledTo: "Scheduled to",
        exportFilterDueFrom: "Due from",
        exportFilterDueTo: "Due to",
        exportAssignedPlaceholder: "User id or unassigned",
        exportAuditAction: "Action",
        exportAuditEntity: "Entity",
        exportAuditUser: "User",
        exportAuditFrom: "From",
        exportAuditTo: "To",
        exportAuditLimit: "Limit",
        exportScheduleTitle: "Export schedules",
        exportScheduleBody: "Recurring exports with saved filters.",
        exportScheduleName: "Name",
        exportScheduleFrequency: "Frequency",
        exportScheduleDaily: "Daily",
        exportScheduleWeekly: "Weekly",
        exportScheduleDay: "Day",
        exportScheduleHour: "Hour",
        exportScheduleMinute: "Minute",
        exportScheduleStatus: "Status",
        exportScheduleActive: "Active",
        exportSchedulePaused: "Paused",
        exportScheduleExpires: "Expires in (hours)",
        exportScheduleCreate: "Save schedule",
        exportScheduleEdit: "Edit",
        exportScheduleUpdate: "Update schedule",
        exportScheduleCancel: "Cancel edit",
        exportScheduleCreated: "Schedule created.",
        exportScheduleUpdated: "Schedule updated.",
        exportScheduleRun: "Run now",
        exportSchedulePause: "Pause",
        exportScheduleResume: "Resume",
        exportScheduleEmpty: "No schedules yet.",
        exportScheduleNextRun: "Next run",
        exportScheduleLastRun: "Last run",
        facilityRollupTitle: "Facility rollup",
        facilityRollupBody: "Aggregate status across sites.",
        facilityRollupResidents: "Residents",
        facilityRollupAssessments: "Assessments",
        facilityRollupCompleted: "Completed",
        facilityRollupHighRisk: "High risk",
        facilityRollupDueToday: "Due today",
        facilityRollupOverdue: "Overdue",
        facilityRollupReports: "Reports",
        facilityRollupLoad: "Refresh",
        facilityRollupEmpty: "No facility data yet.",
        auditFiltersTitle: "Audit filters",
        auditPresetsLabel: "Presets",
        auditPreset24h: "Last 24h",
        auditPreset7d: "Last 7d",
        auditPreset30d: "Last 30d",
        auditPresetMe: "My activity",
        auditFilterAction: "Action",
        auditFilterEntity: "Entity",
        auditFilterUser: "User",
        auditFilterUserAll: "All users",
        auditFilterFrom: "From",
        auditFilterTo: "To",
        auditFilterLimit: "Limit",
        auditApply: "Apply filters",
        auditReset: "Reset",
        auditLoad: "Load audit log",
        auditExport: "Export CSV",
        auditExportBusy: "Exporting...",
        auditExportError: "Unable to export audit log.",
        auditEmpty: "No recent events.",
        auditAction: "Action",
        auditEntity: "Entity",
        auditWhen: "Time",
        auditUser: "User",
        auditId: "ID",
        auditNotAllowed: "Admin access required to view audit logs.",
        userAdminTitle: "User management",
        userAdminBody: "Create clinical accounts, adjust roles, and reset passwords.",
        facilityAdminTitle: "Facility management",
        facilityAdminBody: "Manage facility profiles and pilot defaults.",
        facilitySettingsTitle: "Defaults del piloto",
        facilitySettingsBody: "Protocolos y metodos recomendados para el flujo clinico.",
        facilityProtocolLabel: "Protocolo de evaluacion",
        facilityProtocolOptionDefault: "TUG + Chair Stand + Balance (recomendado)",
        facilityProtocolOptionTug: "Solo TUG",
        facilityProtocolOptionBalance: "Solo balance",
        facilityCaptureLabel: "Metodo de captura",
        facilityCaptureOptionRecord: "Grabar + cargar (recomendado)",
        facilityCaptureOptionUpload: "Solo cargar",
        facilityRolePolicyLabel: "Politica de roles",
        facilityRolePolicyClinicianAdmin: "Clinico + Admin (recomendado)",
        facilityRolePolicyAdminOnly: "Solo Admin",
        facilityListEmpty: "No facilities found.",
        facilitySearch: "Search facilities",
        facilityAddTitle: "Add facility",
        facilityEditTitle: "Edit facility",
        facilityName: "Facility name",
        facilityAddress1: "Address line 1",
        facilityAddress2: "Address line 2",
        facilityCity: "City",
        facilityState: "State",
        facilityZip: "ZIP",
        facilityCadence: "Reassessment cadence (days)",
        facilityReportSla: "Report turnaround (hours)",
        facilityChecklist: "QA checklist items",
        facilityChecklistHint: "One item per line.",
        facilityFallChecklist: "Post-fall checklist",
        facilityFallChecklistHint: "One item per line.",
        facilityCreateButton: "Create facility",
        facilitySaveButton: "Save changes",
        facilitySelectHint: "Select a facility to edit.",
        facilityCreated: "Facility created.",
        facilityUpdated: "Facility updated.",
        facilityRequired: "Required field.",
        facilityNumberInvalid: "Enter a valid number.",
        unitsTitle: "Units",
        unitsBody: "Manage buildings, floors, and units for routing.",
        unitLabel: "Unit label",
        unitBuilding: "Building",
        unitFloor: "Floor",
        unitUnit: "Unit",
        unitRoom: "Room",
        unitCreate: "Create unit",
        unitCreated: "Unit created.",
        unitEmpty: "No units yet.",
        unitSelectHint: "Select a unit to assign.",
        userListTitle: "Users",
        userListEmpty: "No additional users yet.",
        userSearch: "Search by name or email",
        userAddTitle: "Create user",
        userEditTitle: "Edit user",
        userEmailLabel: "Email",
        userNameLabel: "Full name",
        userRoleLabel: "Role",
        userStatusLabel: "Status",
        userPasswordLabel: "Temporary password",
        userPasswordReset: "New password",
        userPasswordHint: "Required to create a user.",
        userPasswordOptional: "Leave blank to keep the current password.",
        userRequired: "Required field.",
        userCreateButton: "Create user",
        userSaveButton: "Save changes",
        userSelectHint: "Select a user to edit.",
        userRoleAdmin: "Admin",
        userRoleClinician: "Clinician",
        userStatusActive: "Active",
        userStatusInactive: "Inactive",
        userCreated: "User created.",
        userUpdated: "User updated.",
        statusDraft: "Draft",
        statusNeeds: "Needs review",
        statusReview: "In review",
        statusDone: "Completed",
        riskLow: "Low",
        riskModerate: "Moderate",
        riskHigh: "High",
      };

  const steps = isEs
    ? [
        { icon: "scan", title: "Graba y carga", body: "Sube videos de movilidad desde clinica o visita domiciliaria." },
        { icon: "plan", title: "Evalua pruebas", body: "Registra TUG, Chair Stand y balance con un solo flujo." },
        { icon: "doc", title: "Genera reportes", body: "Descarga PDFs listos para documentacion y auditoria." },
        { icon: "shield", title: "Control clinico", body: "Seguimiento de riesgo y estados en tiempo real." },
      ]
    : [
        { icon: "scan", title: "Record and upload", body: "Upload mobility videos from clinic or in-home visits." },
        { icon: "plan", title: "Capture tests", body: "Record TUG, Chair Stand, and balance in one flow." },
        { icon: "doc", title: "Generate reports", body: "Download documentation-ready PDFs for your records." },
        { icon: "shield", title: "Clinical oversight", body: "Track risk tiers and status in real time." },
      ];

  const onboardingSteps = isEs
    ? [
        {
          id: "facility",
          title: "Configura la instalacion",
          body: "Confirma perfil, cadencia y SLA de reportes.",
          actionLabel: "Ir a Instalaciones",
          actionPanel: "facilities",
          adminOnly: true,
          checks: [
            { id: "facilityProfile", label: "Perfil de instalacion revisado", autoKey: "facilityProfile" },
            { id: "facilityProtocol", label: "Protocolo confirmado (TUG + Chair Stand + Balance)", autoKey: "facilityProtocol" },
            { id: "facilityCapture", label: "Metodo definido: grabar + cargar", autoKey: "facilityCapture" },
            { id: "facilityRoles", label: "Roles confirmados (clinico/admin)", autoKey: "facilityRoles" },
          ],
        },
        {
          id: "team",
          title: "Invita al equipo clinico",
          body: "Crea cuentas y comparte credenciales.",
          actionLabel: "Ir a Usuarios",
          actionPanel: "users",
          adminOnly: true,
          checks: [
            { id: "teamInvited", label: "Al menos un clinico adicional invitado", autoKey: "teamInvited" },
            { id: "teamPasswords", label: "Credenciales entregadas de forma segura" },
          ],
        },
        {
          id: "resident",
          title: "Agrega el primer residente",
          body: "Crea un perfil para iniciar evaluaciones.",
          actionLabel: "Ir a Residentes",
          actionPanel: "residents",
          checks: [
            { id: "residentAdded", label: "Perfil de residente creado", autoKey: "residentAdded" },
            { id: "residentNotes", label: "Notas basicas completadas" },
          ],
        },
        {
          id: "assessment",
          title: "Completa la primera evaluacion",
          body: "Carga video, captura puntajes y genera el reporte.",
          actionLabel: "Ir a Evaluaciones",
          actionPanel: "assessments",
          checks: [
            { id: "assessmentCreated", label: "Evaluacion creada", autoKey: "assessmentCreated" },
            { id: "assessmentVideo", label: "Video cargado", autoKey: "videoUploaded" },
            { id: "assessmentScores", label: "Puntajes completos", autoKey: "scoresCaptured" },
            { id: "assessmentReport", label: "Reporte generado", autoKey: "reportGenerated" },
          ],
        },
      ]
    : [
        {
          id: "facility",
          title: "Confirm facility setup",
          body: "Verify profile, cadence, and report SLA.",
          actionLabel: "Go to Facilities",
          actionPanel: "facilities",
          adminOnly: true,
          checks: [
            { id: "facilityProfile", label: "Facility profile reviewed", autoKey: "facilityProfile" },
            { id: "facilityProtocol", label: "Protocol confirmed (TUG + Chair Stand + Balance)", autoKey: "facilityProtocol" },
            { id: "facilityCapture", label: "Capture method set to record + upload", autoKey: "facilityCapture" },
            { id: "facilityRoles", label: "Roles confirmed (clinician/admin only)", autoKey: "facilityRoles" },
          ],
        },
        {
          id: "team",
          title: "Invite your clinical team",
          body: "Create clinician accounts and share credentials.",
          actionLabel: "Go to Users",
          actionPanel: "users",
          adminOnly: true,
          checks: [
            { id: "teamInvited", label: "At least one additional clinician invited", autoKey: "teamInvited" },
            { id: "teamPasswords", label: "Passwords delivered securely" },
          ],
        },
        {
          id: "resident",
          title: "Add your first resident",
          body: "Create a resident profile to start assessments.",
          actionLabel: "Go to Residents",
          actionPanel: "residents",
          checks: [
            { id: "residentAdded", label: "Resident profile created", autoKey: "residentAdded" },
            { id: "residentNotes", label: "Baseline notes captured" },
          ],
        },
        {
          id: "assessment",
          title: "Run the first assessment",
          body: "Upload video, capture scores, and generate the report.",
          actionLabel: "Go to Assessments",
          actionPanel: "assessments",
          checks: [
            { id: "assessmentCreated", label: "Assessment created", autoKey: "assessmentCreated" },
            { id: "assessmentVideo", label: "Video uploaded", autoKey: "videoUploaded" },
            { id: "assessmentScores", label: "Scores completed", autoKey: "scoresCaptured" },
            { id: "assessmentReport", label: "Report generated", autoKey: "reportGenerated" },
          ],
        },
      ];

  const { token, setToken, user, setUser } = useStoredAuth();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [onboardingState, setOnboardingState] = useState({ completed: false, dismissed: false, checks: {} });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const onboardingKey = user?.id ? `${ONBOARDING_STORAGE_KEY}_${user.id}` : "";
  const [onboardingFacilityForm, setOnboardingFacilityForm] = useState({
    assessment_protocol: "tug_chair_balance",
    capture_method: "record_upload",
    role_policy: "clinician_admin_only",
  });
  const [onboardingFacilitySaving, setOnboardingFacilitySaving] = useState(false);
  const [onboardingFacilityNotice, setOnboardingFacilityNotice] = useState("");

  const [residents, setResidents] = useState([]);
  const [residentSearch, setResidentSearch] = useState("");
  const [residentLoading, setResidentLoading] = useState(false);
  const [residentError, setResidentError] = useState("");
  const [residentSuccess, setResidentSuccess] = useState("");
  const [residentFieldErrors, setResidentFieldErrors] = useState({});
  const [residentDuplicate, setResidentDuplicate] = useState(null);
  const [residentSort, setResidentSort] = useState("recent");
  const [residentSexFilter, setResidentSexFilter] = useState("all");
  const [residentLocationFilter, setResidentLocationFilter] = useState("");
  const [selectedResidentId, setSelectedResidentId] = useState(null);
  const [residentDrawerOpen, setResidentDrawerOpen] = useState(false);
  const [newResident, setNewResident] = useState({
    first_name: "",
    last_name: "",
    dob: "",
    sex: "",
    external_id: "",
    notes: "",
    building: "",
    floor: "",
    unit: "",
    room: "",
    unit_id: "",
  });
  const [residentSaving, setResidentSaving] = useState(false);
  const [residentEditForm, setResidentEditForm] = useState({
    first_name: "",
    last_name: "",
    dob: "",
    sex: "",
    external_id: "",
    notes: "",
    building: "",
    floor: "",
    unit: "",
    room: "",
    unit_id: "",
  });
  const [residentEditErrors, setResidentEditErrors] = useState({});
  const [residentEditSaving, setResidentEditSaving] = useState(false);
  const [residentEditNotice, setResidentEditNotice] = useState("");

  const [assessments, setAssessments] = useState([]);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState("");
  const [assessmentSuccess, setAssessmentSuccess] = useState("");
  const [assessmentFieldErrors, setAssessmentFieldErrors] = useState({});
  const [assessmentSearch, setAssessmentSearch] = useState("");
  const [selectedAssessmentId, setSelectedAssessmentId] = useState(null);
  const [newAssessment, setNewAssessment] = useState(() => ({
    assessment_date: formatDate(new Date()),
    scheduled_date: formatDate(new Date()),
    due_date: formatDate(new Date()),
    assistive_device: "",
  }));
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    scheduled_date: "",
    due_date: "",
  });
  const [scheduleErrors, setScheduleErrors] = useState({});
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState("");

  const [assessmentDetails, setAssessmentDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMeta, setUploadMeta] = useState({
    duration_seconds: "",
    width: "",
    height: "",
  });
  const [uploadStatus, setUploadStatus] = useState({
    busy: false,
    error: "",
    success: "",
    progress: 0,
  });
  const [uploadFieldErrors, setUploadFieldErrors] = useState({});
  const uploadMetaRequestId = useRef(0);

  const [scoreForm, setScoreForm] = useState({
    status: "",
    risk_tier: "",
    clinician_notes: "",
    tug_seconds: "",
    chair_stand_seconds: "",
    balance_side_by_side: false,
    balance_semi_tandem: false,
    balance_tandem: false,
    score_notes: "",
  });
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreNotice, setScoreNotice] = useState("");
  const [scoreFieldErrors, setScoreFieldErrors] = useState({});
  const [syncScoresBusy, setSyncScoresBusy] = useState(false);
  const [runModelBusy, setRunModelBusy] = useState(false);

  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportPreview, setReportPreview] = useState({
    url: "",
    id: "",
    busy: false,
    error: "",
  });
  const [ptForm, setPtForm] = useState(buildPtForm);
  const [ptSaving, setPtSaving] = useState(false);
  const [ptNotice, setPtNotice] = useState("");
  const [ptError, setPtError] = useState("");
  const [ptTimerActive, setPtTimerActive] = useState(false);
  const [ptElapsedSeconds, setPtElapsedSeconds] = useState(0);

  const [notifications, setNotifications] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [notificationDeliveryFilter, setNotificationDeliveryFilter] = useState("all");
  const [confirmMarkAllOpen, setConfirmMarkAllOpen] = useState(false);
  const [skipNotificationConfirm, setSkipNotificationConfirm] = useState(
    () => getStoredValue(NOTIFICATION_CONFIRM_KEY) === "true"
  );

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditExportError, setAuditExportError] = useState("");
  const buildAuditFilters = () => ({
    action: "",
    entity_type: "",
    user_id: "",
    from: "",
    to: "",
    limit: "200",
  });
  const [auditFilters, setAuditFilters] = useState(buildAuditFilters);

  const [exportLogs, setExportLogs] = useState([]);
  const [exportLogsLoading, setExportLogsLoading] = useState(false);
  const [exportLogsError, setExportLogsError] = useState("");
  const buildExportLogFilters = () => ({
    export_type: "all",
    limit: "200",
  });
  const [exportLogFilters, setExportLogFilters] = useState(buildExportLogFilters);
  const [exportFacilityId, setExportFacilityId] = useState("");
  const buildExportTokenForm = () => ({
    export_type: "assessments",
    expires_in_hours: "24",
    include_residents: true,
    include_assessments: true,
    include_audit: false,
    resident_id: "",
    status: "all",
    risk_tier: "all",
    from: "",
    to: "",
    assigned_to: "",
    scheduled_from: "",
    scheduled_to: "",
    due_from: "",
    due_to: "",
    audit_action: "",
    audit_entity_type: "",
    audit_user_id: "",
    audit_from: "",
    audit_to: "",
    audit_limit: "200",
    post_fall_days: "30",
    post_fall_unit_id: "all",
  });
  const [exportTokenForm, setExportTokenForm] = useState(buildExportTokenForm);
  const [exportTokenResult, setExportTokenResult] = useState(null);
  const [exportTokenBusy, setExportTokenBusy] = useState(false);
  const [exportTokenError, setExportTokenError] = useState("");

  const buildExportScheduleForm = () => ({
    name: "",
    export_type: "assessments",
    frequency: "weekly",
    day_of_week: "1",
    hour: "9",
    minute: "0",
    schedule_status: "active",
    expires_hours: "72",
    resident_id: "",
    status: "all",
    risk_tier: "all",
    from: "",
    to: "",
    assigned_to: "",
    scheduled_from: "",
    scheduled_to: "",
    due_from: "",
    due_to: "",
    audit_action: "",
    audit_entity_type: "",
    audit_user_id: "",
    audit_from: "",
    audit_to: "",
    audit_limit: "200",
    include_residents: true,
    include_assessments: true,
    include_audit: false,
    post_fall_days: "30",
    post_fall_unit_id: "all",
  });
  function buildPtForm() {
    return {
      pt_cpt_codes: "",
      pt_goals: "",
      pt_plan_of_care: "",
      pt_pain_score: "",
      pt_session_minutes: "",
      pt_time_saved_minutes: "",
    };
  }
  const [exportScheduleForm, setExportScheduleForm] = useState(buildExportScheduleForm);
  const [exportSchedules, setExportSchedules] = useState([]);
  const [exportScheduleLoading, setExportScheduleLoading] = useState(false);
  const [exportScheduleError, setExportScheduleError] = useState("");
  const [exportScheduleSaving, setExportScheduleSaving] = useState(false);
  const [exportScheduleNotice, setExportScheduleNotice] = useState("");
  const [editingExportScheduleId, setEditingExportScheduleId] = useState(null);

  const [facilityRollup, setFacilityRollup] = useState([]);
  const [facilityRollupLoading, setFacilityRollupLoading] = useState(false);
  const [facilityRollupError, setFacilityRollupError] = useState("");

  const [users, setUsers] = useState([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userCreateForm, setUserCreateForm] = useState({
    email: "",
    full_name: "",
    role: "clinician",
    status: "active",
    password: "",
  });
  const [userCreateErrors, setUserCreateErrors] = useState({});
  const [userCreateSaving, setUserCreateSaving] = useState(false);
  const [userEditForm, setUserEditForm] = useState({
    full_name: "",
    role: "clinician",
    status: "active",
    password: "",
  });
  const [userEditErrors, setUserEditErrors] = useState({});
  const [userEditSaving, setUserEditSaving] = useState(false);
  const [userEditNotice, setUserEditNotice] = useState("");

  const [facilities, setFacilities] = useState([]);
  const [facilityLoading, setFacilityLoading] = useState(false);
  const [facilityError, setFacilityError] = useState("");
  const [facilitySuccess, setFacilitySuccess] = useState("");
  const [facilitySearch, setFacilitySearch] = useState("");
  const [selectedFacilityId, setSelectedFacilityId] = useState(null);
  const [facilityProfile, setFacilityProfile] = useState(null);
  const [facilityCreateForm, setFacilityCreateForm] = useState({
    name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
    reassessment_cadence_days: "90",
    report_turnaround_hours: "24",
    assessment_protocol: "tug_chair_balance",
    capture_method: "record_upload",
    role_policy: "clinician_admin_only",
    qa_checklist: "",
    fall_checklist: "",
  });
  const [facilityCreateErrors, setFacilityCreateErrors] = useState({});
  const [facilityCreateSaving, setFacilityCreateSaving] = useState(false);
  const [facilityEditForm, setFacilityEditForm] = useState({
    name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
    reassessment_cadence_days: "90",
    report_turnaround_hours: "24",
    assessment_protocol: "tug_chair_balance",
    capture_method: "record_upload",
    role_policy: "clinician_admin_only",
    qa_checklist: "",
    fall_checklist: "",
  });
  const [facilityEditErrors, setFacilityEditErrors] = useState({});
  const [facilityEditSaving, setFacilityEditSaving] = useState(false);
  const [facilityEditNotice, setFacilityEditNotice] = useState("");

  const [units, setUnits] = useState([]);
  const [unitLoading, setUnitLoading] = useState(false);
  const [unitError, setUnitError] = useState("");
  const [unitNotice, setUnitNotice] = useState("");
  const [unitSaving, setUnitSaving] = useState(false);
  const [unitForm, setUnitForm] = useState({
    label: "",
    building: "",
    floor: "",
    unit: "",
    room: "",
  });

  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsUpdated, setAnalyticsUpdated] = useState("");
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [postFallRollup, setPostFallRollup] = useState([]);
  const [postFallRollupLoading, setPostFallRollupLoading] = useState(false);
  const [postFallRollupError, setPostFallRollupError] = useState("");
  const [postFallRollupFilter, setPostFallRollupFilter] = useState("all");

  const [outcomesData, setOutcomesData] = useState(null);
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [outcomesError, setOutcomesError] = useState("");
  const [outcomesUpdated, setOutcomesUpdated] = useState("");
  const [outcomesDays, setOutcomesDays] = useState(90);
  const [outcomesWeeks, setOutcomesWeeks] = useState(8);

  const [workflowQueue, setWorkflowQueue] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowUpdated, setWorkflowUpdated] = useState("");
  const [workflowStatusFilter, setWorkflowStatusFilter] = useState("all");
  const [workflowAssignedFilter, setWorkflowAssignedFilter] = useState("all");
  const [workflowUnitFilter, setWorkflowUnitFilter] = useState("all");

  const [qaChecks, setQaChecks] = useState({});
  const [qaNotes, setQaNotes] = useState({});
  const [qaEscalations, setQaEscalations] = useState({});
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState("");

  const [fallEvents, setFallEvents] = useState([]);
  const [fallEventLoading, setFallEventLoading] = useState(false);
  const [fallEventError, setFallEventError] = useState("");
  const [fallEventNotice, setFallEventNotice] = useState("");
  const [selectedFallEventId, setSelectedFallEventId] = useState(null);
  const [fallEventSaving, setFallEventSaving] = useState(false);
  const [fallEventForm, setFallEventForm] = useState(() => buildFallEventForm());
  const [fallEventChecks, setFallEventChecks] = useState({});
  const [fallEventChecksBusy, setFallEventChecksBusy] = useState({});

  const [timelineFilters, setTimelineFilters] = useState({
    status: "all",
    risk: "all",
    from: "",
    to: "",
  });
  const residentEditSuccess = residentEditNotice === copy.residentEditSaved;
  const [activePanel, setActivePanel] = useState("overview");
  const drawerRef = useRef(null);
  const auditAutoApplyRef = useRef(false);

  const statusOptions = [
    { value: "needs_review", label: copy.statusNeeds },
    { value: "in_review", label: copy.statusReview },
    { value: "completed", label: copy.statusDone },
  ];
  const weekdayOptions = isEs
    ? [
        { value: "0", label: "Domingo" },
        { value: "1", label: "Lunes" },
        { value: "2", label: "Martes" },
        { value: "3", label: "Miercoles" },
        { value: "4", label: "Jueves" },
        { value: "5", label: "Viernes" },
        { value: "6", label: "Sabado" },
      ]
    : [
        { value: "0", label: "Sunday" },
        { value: "1", label: "Monday" },
        { value: "2", label: "Tuesday" },
        { value: "3", label: "Wednesday" },
        { value: "4", label: "Thursday" },
        { value: "5", label: "Friday" },
        { value: "6", label: "Saturday" },
      ];

  const sexOptions = isEs
    ? [
        { value: "", label: copy.residentSexSelect },
        { value: "F", label: "F" },
        { value: "M", label: "M" },
        { value: "O", label: "Otro" },
      ]
    : [
        { value: "", label: copy.residentSexSelect },
        { value: "F", label: "F" },
        { value: "M", label: "M" },
        { value: "O", label: "Other" },
      ];
  const sexFilterOptions = [
    { value: "all", label: copy.residentFilterAll },
    ...sexOptions.filter((option) => option.value),
  ];

  const riskOptions = [
    { value: "low", label: copy.riskLow },
    { value: "moderate", label: copy.riskModerate },
    { value: "high", label: copy.riskHigh },
  ];
  const userRoleOptions = [
    { value: "admin", label: copy.userRoleAdmin },
    { value: "clinician", label: copy.userRoleClinician },
  ];
  const userStatusOptions = [
    { value: "active", label: copy.userStatusActive },
    { value: "inactive", label: copy.userStatusInactive },
  ];
  const exportTypeOptions = [
    { value: "residents", label: copy.exportTypeResidents },
    { value: "assessments", label: copy.exportTypeAssessments },
    { value: "audit", label: copy.exportTypeAudit },
    { value: "bundle", label: copy.exportTypeBundle },
    { value: "post_fall_rollup", label: copy.exportTypePostFallRollup },
  ];
  const exportStatusOptions = [
    { value: "all", label: copy.filterAll },
    { value: "draft", label: copy.statusDraft },
    { value: "needs_review", label: copy.statusNeeds },
    { value: "in_review", label: copy.statusReview },
    { value: "completed", label: copy.statusDone },
  ];
  const protocolOptions = [
    { value: "tug_chair_balance", label: copy.facilityProtocolOptionDefault },
    { value: "tug_only", label: copy.facilityProtocolOptionTug },
    { value: "balance_only", label: copy.facilityProtocolOptionBalance },
  ];
  const captureMethodOptions = [
    { value: "record_upload", label: copy.facilityCaptureOptionRecord },
    { value: "upload_only", label: copy.facilityCaptureOptionUpload },
  ];
  const rolePolicyOptions = [
    { value: "clinician_admin_only", label: copy.facilityRolePolicyClinicianAdmin },
    { value: "admin_only", label: copy.facilityRolePolicyAdminOnly },
  ];
  const unitOptions = [
    { value: "", label: copy.unitSelectHint },
    ...units.map((unit) => ({ value: unit.id, label: unit.label })),
  ];
  const unitFilterOptions = [
    { value: "all", label: copy.filterAll },
    ...units.map((unit) => ({ value: unit.id, label: unit.label })),
  ];
  const postFallRollupFilterOptions = [
    { value: "all", label: copy.filterAll },
    { value: "unassigned", label: copy.analyticsPostFallUnitUnassigned },
    ...units.map((unit) => ({ value: unit.id, label: unit.label })),
  ];
  const fallSeverityOptions = [
    { value: "none", label: copy.incidentSeverityNone },
    { value: "minor", label: copy.incidentSeverityMinor },
    { value: "moderate", label: copy.incidentSeverityModerate },
    { value: "severe", label: copy.incidentSeveritySevere },
  ];
  const notificationUnreadCount = notifications.filter((item) => item.status === "unread").length;
  const emailDeliveryCounts = notifications.reduce(
    (acc, item) => {
      if (item.channel !== "email") {
        return acc;
      }
      acc.total += 1;
      if (item.data?.email_delivery === "sent") {
        acc.sent += 1;
      } else {
        acc.queued += 1;
      }
      return acc;
    },
    { total: 0, sent: 0, queued: 0 }
  );
  const filteredNotifications = notifications.filter((item) => {
    if (notificationDeliveryFilter === "all") {
      return true;
    }
    if (item.channel !== "email") {
      return false;
    }
    if (notificationDeliveryFilter === "sent") {
      return item.data?.email_delivery === "sent";
    }
    if (notificationDeliveryFilter === "queued") {
      return item.data?.email_delivery !== "sent";
    }
    return true;
  });
  const statusLabelMap = statusOptions.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
  const riskLabelMap = riskOptions.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
  const unitLabelMap = units.reduce((acc, unit) => {
    acc[unit.id] = unit.label;
    return acc;
  }, {});
  const fallSeverityLabelMap = fallSeverityOptions.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
  const userRoleLabelMap = userRoleOptions.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
  const userStatusLabelMap = userStatusOptions.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
  const exportTypeLabelMap = exportTypeOptions.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
  const formatChecklistText = (items) => (Array.isArray(items) ? items.join("\n") : "");
  const parseChecklistText = (value) => (
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const defaultQaSteps = [
    copy.qaStepVideo,
    copy.qaStepLighting,
    copy.qaStepTug,
    copy.qaStepChair,
    copy.qaStepBalance,
    copy.qaStepRisk,
  ];
  const qaSteps = Array.isArray(facilityProfile?.qa_checklist) && facilityProfile.qa_checklist.length > 0
    ? facilityProfile.qa_checklist
    : defaultQaSteps;

  const defaultFallChecklist = [
    copy.fallCheckVitals,
    copy.fallCheckNeuro,
    copy.fallCheckNotify,
    copy.fallCheckEnvironment,
    copy.fallCheckMedReview,
    copy.fallCheckFollowUp,
  ];
  const fallChecklistItems = Array.isArray(facilityProfile?.fall_checklist) && facilityProfile.fall_checklist.length > 0
    ? facilityProfile.fall_checklist
    : defaultFallChecklist;

  const isAdmin = user?.role === "admin";
  const portalNavItems = [
    { id: "overview", label: copy.navOverview, icon: "insights" },
    { id: "notifications", label: copy.navNotifications, icon: "bell" },
    { id: "outcomes", label: copy.navOutcomes, icon: "trend" },
    { id: "workflow", label: copy.navWorkflow, icon: "plan" },
    { id: "pt-workflow", label: copy.navPtWorkflow, icon: "target" },
    { id: "residents", label: copy.navResidents, icon: "badge" },
    { id: "assessments", label: copy.navAssessments, icon: "plan" },
    { id: "incidents", label: copy.navIncidents, icon: "heart" },
    { id: "uploads", label: copy.navUploads, icon: "scan" },
    { id: "scores", label: copy.navScores, icon: "target" },
    { id: "reports", label: copy.navReports, icon: "doc" },
    { id: "qa", label: copy.navQa, icon: "check" },
    { id: "users", label: copy.navUsers, icon: "shield", adminOnly: true },
    { id: "facilities", label: copy.navFacilities, icon: "home", adminOnly: true },
    { id: "units", label: copy.navUnits, icon: "grid", adminOnly: true },
    { id: "exports", label: copy.navExports, icon: "grid", adminOnly: true },
    { id: "audit", label: copy.navAudit, icon: "trend", adminOnly: true },
  ];

  const availableNavItems = portalNavItems.filter((item) => !item.adminOnly || isAdmin);
  const handlePanelChange = (panelId) => {
    if (!availableNavItems.find((item) => item.id === panelId)) {
      return;
    }
    setActivePanel(panelId);
  };

  const filteredTimeline = assessments.filter((assessment) => {
    if (timelineFilters.status !== "all" && assessment.status !== timelineFilters.status) {
      return false;
    }
    if (timelineFilters.risk !== "all" && assessment.risk_tier !== timelineFilters.risk) {
      return false;
    }
    const assessmentDate = assessment.assessment_date ? new Date(assessment.assessment_date) : null;
    if (timelineFilters.from) {
      const fromDate = new Date(timelineFilters.from);
      if (assessmentDate && assessmentDate < fromDate) {
        return false;
      }
    }
    if (timelineFilters.to) {
      const toDate = new Date(timelineFilters.to);
      if (assessmentDate && assessmentDate > toDate) {
        return false;
      }
    }
    return true;
  });

  const filteredAssessments = assessments.filter((assessment) => {
    const needle = assessmentSearch.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    const statusLabel = statusLabelMap[assessment.status] || assessment.status || "";
    const riskLabel = riskLabelMap[assessment.risk_tier] || assessment.risk_tier || "";
    return `${formatDate(assessment.assessment_date)} ${assessment.assistive_device || ""} ${statusLabel} ${riskLabel}`
      .toLowerCase()
      .includes(needle);
  });

  const filteredResidents = residents.filter((resident) => {
    const needle = residentSearch.trim().toLowerCase();
    const locationNeedle = residentLocationFilter.trim().toLowerCase();
    if (residentSexFilter !== "all" && resident.sex !== residentSexFilter) {
      return false;
    }
    if (locationNeedle) {
      const locationStack = `${resident.building || ""} ${resident.floor || ""} ${resident.unit || ""} ${resident.room || ""}`
        .toLowerCase();
      if (!locationStack.includes(locationNeedle)) {
        return false;
      }
    }
    if (!needle) {
      return true;
    }
    return `${resident.first_name} ${resident.last_name} ${resident.external_id || ""} ${resident.building || ""} ${resident.floor || ""} ${resident.unit || ""} ${resident.room || ""}`
      .toLowerCase()
      .includes(needle);
  });

  const sortedResidents = residentSort === "name"
    ? [...filteredResidents].sort((a, b) => {
        const lastA = (a.last_name || "").toLowerCase();
        const lastB = (b.last_name || "").toLowerCase();
        if (lastA !== lastB) {
          return lastA.localeCompare(lastB);
        }
        const firstA = (a.first_name || "").toLowerCase();
        const firstB = (b.first_name || "").toLowerCase();
        return firstA.localeCompare(firstB);
      })
    : filteredResidents;

  const formatResidentLocation = (resident) => {
    if (!resident) {
      return "";
    }
    const parts = [];
    if (resident.building) {
      parts.push(`${copy.residentLabelBuilding} ${resident.building}`);
    }
    if (resident.floor) {
      parts.push(`${copy.residentLabelFloor} ${resident.floor}`);
    }
    if (resident.unit) {
      parts.push(`${copy.residentLabelUnit} ${resident.unit}`);
    }
    if (resident.room) {
      parts.push(`${copy.residentLabelRoom} ${resident.room}`);
    }
    return parts.join(" • ");
  };

  const formatFallEventLocation = (event) => {
    if (!event) {
      return "";
    }
    const parts = [];
    if (event.building) {
      parts.push(`${copy.residentLabelBuilding} ${event.building}`);
    }
    if (event.floor) {
      parts.push(`${copy.residentLabelFloor} ${event.floor}`);
    }
    if (event.unit) {
      parts.push(`${copy.residentLabelUnit} ${event.unit}`);
    }
    if (event.room) {
      parts.push(`${copy.residentLabelRoom} ${event.room}`);
    }
    return parts.join(" • ");
  };

  const filteredUsers = users.filter((item) => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return `${item.full_name} ${item.email}`.toLowerCase().includes(needle);
  });
  const filteredFacilities = facilities.filter((item) => {
    const needle = facilitySearch.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return `${item.name} ${item.city || ""} ${item.state || ""} ${item.zip || ""}`
      .toLowerCase()
      .includes(needle);
  });

  const selectedResident = residents.find((resident) => resident.id === selectedResidentId) || null;
  const selectedAssessment = assessments.find((assessment) => assessment.id === selectedAssessmentId) || null;
  const selectedFallEvent = fallEvents.find((event) => event.id === selectedFallEventId) || null;
  const selectedUser = users.find((item) => item.id === selectedUserId) || null;
  const selectedFacility = facilities.find((item) => item.id === selectedFacilityId) || null;
  const activeAssessmentProtocol = assessmentDetails?.assessment_protocol
    || selectedAssessment?.assessment_protocol
    || facilityProfile?.assessment_protocol
    || "tug_chair_balance";
  const showTugField = activeAssessmentProtocol !== "balance_only";
  const showChairField = activeAssessmentProtocol === "tug_chair_balance";
  const showBalanceFields = activeAssessmentProtocol !== "tug_only";
  const lastAssessmentDate = assessments[0]?.assessment_date ? formatDate(assessments[0].assessment_date) : "--";
  const facilityDisplayName = facilityProfile?.name || user?.facility_id || "--";
  const roleDisplayName = user?.role === "admin" ? copy.roleAdmin : copy.roleClinician;
  const newResidentAge = getAge(newResident.dob);
  const assessmentHasVideo = Boolean(assessmentDetails?.videos?.length);
  const selectedAssessmentHasVideo = assessmentHasVideo || Number(selectedAssessment?.video_count || 0) > 0;
  const assessmentHasScores = Boolean(assessmentDetails?.scores);
  const assessmentHasReport = Boolean(assessmentDetails?.report);
  const qaRequired = Array.isArray(facilityProfile?.qa_checklist) && facilityProfile.qa_checklist.length > 0;
  const selectedQaChecks = selectedAssessmentId ? (qaChecks[selectedAssessmentId] || {}) : {};
  const assessmentHasQa = qaRequired
    ? qaSteps.every((step) => selectedQaChecks[step]) && !qaEscalations[selectedAssessmentId]
    : true;
  const canGenerateReport = assessmentHasVideo && assessmentHasScores && assessmentHasQa;
  const reportMissing = [];
  if (!assessmentHasVideo) {
    reportMissing.push(copy.reportGateVideoItem);
  }
  if (!assessmentHasScores) {
    reportMissing.push(copy.reportGateScoresItem);
  }
  if (qaRequired && !assessmentHasQa) {
    reportMissing.push(copy.reportGateQaItem);
  }
  const reportGateMessage = reportMissing.length
    ? `${copy.reportGatePrefix} ${reportMissing.join(", ")}`
    : "";
  const reportChecklistItems = [
    { label: copy.reportChecklistVideo, done: assessmentHasVideo },
    { label: copy.reportChecklistScores, done: assessmentHasScores },
    ...(qaRequired ? [{ label: copy.reportChecklistQa, done: assessmentHasQa }] : []),
    { label: copy.reportChecklistNotes, done: Boolean(assessmentDetails?.clinician_notes) },
  ];
  const reportHistory = Array.isArray(assessmentDetails?.report_history)
    ? assessmentDetails.report_history
    : [];
  const reportTypeLabelMap = {
    assessment: copy.reportTypeAssessment,
    pt_summary: copy.reportTypePtSummary,
  };
  const ptWorkflowSteps = [
    { id: "resident", label: copy.ptWorkflowStepResident, done: Boolean(selectedResident) },
    { id: "assessment", label: copy.ptWorkflowStepAssessment, done: Boolean(selectedAssessment) },
    { id: "video", label: copy.ptWorkflowStepVideo, done: selectedAssessmentHasVideo },
    { id: "scores", label: copy.ptWorkflowStepScores, done: assessmentHasScores || Boolean(selectedAssessment?.has_scores) },
    ...(qaRequired ? [{ id: "qa", label: copy.ptWorkflowStepQa, done: assessmentHasQa }] : []),
    { id: "report", label: copy.ptWorkflowStepReport, done: assessmentHasReport },
  ];
  const ptWorkflowCompleted = ptWorkflowSteps.filter((step) => step.done).length;
  const ptWorkflowProgress = ptWorkflowSteps.length ? ptWorkflowCompleted / ptWorkflowSteps.length : 0;
  const ptWorkflowNext = ptWorkflowSteps.find((step) => !step.done) || null;
  const ptPainScore = parseNumber(ptForm.pt_pain_score);
  const ptSessionMinutes = parseNumber(ptForm.pt_session_minutes);
  const ptCptCodes = ptForm.pt_cpt_codes.trim();
  const ptGoals = ptForm.pt_goals.trim();
  const ptPlan = ptForm.pt_plan_of_care.trim();
  const ptChecklistRequired = [
    { id: "resident", label: copy.ptWorkflowStepResident, done: Boolean(selectedResident) },
    { id: "assessment", label: copy.ptWorkflowStepAssessment, done: Boolean(selectedAssessment) },
    { id: "video", label: copy.ptWorkflowStepVideo, done: selectedAssessmentHasVideo },
    { id: "scores", label: copy.ptWorkflowStepScores, done: assessmentHasScores || Boolean(selectedAssessment?.has_scores) },
    { id: "pain", label: copy.ptFieldPainLabel, done: ptPainScore !== null },
    { id: "cpt", label: copy.ptFieldCptLabel, done: Boolean(ptCptCodes) },
    { id: "goals", label: copy.ptFieldGoalsLabel, done: Boolean(ptGoals) },
    { id: "plan", label: copy.ptFieldPlanLabel, done: Boolean(ptPlan) },
    ...(qaRequired ? [{ id: "qa", label: copy.ptWorkflowStepQa, done: assessmentHasQa }] : []),
  ];
  const ptChecklistAll = [
    ...ptChecklistRequired,
    { id: "report", label: copy.ptWorkflowStepReport, done: assessmentHasReport },
  ];
  const ptChecklistComplete = ptChecklistRequired.every((item) => item.done);
  const ptChecklistMissing = ptChecklistRequired.filter((item) => !item.done).map((item) => item.label);
  const fallChecklistCompleted = fallChecklistItems.filter((item) => fallEventChecks[item]?.status === "completed").length;
  const ptTimeSavedRange = ptSessionMinutes !== null
    ? {
        min: Math.max(0, 20 - ptSessionMinutes),
        max: Math.max(0, 45 - ptSessionMinutes),
      }
    : null;
  const auditActionOptions = Array.from(new Set(auditLogs.map((log) => log.action).filter(Boolean))).sort();
  const auditEntityOptions = Array.from(new Set(auditLogs.map((log) => log.entity_type).filter(Boolean))).sort();
  const analyticsAssessments = analyticsData?.assessments_per_week ?? 0;
  const analyticsAvgMinutes = analyticsData?.avg_assessment_minutes ?? 0;
  const analyticsReassessment = analyticsData?.reassessment_rate ?? 0;
  const analyticsTotal = analyticsData?.assessments_total ?? 0;
  const analyticsCompleted = analyticsData?.assessments_completed ?? 0;
  const analyticsVideoCoverage = analyticsData?.video_coverage_rate ?? 0;
  const analyticsReportCoverage = analyticsData?.report_coverage_rate ?? 0;
  const analyticsAvgReportMinutes = analyticsData?.avg_time_to_report_minutes ?? 0;
  const analyticsVideos = analyticsData?.videos_uploaded ?? 0;
  const analyticsReports = analyticsData?.reports_generated ?? 0;
  const analyticsDueToday = analyticsData?.assessments_due_today ?? 0;
  const analyticsOverdue = analyticsData?.assessments_overdue ?? 0;
  const analyticsHighRisk = analyticsData?.assessments_high_risk ?? 0;
  const analyticsPostFallTotal = analyticsData?.post_fall_total ?? 0;
  const analyticsPostFallRequired = analyticsData?.post_fall_required ?? 0;
  const analyticsPostFallOpen = analyticsData?.post_fall_open ?? 0;
  const analyticsPostFallOverdue = analyticsData?.post_fall_overdue ?? 0;
  const analyticsPostFallCompletion = analyticsData?.post_fall_completion_rate ?? 0;
  const analyticsPostFallFollowupDays = analyticsData?.post_fall_followup_days;
  const fallFollowupDays = Number.isFinite(Number(analyticsPostFallFollowupDays))
    ? Math.max(0, Number(analyticsPostFallFollowupDays))
    : 3;
  const postFallRollupRows = postFallRollup.map((item, index) => {
    const unitLabel = item.unit_label || copy.analyticsPostFallUnitUnassigned;
    const completionRate = Number.isFinite(item.completion_rate) ? item.completion_rate : 0;
    return {
      key: item.unit_id || `unassigned-${index}`,
      unitId: item.unit_id || null,
      unitLabel,
      total: item.total || 0,
      open: item.open || 0,
      overdue: item.overdue || 0,
      completion: completionRate,
    };
  });
  const postFallRollupFiltered = postFallRollupRows.filter((row) => {
    if (postFallRollupFilter === "all") {
      return true;
    }
    if (postFallRollupFilter === "unassigned") {
      return !row.unitId;
    }
    return row.unitId === postFallRollupFilter;
  });
  const analyticsCompletionRate = analyticsTotal ? analyticsCompleted / analyticsTotal : 0;
  const analyticsHighRiskRate = analyticsTotal ? analyticsHighRisk / analyticsTotal : 0;
  const onboardingAutoStatus = {
    facilityProfile: Boolean(facilityProfile?.id || user?.facility_id),
    facilityProtocol: Boolean(facilityProfile?.assessment_protocol),
    facilityCapture: Boolean(facilityProfile?.capture_method),
    facilityRoles: Boolean(facilityProfile?.role_policy),
    teamInvited: user?.role === "admin" ? users.length > 1 : true,
    residentAdded: residents.length > 0,
    assessmentCreated: assessments.length > 0,
    videoUploaded: analyticsVideos > 0 || assessmentHasVideo,
    scoresCaptured: assessmentHasScores,
    reportGenerated: analyticsReports > 0 || assessmentHasReport,
  };
  const isOnboardingCheckComplete = (check) => {
    if (!check) {
      return false;
    }
    if (check.autoKey) {
      return Boolean(onboardingAutoStatus[check.autoKey]);
    }
    return Boolean(onboardingState.checks?.[check.id]);
  };
  const isOnboardingStepComplete = (step) => {
    if (!step) {
      return false;
    }
    if (step.adminOnly && user?.role !== "admin") {
      return true;
    }
    return step.checks.every((check) => isOnboardingCheckComplete(check));
  };
  const onboardingCompletedSteps = onboardingSteps.filter((step) => isOnboardingStepComplete(step)).length;
  const onboardingTotalSteps = onboardingSteps.length;
  const onboardingProgress = onboardingTotalSteps ? onboardingCompletedSteps / onboardingTotalSteps : 0;
  const onboardingAllComplete = onboardingSteps.length > 0 && onboardingSteps.every((step) => isOnboardingStepComplete(step));
  const onboardingCurrentStep = onboardingSteps[onboardingStepIndex] || onboardingSteps[0];
  const outcomesTotals = outcomesData?.totals ?? {};
  const outcomesTrendByWeek = outcomesData?.trend_by_week ?? [];
  const outcomesResidentTrends = outcomesData?.resident_trends ?? [];
  const outcomesAssessed = outcomesTotals.assessed_residents ?? 0;
  const outcomesTotalResidents = outcomesTotals.residents ?? 0;
  const outcomesImproved = outcomesTotals.improved ?? 0;
  const outcomesWorsened = outcomesTotals.worsened ?? 0;
  const outcomesStable = outcomesTotals.stable ?? 0;
  const outcomesUnknown = outcomesTotals.unknown ?? 0;
  const outcomesAssessedRate = outcomesTotalResidents ? outcomesAssessed / outcomesTotalResidents : 0;
  const outcomesImprovedRate = outcomesAssessed ? outcomesImproved / outcomesAssessed : 0;
  const outcomesWorsenedRate = outcomesAssessed ? outcomesWorsened / outcomesAssessed : 0;
  const outcomesStableRate = outcomesAssessed ? outcomesStable / outcomesAssessed : 0;
  const outcomesTrendLabelMap = {
    improved: copy.outcomesTrendImproved,
    worsened: copy.outcomesTrendWorsened,
    stable: copy.outcomesTrendStable,
    unknown: copy.outcomesTrendUnknown,
  };
  const outcomesTrendClassMap = {
    improved: "trend-pill trend-improved",
    worsened: "trend-pill trend-worsened",
    stable: "trend-pill trend-stable",
    unknown: "trend-pill trend-unknown",
  };
  const workflowStatusOptions = [
    { value: "all", label: copy.filterAll },
    { value: "needs_review", label: copy.statusNeeds },
    { value: "in_review", label: copy.statusReview },
  ];
  const workflowAssignedOptions = [
    { value: "all", label: copy.filterAll },
    { value: "me", label: copy.workflowAssignedMe },
    { value: "unassigned", label: copy.workflowAssignedUnassigned },
  ];
  const workflowWarningHours = 24;

  const getDueStatus = (assessment) => {
    if (!assessment || assessment.status === "completed") {
      return null;
    }
    const dueValue = assessment.due_date || assessment.scheduled_date || assessment.assessment_date;
    if (!dueValue) {
      return null;
    }
    const dueDate = parseDateOnly(dueValue);
    if (!dueDate) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate < today) {
      return { label: copy.assessmentOverdue, className: "status-pill status-open" };
    }
    if (dueDate.getTime() === today.getTime()) {
      return { label: copy.assessmentDueToday, className: "status-pill status-review" };
    }
    return { label: copy.assessmentUpcoming, className: "status-pill status-upcoming" };
  };

  const handleApiError = (error, setter) => {
    if (error?.status === 401) {
      setToken("");
      setUser(null);
      setter(copy.sessionExpired);
      return;
    }
    setter(error?.message || copy.genericError);
  };

  const clearReportPreview = () => {
    setReportPreview((prev) => {
      if (prev.url) {
        URL.revokeObjectURL(prev.url);
      }
      return { url: "", id: "", busy: false, error: "" };
    });
  };

  const resetUpload = () => {
    uploadMetaRequestId.current += 1;
    setUploadFile(null);
    setUploadMeta({ duration_seconds: "", width: "", height: "" });
    setUploadStatus({ busy: false, error: "", success: "", progress: 0 });
    setUploadFieldErrors({});
  };

  const handleUploadFileChange = async (event) => {
    const file = event.target.files?.[0] || null;
    const requestId = ++uploadMetaRequestId.current;
    setUploadFile(file);
    setUploadFieldErrors((prev) => ({ ...prev, file: "" }));
    setUploadStatus((prev) => ({ ...prev, error: "", success: "", progress: 0 }));
    setUploadMeta({ duration_seconds: "", width: "", height: "" });
    if (!file) {
      return;
    }
    try {
      const metadata = await readVideoMetadata(file);
      if (uploadMetaRequestId.current !== requestId) {
        return;
      }
      const durationSeconds = Number.isFinite(metadata.durationSeconds)
        ? metadata.durationSeconds.toFixed(1)
        : "";
      const width = Number.isFinite(metadata.width) ? String(metadata.width) : "";
      const height = Number.isFinite(metadata.height) ? String(metadata.height) : "";
      setUploadMeta({ duration_seconds: durationSeconds, width, height });
    } catch (_error) {
      if (uploadMetaRequestId.current !== requestId) {
        return;
      }
      setUploadStatus((prev) => ({ ...prev, error: copy.uploadMetaAutoError }));
    }
  };

  const normalizeValue = (value) => (value || "").trim().toLowerCase();

  const validateResident = (options = {}) => {
    const errors = {};
    if (!newResident.first_name.trim()) {
      errors.first_name = copy.residentMissing;
    }
    if (!newResident.last_name.trim()) {
      errors.last_name = copy.residentMissing;
    }
    if (!newResident.dob) {
      errors.dob = copy.residentMissing;
    } else {
      const dobDate = parseDateOnly(newResident.dob);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!dobDate || dobDate > today) {
        errors.dob = copy.residentDobFuture;
      }
    }
    setResidentFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return false;
    }

    const duplicate = residents.find((resident) => (
      normalizeValue(resident.first_name) === normalizeValue(newResident.first_name)
      && normalizeValue(resident.last_name) === normalizeValue(newResident.last_name)
      && formatDate(resident.dob) === newResident.dob
    ));

    if (duplicate && !options.allowDuplicate) {
      setResidentDuplicate(duplicate);
      return false;
    }

    setResidentDuplicate(null);
    return true;
  };

  const validateResidentEdit = () => {
    const errors = {};
    if (!residentEditForm.first_name.trim()) {
      errors.first_name = copy.residentMissing;
    }
    if (!residentEditForm.last_name.trim()) {
      errors.last_name = copy.residentMissing;
    }
    if (!residentEditForm.dob) {
      errors.dob = copy.residentMissing;
    } else {
      const dobDate = parseDateOnly(residentEditForm.dob);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!dobDate || dobDate > today) {
        errors.dob = copy.residentDobFuture;
      }
    }
    setResidentEditErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const updateNewResidentField = (field, value) => {
    setNewResident((prev) => ({ ...prev, [field]: value }));
    setResidentDuplicate(null);
  };

  const validateUserCreate = () => {
    const errors = {};
    if (!userCreateForm.email.trim()) {
      errors.email = copy.userRequired;
    }
    if (!userCreateForm.full_name.trim()) {
      errors.full_name = copy.userRequired;
    }
    if (!userCreateForm.password.trim()) {
      errors.password = copy.userRequired;
    }
    setUserCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateUserEdit = () => {
    const errors = {};
    if (!userEditForm.full_name.trim()) {
      errors.full_name = copy.userRequired;
    }
    setUserEditErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateFacilityNumbers = (value, field, errors) => {
    if (!value) {
      return;
    }
    const numeric = parseNumber(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      errors[field] = copy.facilityNumberInvalid;
    }
  };

  const validateFacilityCreate = () => {
    const errors = {};
    if (!facilityCreateForm.name.trim()) {
      errors.name = copy.facilityRequired;
    }
    validateFacilityNumbers(facilityCreateForm.reassessment_cadence_days, "reassessment_cadence_days", errors);
    validateFacilityNumbers(facilityCreateForm.report_turnaround_hours, "report_turnaround_hours", errors);
    setFacilityCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateFacilityEdit = () => {
    const errors = {};
    if (!facilityEditForm.name.trim()) {
      errors.name = copy.facilityRequired;
    }
    validateFacilityNumbers(facilityEditForm.reassessment_cadence_days, "reassessment_cadence_days", errors);
    validateFacilityNumbers(facilityEditForm.report_turnaround_hours, "report_turnaround_hours", errors);
    setFacilityEditErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAssessment = () => {
    const errors = {};
    const assessmentDate = parseDateOnly(newAssessment.assessment_date);
    if (!assessmentDate) {
      errors.assessment_date = copy.assessmentMissing;
    }
    const scheduledDateValue = newAssessment.scheduled_date || newAssessment.assessment_date;
    const scheduledDate = scheduledDateValue ? parseDateOnly(scheduledDateValue) : null;
    if (newAssessment.scheduled_date && !scheduledDate) {
      errors.scheduled_date = copy.assessmentMissing;
    }
    const dueDateValue = newAssessment.due_date || scheduledDateValue;
    const dueDate = dueDateValue ? parseDateOnly(dueDateValue) : null;
    if (newAssessment.due_date && !dueDate) {
      errors.due_date = copy.assessmentMissing;
    }
    if (dueDate && scheduledDate && dueDate < scheduledDate) {
      errors.due_date = copy.assessmentDueInvalid;
    }
    setAssessmentFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateScheduleForm = () => {
    const errors = {};
    const scheduledDate = parseDateOnly(scheduleForm.scheduled_date);
    if (!scheduledDate) {
      errors.scheduled_date = copy.assessmentMissing;
    }
    const dueDateValue = scheduleForm.due_date || scheduleForm.scheduled_date;
    const dueDate = parseDateOnly(dueDateValue);
    if (scheduleForm.due_date && !dueDate) {
      errors.due_date = copy.assessmentMissing;
    }
    if (dueDate && scheduledDate && dueDate < scheduledDate) {
      errors.due_date = copy.assessmentDueInvalid;
    }
    setScheduleErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateScoreValue = (value, field, errors) => {
    if (value === "") {
      return;
    }
    const numeric = parseNumber(value);
    if (!Number.isFinite(numeric)) {
      errors[field] = copy.scoreInvalid;
      return;
    }
    if (numeric < 0 || numeric > 300) {
      errors[field] = copy.scoreRange;
    }
  };

  const validateScores = () => {
    const errors = {};
    if (showTugField) {
      if (scoreForm.tug_seconds === "") {
        errors.tug_seconds = copy.scoreInvalid;
      } else {
        validateScoreValue(scoreForm.tug_seconds, "tug_seconds", errors);
      }
    }
    if (showChairField) {
      if (scoreForm.chair_stand_seconds === "") {
        errors.chair_stand_seconds = copy.scoreInvalid;
      } else {
        validateScoreValue(scoreForm.chair_stand_seconds, "chair_stand_seconds", errors);
      }
    }
    setScoreFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateUploadMeta = () => {
    const errors = {};
    ["duration_seconds", "width", "height"].forEach((field) => {
      if (uploadMeta[field] === "") {
        return;
      }
      const numeric = parseNumber(uploadMeta[field]);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        errors[field] = copy.uploadMetaError;
      }
    });
    setUploadFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError("");
    setLoginBusy(true);
    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: {
          email: loginForm.email,
          password: loginForm.password,
        },
      });
      setToken(data.token);
      setUser(data.user);
      setLoginForm((prev) => ({ ...prev, password: "" }));
    } catch (error) {
      setLoginError(error?.message || copy.genericError);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = () => {
    setToken("");
    setUser(null);
    setOnboardingOpen(false);
    setOnboardingState({ completed: false, dismissed: false, checks: {} });
    setOnboardingStepIndex(0);
    setOnboardingFacilityForm({
      assessment_protocol: "tug_chair_balance",
      capture_method: "record_upload",
      role_policy: "clinician_admin_only",
    });
    setOnboardingFacilitySaving(false);
    setOnboardingFacilityNotice("");
    setResidents([]);
    setAssessments([]);
    setAssessmentDetails(null);
    setSelectedResidentId(null);
    setSelectedAssessmentId(null);
    setFallEvents([]);
    setSelectedFallEventId(null);
    setFallEventError("");
    setFallEventNotice("");
    setFallEventChecks({});
    setFallEventChecksBusy({});
    setFallEventForm(buildFallEventForm());
    setResidentDrawerOpen(false);
    setResidentSearch("");
    setResidentSort("recent");
    setResidentSexFilter("all");
    setResidentLocationFilter("");
    setResidentDuplicate(null);
    setResidentSuccess("");
    setResidentError("");
    setResidentFieldErrors({});
    setResidentEditErrors({});
    setResidentEditNotice("");
    setNotifications([]);
    setNotificationError("");
    setNotificationFilter("all");
    setConfirmMarkAllOpen(false);
    setNewResident({
      first_name: "",
      last_name: "",
      dob: "",
      sex: "",
      external_id: "",
      notes: "",
      building: "",
      floor: "",
      unit: "",
      room: "",
      unit_id: "",
    });
    setResidentEditForm({
      first_name: "",
      last_name: "",
      dob: "",
      sex: "",
      external_id: "",
      notes: "",
      building: "",
      floor: "",
      unit: "",
      room: "",
      unit_id: "",
    });
    setAssessmentSearch("");
    setAssessmentSuccess("");
    setAuditLogs([]);
    setAuditError("");
    setAuditFilters(buildAuditFilters());
    setScheduleForm({ scheduled_date: "", due_date: "" });
    setScheduleErrors({});
    setScheduleNotice("");
    setQaChecks({});
    setQaNotes({});
    setQaEscalations({});
    setFacilities([]);
    setFacilityError("");
    setFacilitySuccess("");
    setFacilitySearch("");
    setSelectedFacilityId(null);
    setFacilityProfile(null);
    setUnits([]);
    setUnitError("");
    setUnitNotice("");
    setUnitForm({ label: "", building: "", floor: "", unit: "", room: "" });
    setFacilityCreateForm({
      name: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: "",
      reassessment_cadence_days: "90",
      report_turnaround_hours: "24",
      assessment_protocol: "tug_chair_balance",
      capture_method: "record_upload",
      role_policy: "clinician_admin_only",
      qa_checklist: "",
      fall_checklist: "",
    });
    setFacilityCreateErrors({});
    setFacilityEditForm({
      name: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: "",
      reassessment_cadence_days: "90",
      report_turnaround_hours: "24",
      assessment_protocol: "tug_chair_balance",
      capture_method: "record_upload",
      role_policy: "clinician_admin_only",
      qa_checklist: "",
      fall_checklist: "",
    });
    setFacilityEditErrors({});
    setFacilityEditNotice("");
    setUsers([]);
    setSelectedUserId(null);
    setUserError("");
    setUserSuccess("");
    setExportLogs([]);
    setExportLogsError("");
    setExportLogFilters(buildExportLogFilters());
    setExportFacilityId("");
    setExportTokenForm(buildExportTokenForm());
    setExportTokenResult(null);
    setExportTokenError("");
    setExportTokenBusy(false);
    auditAutoApplyRef.current = false;
    clearReportPreview();
    resetUpload();
    setLoginForm({ email: "", password: "" });
  };

  const persistOnboardingState = (updater) => {
    setOnboardingState((prev) => {
      const nextState = sanitizeOnboardingState(typeof updater === "function" ? updater(prev) : updater);
      assertOnboardingStateSafe(nextState);
      if (onboardingKey) {
        window.localStorage.setItem(onboardingKey, JSON.stringify(nextState));
      }
      return nextState;
    });
  };

  const handleOnboardingOpen = () => {
    setOnboardingOpen(true);
    persistOnboardingState((prev) => ({ ...prev, dismissed: false }));
  };

  const handleOnboardingDismiss = () => {
    persistOnboardingState((prev) => ({ ...prev, dismissed: true }));
    setOnboardingOpen(false);
  };

  const handleOnboardingComplete = () => {
    persistOnboardingState((prev) => ({ ...prev, completed: true, dismissed: false }));
    setOnboardingOpen(false);
  };

  const toggleOnboardingCheck = (checkId) => {
    persistOnboardingState((prev) => ({
      ...prev,
      checks: {
        ...prev.checks,
        [checkId]: !prev.checks?.[checkId],
      },
    }));
  };

  const loadResidents = async () => {
    if (!token) {
      return;
    }
    setResidentLoading(true);
    setResidentError("");
    try {
      const data = await apiRequest("/residents", { token });
      setResidents(data);
    } catch (error) {
      handleApiError(error, setResidentError);
    } finally {
      setResidentLoading(false);
    }
  };

  const loadAssessments = async (residentId) => {
    if (!token || !residentId) {
      return;
    }
    setAssessmentLoading(true);
    setAssessmentError("");
    try {
      const data = await apiRequest(`/residents/${residentId}/assessments`, { token });
      setAssessments(data);
    } catch (error) {
      handleApiError(error, setAssessmentError);
    } finally {
      setAssessmentLoading(false);
    }
  };

  const loadFallEvents = async (residentId) => {
    if (!token || !residentId) {
      return;
    }
    setFallEventLoading(true);
    setFallEventError("");
    try {
      const data = await apiRequest(`/residents/${residentId}/fall-events`, { token });
      setFallEvents(Array.isArray(data) ? data : []);
    } catch (error) {
      handleApiError(error, setFallEventError);
    } finally {
      setFallEventLoading(false);
    }
  };

  const loadFallEventChecks = async (eventId) => {
    if (!token || !eventId) {
      return;
    }
    try {
      const data = await apiRequest(`/fall-events/${eventId}/checks`, { token });
      const map = Array.isArray(data)
        ? data.reduce((acc, item) => {
            acc[item.check_type] = item;
            return acc;
          }, {})
        : {};
      setFallEventChecks(map);
    } catch (error) {
      handleApiError(error, setFallEventError);
    }
  };

  const loadAssessmentDetails = async (assessmentId) => {
    if (!token || !assessmentId) {
      return;
    }
    setDetailsLoading(true);
    setReportError("");
    try {
      const data = await apiRequest(`/assessments/${assessmentId}`, { token });
      setAssessmentDetails(data);
    } catch (error) {
      handleApiError(error, setReportError);
    } finally {
      setDetailsLoading(false);
    }
  };

  const loadNotifications = async (overrides) => {
    if (!token) {
      return;
    }
    setNotificationLoading(true);
    setNotificationError("");
    try {
      const status = overrides?.status ?? notificationFilter;
      const query = buildQueryString({
        status: status && status !== "all" ? status : undefined,
        limit: "100",
      });
      const data = await apiRequest(`/notifications${query}`, { token });
      setNotifications(Array.isArray(data) ? data : []);
    } catch (error) {
      handleApiError(error, setNotificationError);
    } finally {
      setNotificationLoading(false);
    }
  };

  const markNotificationRead = async (notificationId) => {
    if (!token || !notificationId) {
      return;
    }
    try {
      const data = await apiRequest(`/notifications/${notificationId}/read`, {
        method: "PATCH",
        token,
      });
      setNotifications((prev) => prev.map((item) => (
        item.id === notificationId ? { ...item, ...data } : item
      )));
    } catch (error) {
      handleApiError(error, setNotificationError);
    }
  };

  const markAllNotificationsRead = async () => {
    if (!token) {
      return;
    }
    if (notificationFilter === "read") {
      return;
    }
    try {
      const query = notificationFilter === "unread" ? "?status=unread" : "";
      await apiRequest(`/notifications/read-all${query}`, {
        method: "PATCH",
        token,
      });
      setNotifications((prev) => {
        if (notificationFilter === "unread") {
          return prev.filter((item) => item.status !== "unread");
        }
        return prev.map((item) => (
          item.status === "unread"
            ? { ...item, status: "read", read_at: new Date().toISOString() }
            : item
        ));
      });
    } catch (error) {
      handleApiError(error, setNotificationError);
    }
  };

  const updateSkipNotificationConfirm = (value) => {
    setSkipNotificationConfirm(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NOTIFICATION_CONFIRM_KEY, value ? "true" : "false");
    }
  };

  const loadAuditLogs = async (overrides) => {
    if (!token || user?.role !== "admin") {
      setAuditError(copy.auditNotAllowed);
      return;
    }
    setAuditLoading(true);
    setAuditError("");
    try {
      const activeFilters = overrides || auditFilters;
      const query = buildQueryString({
        action: activeFilters.action.trim(),
        entity_type: activeFilters.entity_type.trim(),
        user_id: activeFilters.user_id.trim(),
        from: activeFilters.from,
        to: activeFilters.to,
        limit: activeFilters.limit,
      });
      const data = await apiRequest(`/audit${query}`, { token });
      setAuditLogs(data);
    } catch (error) {
      handleApiError(error, setAuditError);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleExportAuditCsv = async () => {
    if (!token || user?.role !== "admin") {
      setAuditExportError(copy.auditNotAllowed);
      return;
    }
    setAuditExporting(true);
    setAuditExportError("");
    try {
      const query = buildQueryString({
        action: auditFilters.action.trim(),
        entity_type: auditFilters.entity_type.trim(),
        user_id: auditFilters.user_id.trim(),
        from: auditFilters.from,
        to: auditFilters.to,
        limit: auditFilters.limit,
      });
      const filename = `audit_${formatDate(new Date())}.csv`;
      await downloadProtected(`/exports/audit${query}`, token, filename);
    } catch (error) {
      setAuditExportError(error?.message || copy.auditExportError);
    } finally {
      setAuditExporting(false);
    }
  };

  const applyAuditPresetRange = (days) => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    setAuditFilters((prev) => ({
      ...prev,
      from: formatInputDateTime(start),
      to: formatInputDateTime(now),
    }));
  };

  const applyAuditPresetUser = () => {
    if (!user?.id) {
      return;
    }
    setAuditFilters((prev) => ({ ...prev, user_id: user.id }));
  };

  const resolveExportFacilityId = () => {
    if (exportFacilityId) {
      return exportFacilityId;
    }
    if (user?.role === "admin") {
      return selectedFacilityId || user?.facility_id || "";
    }
    return user?.facility_id || "";
  };

  const buildExportParams = (form) => {
    if (!form) {
      return null;
    }
    if (form.export_type === "assessments") {
      const params = {};
      if (form.resident_id.trim()) {
        params.resident_id = form.resident_id.trim();
      }
      if (form.status && form.status !== "all") {
        params.status = form.status;
      }
      if (form.risk_tier && form.risk_tier !== "all") {
        params.risk_tier = form.risk_tier;
      }
    if (form.from) {
      params.from = form.from;
    }
    if (form.to) {
      params.to = form.to;
    }
    if (form.assigned_to && form.assigned_to.trim()) {
      params.assigned_to = form.assigned_to.trim();
    }
    if (form.scheduled_from) {
      params.scheduled_from = form.scheduled_from;
    }
    if (form.scheduled_to) {
      params.scheduled_to = form.scheduled_to;
    }
    if (form.due_from) {
      params.due_from = form.due_from;
    }
    if (form.due_to) {
      params.due_to = form.due_to;
    }
    return Object.keys(params).length ? params : null;
  }
    if (form.export_type === "audit") {
      const params = {};
      if (form.audit_action.trim()) {
        params.action = form.audit_action.trim();
      }
      if (form.audit_entity_type.trim()) {
        params.entity_type = form.audit_entity_type.trim();
      }
      if (form.audit_user_id.trim()) {
        params.user_id = form.audit_user_id.trim();
      }
      if (form.audit_from) {
        params.from = form.audit_from;
      }
      if (form.audit_to) {
        params.to = form.audit_to;
      }
      const limit = Number(form.audit_limit);
      if (Number.isInteger(limit) && limit > 0) {
        params.limit = limit;
      }
      return Object.keys(params).length ? params : null;
    }
    if (form.export_type === "post_fall_rollup") {
      const params = {};
      const days = Number(form.post_fall_days);
      if (Number.isInteger(days) && days > 0) {
        params.days = days;
      }
      if (form.post_fall_unit_id && form.post_fall_unit_id !== "all") {
        params.unit_id = form.post_fall_unit_id;
      }
      return Object.keys(params).length ? params : null;
    }
    if (form.export_type === "bundle") {
      const include = [];
      if (form.include_residents) {
        include.push("residents");
      }
      if (form.include_assessments) {
        include.push("assessments");
      }
      if (form.include_audit) {
        include.push("audit");
      }
      return include.length ? { include } : null;
    }
    return null;
  };

  const resetExportScheduleForm = () => {
    setExportScheduleForm(buildExportScheduleForm());
    setEditingExportScheduleId(null);
  };

  const applyExportScheduleToForm = (schedule) => {
    if (!schedule) {
      resetExportScheduleForm();
      return;
    }
    setExportScheduleNotice("");
    const base = buildExportScheduleForm();
    const params = schedule.params || {};
    const include = Array.isArray(schedule.include) ? schedule.include : [];
    const exportType = schedule.export_type || base.export_type;
    const next = {
      ...base,
      name: schedule.name || "",
      export_type: exportType,
      frequency: schedule.frequency || base.frequency,
      day_of_week: schedule.day_of_week === null || schedule.day_of_week === undefined
        ? base.day_of_week
        : String(schedule.day_of_week),
      hour: schedule.hour === null || schedule.hour === undefined ? base.hour : String(schedule.hour),
      minute: schedule.minute === null || schedule.minute === undefined ? base.minute : String(schedule.minute),
      schedule_status: schedule.status || base.schedule_status,
      expires_hours: schedule.expires_hours === null || schedule.expires_hours === undefined
        ? base.expires_hours
        : String(schedule.expires_hours),
      include_residents: include.includes("residents"),
      include_assessments: include.includes("assessments"),
      include_audit: include.includes("audit"),
    };
    if (exportType === "assessments") {
      next.resident_id = params.resident_id || "";
      next.status = params.status || "all";
      next.risk_tier = params.risk_tier || "all";
      next.from = params.from || "";
      next.to = params.to || "";
      next.assigned_to = params.assigned_to || "";
      next.scheduled_from = params.scheduled_from || "";
      next.scheduled_to = params.scheduled_to || "";
      next.due_from = params.due_from || "";
      next.due_to = params.due_to || "";
    } else if (exportType === "audit") {
      next.audit_action = params.action || "";
      next.audit_entity_type = params.entity_type || "";
      next.audit_user_id = params.user_id || "";
      next.audit_from = params.from || "";
      next.audit_to = params.to || "";
      next.audit_limit = params.limit ? String(params.limit) : base.audit_limit;
    } else if (exportType === "post_fall_rollup") {
      next.post_fall_days = params.days ? String(params.days) : base.post_fall_days;
      next.post_fall_unit_id = params.unit_id || base.post_fall_unit_id;
    }
    setExportScheduleForm(next);
    setEditingExportScheduleId(schedule.id || null);
  };

  const handleCreateExportToken = async (event) => {
    event.preventDefault();
    if (!token || user?.role !== "admin") {
      setExportTokenError(copy.auditNotAllowed);
      return;
    }
    setExportTokenBusy(true);
    setExportTokenError("");
    setExportTokenResult(null);
    try {
      const exportType = exportTokenForm.export_type;
      if (exportType === "audit" && user?.role !== "admin") {
        throw new Error(copy.auditNotAllowed);
      }
      const facilityId = resolveExportFacilityId();
      const expiresHours = parseNumber(exportTokenForm.expires_in_hours);
      if (expiresHours !== null && (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 168)) {
        throw new Error(copy.exportExpiresInvalid);
      }
      const params = buildExportParams(exportTokenForm);
      if (exportType === "bundle" && !params?.include?.length) {
        throw new Error(copy.exportIncludeRequired);
      }
      const body = { export_type: exportType };
      if (facilityId) {
        body.facility_id = facilityId;
      }
      if (params) {
        body.params = params;
      }
      if (expiresHours !== null) {
        body.expires_in_hours = expiresHours;
      }
      const data = await apiRequest("/exports/tokens", {
        method: "POST",
        token,
        body,
      });
      setExportTokenResult(data);
    } catch (error) {
      handleApiError(error, setExportTokenError);
    } finally {
      setExportTokenBusy(false);
    }
  };

  const loadExportSchedules = async () => {
    if (!token || user?.role !== "admin") {
      setExportScheduleError(copy.auditNotAllowed);
      return;
    }
    setExportScheduleLoading(true);
    setExportScheduleError("");
    try {
      const facilityId = resolveExportFacilityId();
      const query = buildQueryString({ facility_id: facilityId });
      const data = await apiRequest(`/export-schedules${query}`, { token });
      setExportSchedules(Array.isArray(data) ? data : []);
    } catch (error) {
      handleApiError(error, setExportScheduleError);
    } finally {
      setExportScheduleLoading(false);
    }
  };

  const handleSaveExportSchedule = async (event) => {
    event.preventDefault();
    if (!token || user?.role !== "admin") {
      setExportScheduleError(copy.auditNotAllowed);
      return;
    }
    setExportScheduleSaving(true);
    setExportScheduleError("");
    setExportScheduleNotice("");
    try {
      const facilityId = resolveExportFacilityId();
      const expiresHours = parseNumber(exportScheduleForm.expires_hours);
      const body = {
        name: exportScheduleForm.name.trim(),
        export_type: exportScheduleForm.export_type,
        frequency: exportScheduleForm.frequency,
        day_of_week: exportScheduleForm.frequency === "weekly"
          ? Number(exportScheduleForm.day_of_week)
          : null,
        hour: Number(exportScheduleForm.hour),
        minute: Number(exportScheduleForm.minute),
        status: exportScheduleForm.schedule_status,
      };
      if (!editingExportScheduleId) {
        body.facility_id = facilityId;
      }
      if (expiresHours !== null) {
        body.expires_hours = expiresHours;
      }
      const params = buildExportParams(exportScheduleForm);
      if (exportScheduleForm.export_type === "bundle") {
        if (!params?.include?.length) {
          throw new Error(copy.exportIncludeRequired);
        }
        body.include = params.include;
      } else if (params) {
        body.params = params;
      }
      if (editingExportScheduleId) {
        await apiRequest(`/export-schedules/${editingExportScheduleId}`, {
          method: "PATCH",
          token,
          body,
        });
        setExportScheduleNotice(copy.exportScheduleUpdated);
      } else {
        await apiRequest("/export-schedules", {
          method: "POST",
          token,
          body,
        });
        setExportScheduleNotice(copy.exportScheduleCreated);
      }
      resetExportScheduleForm();
      await loadExportSchedules();
    } catch (error) {
      handleApiError(error, setExportScheduleError);
    } finally {
      setExportScheduleSaving(false);
    }
  };

  const handleRunExportSchedule = async (scheduleId) => {
    if (!token || user?.role !== "admin") {
      setExportScheduleError(copy.auditNotAllowed);
      return;
    }
    setExportScheduleError("");
    try {
      await apiRequest(`/export-schedules/${scheduleId}/run`, {
        method: "POST",
        token,
      });
      await loadExportSchedules();
    } catch (error) {
      handleApiError(error, setExportScheduleError);
    }
  };

  const handleToggleExportSchedule = async (scheduleId, nextStatus) => {
    if (!token || user?.role !== "admin") {
      setExportScheduleError(copy.auditNotAllowed);
      return;
    }
    setExportScheduleError("");
    try {
      await apiRequest(`/export-schedules/${scheduleId}`, {
        method: "PATCH",
        token,
        body: { status: nextStatus },
      });
      await loadExportSchedules();
    } catch (error) {
      handleApiError(error, setExportScheduleError);
    }
  };

  const loadFacilityRollup = async () => {
    if (!token || user?.role !== "admin") {
      setFacilityRollupError(copy.auditNotAllowed);
      return;
    }
    setFacilityRollupLoading(true);
    setFacilityRollupError("");
    try {
      const data = await apiRequest("/analytics/facility-rollup", { token });
      setFacilityRollup(Array.isArray(data) ? data : []);
    } catch (error) {
      handleApiError(error, setFacilityRollupError);
    } finally {
      setFacilityRollupLoading(false);
    }
  };

  const loadExportLogs = async (overrides) => {
    if (!token || user?.role !== "admin") {
      setExportLogsError(copy.auditNotAllowed);
      return;
    }
    setExportLogsLoading(true);
    setExportLogsError("");
    try {
      const activeFilters = overrides || exportLogFilters;
      const query = buildQueryString({
        facility_id: resolveExportFacilityId(),
        export_type: activeFilters.export_type,
        limit: activeFilters.limit,
      });
      const data = await apiRequest(`/exports/logs${query}`, { token });
      setExportLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      handleApiError(error, setExportLogsError);
    } finally {
      setExportLogsLoading(false);
    }
  };

  const loadAnalytics = async () => {
    if (!token) {
      return;
    }
    setAnalyticsLoading(true);
    setAnalyticsError("");
    setPostFallRollupLoading(true);
    setPostFallRollupError("");
    try {
      const query = buildQueryString({ days: analyticsDays });
      const data = await apiRequest(`/analytics/summary${query}`, { token });
      setAnalyticsData(data);
      setAnalyticsUpdated(new Date().toISOString());
      try {
        const rollup = await apiRequest(`/analytics/post-fall-rollup${query}`, { token });
        setPostFallRollup(Array.isArray(rollup) ? rollup : []);
      } catch (error) {
        handleApiError(error, setPostFallRollupError);
        setPostFallRollup([]);
      }
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
        setAnalyticsError(copy.sessionExpired);
        setPostFallRollupError(copy.sessionExpired);
      } else {
        setAnalyticsError(error?.message || copy.analyticsError);
        setPostFallRollup([]);
      }
    } finally {
      setAnalyticsLoading(false);
      setPostFallRollupLoading(false);
    }
  };

  const loadOutcomes = async () => {
    if (!token) {
      return;
    }
    setOutcomesLoading(true);
    setOutcomesError("");
    try {
      const query = buildQueryString({
        days: outcomesDays,
        weeks: outcomesWeeks,
        limit: 12,
      });
      const data = await apiRequest(`/analytics/outcomes${query}`, { token });
      setOutcomesData(data);
      setOutcomesUpdated(new Date().toISOString());
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
        setOutcomesError(copy.sessionExpired);
      } else {
        setOutcomesError(error?.message || copy.analyticsError);
      }
    } finally {
      setOutcomesLoading(false);
    }
  };

  const loadWorkflowQueue = async () => {
    if (!token) {
      return;
    }
    setWorkflowLoading(true);
    setWorkflowError("");
    try {
      const query = buildQueryString({
        status: workflowStatusFilter,
        assigned: workflowAssignedFilter,
        unit_id: workflowUnitFilter !== "all" ? workflowUnitFilter : undefined,
      });
      const data = await apiRequest(`/workflow/queue${query}`, { token });
      setWorkflowQueue(Array.isArray(data) ? data : []);
      setWorkflowUpdated(new Date().toISOString());
    } catch (error) {
      handleApiError(error, setWorkflowError);
    } finally {
      setWorkflowLoading(false);
    }
  };

  const handleAssignWorkflow = async (assessmentId, nextAssignee) => {
    if (!token) {
      return;
    }
    setWorkflowError("");
    try {
      await apiRequest(`/assessments/${assessmentId}/assign`, {
        method: "PATCH",
        token,
        body: { assigned_to: nextAssignee },
      });
      await loadWorkflowQueue();
    } catch (error) {
      handleApiError(error, setWorkflowError);
    }
  };

  const handleWorkflowStatusUpdate = async (assessmentId, status) => {
    if (!token) {
      return;
    }
    setWorkflowError("");
    try {
      await apiRequest(`/assessments/${assessmentId}`, {
        method: "PATCH",
        token,
        body: { status },
      });
      await loadWorkflowQueue();
      if (selectedResidentId) {
        loadAssessments(selectedResidentId);
      }
    } catch (error) {
      handleApiError(error, setWorkflowError);
    }
  };

  const loadUsers = async () => {
    if (!token || user?.role !== "admin") {
      setUserError(copy.auditNotAllowed);
      return;
    }
    setUserLoading(true);
    setUserError("");
    try {
      const data = await apiRequest("/users", { token });
      setUsers(data);
    } catch (error) {
      handleApiError(error, setUserError);
    } finally {
      setUserLoading(false);
    }
  };

  const loadFacilities = async () => {
    if (!token || user?.role !== "admin") {
      setFacilityError(copy.auditNotAllowed);
      return;
    }
    setFacilityLoading(true);
    setFacilityError("");
    try {
      const data = await apiRequest("/facilities", { token });
      setFacilities(Array.isArray(data) ? data : []);
    } catch (error) {
      handleApiError(error, setFacilityError);
    } finally {
      setFacilityLoading(false);
    }
  };

  const resolveUnitFacilityId = () => {
    if (user?.role === "admin") {
      return selectedFacilityId || user?.facility_id || "";
    }
    return user?.facility_id || "";
  };

  const loadUnits = async () => {
    if (!token) {
      return;
    }
    setUnitLoading(true);
    setUnitError("");
    try {
      const facilityId = resolveUnitFacilityId();
      const query = buildQueryString({ facility_id: facilityId || undefined });
      const data = await apiRequest(`/units${query}`, { token });
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
      setUnits(list);
    } catch (error) {
      handleApiError(error, setUnitError);
    } finally {
      setUnitLoading(false);
    }
  };

  const handleCreateUnit = async (event) => {
    event.preventDefault();
    if (!token || user?.role !== "admin") {
      setUnitError(copy.auditNotAllowed);
      return;
    }
    setUnitError("");
    setUnitNotice("");
    setUnitSaving(true);
    try {
      const facilityId = resolveUnitFacilityId();
      const payload = {
        facility_id: facilityId || undefined,
        label: unitForm.label.trim() || undefined,
        building: unitForm.building.trim() || null,
        floor: unitForm.floor.trim() || null,
        unit: unitForm.unit.trim() || null,
        room: unitForm.room.trim() || null,
      };
      const created = await apiRequest("/units", {
        method: "POST",
        token,
        body: payload,
      });
      setUnits((prev) => [...prev, created].sort((a, b) => a.label.localeCompare(b.label)));
      setUnitForm({ label: "", building: "", floor: "", unit: "", room: "" });
      setUnitNotice(copy.unitCreated);
    } catch (error) {
      handleApiError(error, setUnitError);
    } finally {
      setUnitSaving(false);
    }
  };

  const loadFacilityProfile = async () => {
    if (!token) {
      return;
    }
    try {
      const data = await apiRequest("/facilities", { token });
      const list = Array.isArray(data) ? data : [];
      if (!list.length) {
        setFacilityProfile(null);
        return;
      }
      const matched = user?.facility_id
        ? list.find((item) => item.id === user.facility_id)
        : null;
      setFacilityProfile(matched || list[0]);
    } catch (_error) {
      setFacilityProfile(null);
    }
  };

  const loadQaForResident = async (residentId) => {
    if (!token || !residentId) {
      return;
    }
    setQaLoading(true);
    setQaError("");
    try {
      const query = buildQueryString({ resident_id: residentId });
      const data = await apiRequest(`/qa${query}`, { token });
      const checks = {};
      const notes = {};
      const escalations = {};
      (Array.isArray(data) ? data : []).forEach((row) => {
        if (!row?.assessment_id) {
          return;
        }
        checks[row.assessment_id] = row.checks || {};
        notes[row.assessment_id] = row.notes || "";
        escalations[row.assessment_id] = Boolean(row.escalated);
      });
      setQaChecks(checks);
      setQaNotes(notes);
      setQaEscalations(escalations);
    } catch (error) {
      handleApiError(error, setQaError);
    } finally {
      setQaLoading(false);
    }
  };

  const saveQaEntry = async (assessmentId, overrides = {}) => {
    if (!token || !assessmentId) {
      return;
    }
    setQaError("");
    try {
      const payload = {
        checks: overrides.checks ?? qaChecks[assessmentId] ?? {},
        notes: Object.prototype.hasOwnProperty.call(overrides, "notes")
          ? overrides.notes
          : (qaNotes[assessmentId] ?? ""),
        escalated: Object.prototype.hasOwnProperty.call(overrides, "escalated")
          ? overrides.escalated
          : Boolean(qaEscalations[assessmentId]),
      };
      const data = await apiRequest(`/assessments/${assessmentId}/qa`, {
        method: "PUT",
        token,
        body: payload,
      });
      if (data?.assessment_id) {
        setQaChecks((prev) => ({ ...prev, [assessmentId]: data.checks || {} }));
        setQaNotes((prev) => ({ ...prev, [assessmentId]: data.notes || "" }));
        setQaEscalations((prev) => ({ ...prev, [assessmentId]: Boolean(data.escalated) }));
      }
    } catch (error) {
      handleApiError(error, setQaError);
    }
  };

  const handleQaToggle = (assessmentId, step) => {
    setQaChecks((prev) => {
      const current = prev[assessmentId] || {};
      const next = { ...current, [step]: !current[step] };
      saveQaEntry(assessmentId, {
        checks: next,
        notes: qaNotes[assessmentId] ?? "",
        escalated: Boolean(qaEscalations[assessmentId]),
      });
      return { ...prev, [assessmentId]: next };
    });
  };

  const handleQaNoteChange = (assessmentId, value) => {
    setQaNotes((prev) => ({ ...prev, [assessmentId]: value }));
  };

  const handleQaNoteBlur = (assessmentId) => {
    saveQaEntry(assessmentId, { notes: qaNotes[assessmentId] || "" });
  };

  const handleQaEscalateToggle = (assessmentId) => {
    setQaEscalations((prev) => {
      const nextValue = !prev[assessmentId];
      saveQaEntry(assessmentId, {
        checks: qaChecks[assessmentId] ?? {},
        notes: qaNotes[assessmentId] ?? "",
        escalated: nextValue,
      });
      return { ...prev, [assessmentId]: nextValue };
    });
  };

  useEffect(() => {
    if (!token) {
      setResidents([]);
      setAssessments([]);
      setAssessmentDetails(null);
      setSelectedResidentId(null);
      setSelectedAssessmentId(null);
      setFallEvents([]);
      setSelectedFallEventId(null);
      setFallEventError("");
      setFallEventNotice("");
      setFallEventChecks({});
      setFallEventChecksBusy({});
      setFallEventForm(buildFallEventForm());
      setAnalyticsData(null);
    setAnalyticsUpdated("");
    setAnalyticsError("");
    setOutcomesData(null);
    setOutcomesUpdated("");
    setOutcomesError("");
      setQaChecks({});
      setQaNotes({});
      setQaEscalations({});
      setFacilityProfile(null);
      setAuditLogs([]);
      setAuditError("");
      setAuditFilters(buildAuditFilters());
      auditAutoApplyRef.current = false;
      setScheduleForm({ scheduled_date: "", due_date: "" });
      setScheduleErrors({});
      setScheduleNotice("");
      setFacilities([]);
      setFacilityError("");
      setFacilitySuccess("");
      setFacilitySearch("");
      setSelectedFacilityId(null);
      setFacilityCreateForm({
        name: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        zip: "",
        reassessment_cadence_days: "90",
        report_turnaround_hours: "24",
        assessment_protocol: "tug_chair_balance",
        capture_method: "record_upload",
        role_policy: "clinician_admin_only",
        qa_checklist: "",
        fall_checklist: "",
      });
      setFacilityCreateErrors({});
      setFacilityEditForm({
        name: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        zip: "",
        reassessment_cadence_days: "90",
        report_turnaround_hours: "24",
        assessment_protocol: "tug_chair_balance",
        capture_method: "record_upload",
        role_policy: "clinician_admin_only",
        qa_checklist: "",
        fall_checklist: "",
      });
      setFacilityEditErrors({});
      setFacilityEditNotice("");
      return;
    }
    loadResidents();
    loadAnalytics();
    loadFacilityProfile();
  }, [token]);

  useEffect(() => {
    if (!token || !user?.id) {
      setOnboardingState({ completed: false, dismissed: false, checks: {} });
      setOnboardingOpen(false);
      setOnboardingStepIndex(0);
      return;
    }
    const storedRaw = getStoredJson(onboardingKey) || { completed: false, dismissed: false, checks: {} };
    const stored = sanitizeOnboardingState(storedRaw);
    setOnboardingState(stored);
    if (!stored.completed && !stored.dismissed) {
      setOnboardingOpen(true);
      setOnboardingStepIndex(0);
    }
  }, [token, user?.id, onboardingKey]);

  useEffect(() => {
    if (onboardingStepIndex >= onboardingSteps.length) {
      setOnboardingStepIndex(0);
    }
  }, [onboardingStepIndex, onboardingSteps.length]);

  useEffect(() => {
    if (!token) {
      return;
    }
    if (user?.facility_id) {
      loadFacilityProfile();
    }
  }, [token, user?.facility_id]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      loadAnalytics();
    }, 300);
    return () => clearTimeout(timeout);
  }, [analyticsDays, token]);

  useEffect(() => {
    if (token && user?.role === "admin") {
      loadAuditLogs();
      loadUsers();
      loadFacilities();
    }
  }, [token, user?.role]);

  useEffect(() => {
    if (!token) {
      return;
    }
    loadUnits();
  }, [token, user?.role, selectedFacilityId]);

  useEffect(() => {
    if (activePanel === "qa" && token && selectedResidentId) {
      loadQaForResident(selectedResidentId);
    }
  }, [activePanel, token, selectedResidentId]);

  useEffect(() => {
    if (!user?.facility_id || facilities.length === 0) {
      return;
    }
    const matched = facilities.find((item) => item.id === user.facility_id);
    if (matched) {
      setFacilityProfile(matched);
    }
  }, [facilities, user?.facility_id]);

  useEffect(() => {
    if (!facilityProfile) {
      return;
    }
    setOnboardingFacilityForm({
      assessment_protocol: facilityProfile.assessment_protocol || "tug_chair_balance",
      capture_method: facilityProfile.capture_method || "record_upload",
      role_policy: facilityProfile.role_policy || "clinician_admin_only",
    });
    setOnboardingFacilityNotice("");
  }, [facilityProfile?.id, facilityProfile?.assessment_protocol, facilityProfile?.capture_method, facilityProfile?.role_policy]);

  useEffect(() => {
    if (!token || user?.role !== "admin") {
      return undefined;
    }
    if (!auditAutoApplyRef.current) {
      auditAutoApplyRef.current = true;
      return undefined;
    }
    const timeout = setTimeout(() => {
      loadAuditLogs(auditFilters);
    }, 400);
    return () => clearTimeout(timeout);
  }, [auditFilters, token, user?.role]);

  useEffect(() => {
    if (activePanel !== "incidents" || !token || !selectedResidentId) {
      return;
    }
    loadFallEvents(selectedResidentId);
  }, [activePanel, token, selectedResidentId]);

  useEffect(() => {
    if (fallEvents.length === 0) {
      setSelectedFallEventId(null);
      return;
    }
    if (!selectedFallEventId || !fallEvents.find((event) => event.id === selectedFallEventId)) {
      setSelectedFallEventId(fallEvents[0].id);
    }
  }, [fallEvents, selectedFallEventId]);

  useEffect(() => {
    if (!token || !selectedFallEventId) {
      setFallEventChecks({});
      return;
    }
    loadFallEventChecks(selectedFallEventId);
  }, [selectedFallEventId, token]);

  useEffect(() => {
    if (!token) {
      setActivePanel("overview");
      return;
    }
    if (!availableNavItems.find((item) => item.id === activePanel)) {
      setActivePanel(availableNavItems[0]?.id || "overview");
    }
  }, [token, user?.role, availableNavItems, activePanel]);

  useEffect(() => {
    if (activePanel !== "outcomes" || !token) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      loadOutcomes();
    }, 300);
    return () => clearTimeout(timeout);
  }, [activePanel, token, outcomesDays, outcomesWeeks]);

  useEffect(() => {
    if (activePanel !== "notifications" || !token) {
      return;
    }
    loadNotifications();
  }, [activePanel, token, notificationFilter]);

  useEffect(() => {
    if (activePanel !== "workflow" || !token) {
      return;
    }
    const timeout = setTimeout(() => {
      loadWorkflowQueue();
    }, 300);
    return () => clearTimeout(timeout);
  }, [activePanel, token, workflowStatusFilter, workflowAssignedFilter, workflowUnitFilter]);

  useEffect(() => {
    if ((activePanel !== "audit" && activePanel !== "exports") || !token || user?.role !== "admin") {
      return;
    }
    if (!facilities.length && !facilityLoading) {
      loadFacilities();
    }
  }, [activePanel, token, user?.role, facilities.length, facilityLoading]);

  useEffect(() => {
    if (activePanel !== "exports" || !token || user?.role !== "admin") {
      return;
    }
    loadExportSchedules();
    loadFacilityRollup();
  }, [activePanel, token, user?.role, exportFacilityId]);

  useEffect(() => {
    if (!token || user?.role !== "admin") {
      return;
    }
    if (!exportFacilityId) {
      const fallback = selectedFacilityId || user?.facility_id;
      if (fallback) {
        setExportFacilityId(fallback);
      }
    }
  }, [exportFacilityId, selectedFacilityId, token, user?.facility_id, user?.role]);

  useEffect(() => {
    if (activePanel !== "residents") {
      setResidentDrawerOpen(false);
    }
  }, [activePanel]);

  useEffect(() => {
    if (!token || residents.length === 0) {
      return;
    }
    if (!selectedResidentId || !residents.find((item) => item.id === selectedResidentId)) {
      setSelectedResidentId(residents[0].id);
    }
  }, [residents, selectedResidentId, token]);

  useEffect(() => {
    if (!token || user?.role !== "admin" || facilities.length === 0) {
      return;
    }
    if (!selectedFacilityId || !facilities.find((item) => item.id === selectedFacilityId)) {
      setSelectedFacilityId(facilities[0].id);
    }
  }, [facilities, selectedFacilityId, token, user?.role]);

  useEffect(() => {
    if (!selectedResident) {
      setResidentEditForm({
        first_name: "",
        last_name: "",
        dob: "",
        sex: "",
        external_id: "",
        notes: "",
        building: "",
        floor: "",
        unit: "",
        room: "",
        unit_id: "",
      });
      setResidentEditErrors({});
      setResidentEditNotice("");
      return;
    }
    setResidentEditForm({
      first_name: selectedResident.first_name || "",
      last_name: selectedResident.last_name || "",
      dob: formatDate(selectedResident.dob),
      sex: selectedResident.sex || "",
      external_id: selectedResident.external_id || "",
      notes: selectedResident.notes || "",
      building: selectedResident.building || "",
      floor: selectedResident.floor || "",
      unit: selectedResident.unit || "",
      room: selectedResident.room || "",
      unit_id: selectedResident.unit_id || "",
    });
    setResidentEditErrors({});
    setResidentEditNotice("");
  }, [selectedResidentId, selectedResident]);

  useEffect(() => {
    if (!selectedResident) {
      setFallEventForm(buildFallEventForm());
      setFallEvents([]);
      setSelectedFallEventId(null);
      return;
    }
    setFallEventForm(buildFallEventForm(selectedResident));
    setFallEventNotice("");
    setFallEventError("");
  }, [selectedResidentId, selectedResident]);

  useEffect(() => {
    if (!selectedAssessment) {
      setScheduleForm({ scheduled_date: "", due_date: "" });
      setScheduleErrors({});
      setScheduleNotice("");
      return;
    }
    setScheduleForm({
      scheduled_date: formatDate(selectedAssessment.scheduled_date || selectedAssessment.assessment_date),
      due_date: formatDate(selectedAssessment.due_date || selectedAssessment.scheduled_date || selectedAssessment.assessment_date),
    });
    setScheduleErrors({});
    setScheduleNotice("");
  }, [selectedAssessmentId, selectedAssessment]);

  useEffect(() => {
    if (!selectedUser) {
      setUserEditForm({
        full_name: "",
        role: "clinician",
        status: "active",
        password: "",
      });
      setUserEditErrors({});
      setUserEditNotice("");
      return;
    }
    setUserEditForm({
      full_name: selectedUser.full_name || "",
      role: selectedUser.role || "clinician",
      status: selectedUser.status || "active",
      password: "",
    });
    setUserEditErrors({});
    setUserEditNotice("");
  }, [selectedUserId, selectedUser]);

  useEffect(() => {
    if (!selectedFacility) {
      setFacilityEditForm({
        name: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        zip: "",
        reassessment_cadence_days: "90",
        report_turnaround_hours: "24",
        assessment_protocol: "tug_chair_balance",
        capture_method: "record_upload",
        role_policy: "clinician_admin_only",
        qa_checklist: "",
        fall_checklist: "",
      });
      setFacilityEditErrors({});
      setFacilityEditNotice("");
      return;
    }
    setFacilityEditForm({
      name: selectedFacility.name || "",
      address_line1: selectedFacility.address_line1 || "",
      address_line2: selectedFacility.address_line2 || "",
      city: selectedFacility.city || "",
      state: selectedFacility.state || "",
      zip: selectedFacility.zip || "",
      reassessment_cadence_days: String(selectedFacility.reassessment_cadence_days || 90),
      report_turnaround_hours: String(selectedFacility.report_turnaround_hours || 24),
      assessment_protocol: selectedFacility.assessment_protocol || "tug_chair_balance",
      capture_method: selectedFacility.capture_method || "record_upload",
      role_policy: selectedFacility.role_policy || "clinician_admin_only",
      qa_checklist: formatChecklistText(selectedFacility.qa_checklist),
      fall_checklist: formatChecklistText(selectedFacility.fall_checklist),
    });
    setFacilityEditErrors({});
    setFacilityEditNotice("");
  }, [selectedFacilityId, selectedFacility]);

  useEffect(() => {
    if (!token || !selectedResidentId) {
      setAssessments([]);
      setSelectedAssessmentId(null);
      return;
    }
    loadAssessments(selectedResidentId);
  }, [token, selectedResidentId]);

  useEffect(() => {
    setTimelineFilters({ status: "all", risk: "all", from: "", to: "" });
    setAssessmentSearch("");
  }, [selectedResidentId]);

  useEffect(() => {
    if (!token || assessments.length === 0) {
      setSelectedAssessmentId(null);
      return;
    }
    if (!selectedAssessmentId || !assessments.find((item) => item.id === selectedAssessmentId)) {
      const latestWithVideo = pickMostRecentAssessmentWithVideo(assessments);
      setSelectedAssessmentId(latestWithVideo?.id || assessments[0].id);
    }
  }, [assessments, selectedAssessmentId, token]);

  useEffect(() => {
    if (!token || !selectedAssessmentId) {
      setAssessmentDetails(null);
      return;
    }
    setAssessmentDetails(null);
    loadAssessmentDetails(selectedAssessmentId);
  }, [token, selectedAssessmentId]);

  useEffect(() => {
    resetUpload();
    setScoreNotice("");
    setReportError("");
    setScoreFieldErrors({});
    clearReportPreview();
  }, [selectedAssessmentId]);

  useEffect(() => {
    if (!residentDrawerOpen) {
      return;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setResidentDrawerOpen(false);
      }
      if (event.key !== "Tab") {
        return;
      }
      const container = drawerRef.current;
      if (!container) {
        return;
      }
      const focusables = Array.from(
        container.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => !node.hasAttribute("disabled"));
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const previouslyFocused = document.activeElement;
    const focusTarget = drawerRef.current?.querySelector("button, [href], input, select, textarea");
    if (focusTarget) {
      focusTarget.focus();
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [residentDrawerOpen]);

  useEffect(() => {
    return () => {
      clearReportPreview();
    };
  }, []);

  useEffect(() => {
    if (reportPreview.id && assessmentDetails?.report?.id && reportPreview.id !== assessmentDetails.report.id) {
      clearReportPreview();
    }
  }, [assessmentDetails?.report?.id, reportPreview.id]);

  useEffect(() => {
    if (!assessmentDetails) {
      return;
    }
    const scores = assessmentDetails.scores || {};
    setScoreForm({
      status: assessmentDetails.status || "",
      risk_tier: assessmentDetails.risk_tier || "",
      clinician_notes: assessmentDetails.clinician_notes || "",
      tug_seconds: scores.tug_seconds ?? "",
      chair_stand_seconds: scores.chair_stand_seconds ?? "",
      balance_side_by_side: Boolean(scores.balance_side_by_side),
      balance_semi_tandem: Boolean(scores.balance_semi_tandem),
      balance_tandem: Boolean(scores.balance_tandem),
      score_notes: scores.score_notes || "",
    });
  }, [assessmentDetails]);

  useEffect(() => {
    if (!assessmentDetails) {
      setPtForm(buildPtForm());
      setPtNotice("");
      setPtError("");
      return;
    }
    setPtForm({
      pt_cpt_codes: assessmentDetails.pt_cpt_codes || "",
      pt_goals: assessmentDetails.pt_goals || "",
      pt_plan_of_care: assessmentDetails.pt_plan_of_care || "",
      pt_pain_score: assessmentDetails.pt_pain_score ?? "",
      pt_session_minutes: assessmentDetails.pt_session_minutes ?? "",
      pt_time_saved_minutes: assessmentDetails.pt_time_saved_minutes ?? "",
    });
    setPtElapsedSeconds(0);
    setPtTimerActive(false);
    setPtNotice("");
    setPtError("");
  }, [assessmentDetails?.id]);

  useEffect(() => {
    if (!ptTimerActive) {
      return;
    }
    const interval = setInterval(() => {
      setPtElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [ptTimerActive]);

  useEffect(() => {
    if (!token || !selectedAssessmentId) {
      return;
    }
    const status = assessmentDetails?.model_run?.status;
    if (!status) {
      return;
    }
    if (status === "completed" && !assessmentDetails?.scores) {
      const timeout = setTimeout(() => {
        loadAssessmentDetails(selectedAssessmentId);
      }, 1500);
      return () => clearTimeout(timeout);
    }
    if (status !== "queued" && status !== "running") {
      return;
    }
    const interval = setInterval(() => {
      loadAssessmentDetails(selectedAssessmentId);
    }, 10000);
    return () => clearInterval(interval);
  }, [assessmentDetails?.model_run?.status, assessmentDetails?.scores, selectedAssessmentId, token]);

  const handleCreateResident = async (event, options = {}) => {
    event?.preventDefault();
    setResidentError("");
    setResidentSuccess("");
    if (!validateResident(options)) {
      return;
    }
    setResidentSaving(true);
    try {
      const payload = {
        first_name: newResident.first_name,
        last_name: newResident.last_name,
        dob: newResident.dob,
        sex: newResident.sex || null,
        external_id: newResident.external_id || null,
        notes: newResident.notes || null,
        building: newResident.building || null,
        floor: newResident.floor || null,
        unit: newResident.unit || null,
        room: newResident.room || null,
        unit_id: newResident.unit_id || null,
      };
      const created = await apiRequest("/residents", {
        method: "POST",
        token,
        body: payload,
      });
      setResidents((prev) => [created, ...prev]);
      setSelectedResidentId(created.id);
      setNewResident({
        first_name: "",
        last_name: "",
        dob: "",
        sex: "",
        external_id: "",
        notes: "",
        building: "",
        floor: "",
        unit: "",
        room: "",
        unit_id: "",
      });
      setResidentFieldErrors({});
      setResidentSuccess(copy.residentSave);
      setResidentDuplicate(null);
    } catch (error) {
      handleApiError(error, setResidentError);
    } finally {
      setResidentSaving(false);
    }
  };

  const handleCreateAssessment = async (event) => {
    event.preventDefault();
    if (!selectedResidentId) {
      setAssessmentError(copy.selectResident);
      return;
    }
    setAssessmentError("");
    setAssessmentSuccess("");
    if (!validateAssessment()) {
      return;
    }
    setAssessmentSaving(true);
    try {
      const created = await apiRequest(`/residents/${selectedResidentId}/assessments`, {
        method: "POST",
        token,
        body: {
          assessment_date: newAssessment.assessment_date,
          scheduled_date: newAssessment.scheduled_date || null,
          due_date: newAssessment.due_date || null,
          assistive_device: newAssessment.assistive_device || null,
        },
      });
      setAssessments((prev) => [created, ...prev]);
      setSelectedAssessmentId(created.id);
      setNewAssessment((prev) => ({
        assessment_date: prev.assessment_date || formatDate(new Date()),
        scheduled_date: prev.scheduled_date || formatDate(new Date()),
        due_date: prev.due_date || formatDate(new Date()),
        assistive_device: "",
      }));
      setAssessmentFieldErrors({});
      setAssessmentSuccess(copy.assessmentCreated);
    } catch (error) {
      handleApiError(error, setAssessmentError);
    } finally {
      setAssessmentSaving(false);
    }
  };

  const handleCreateFallEvent = async (event) => {
    event.preventDefault();
    if (!selectedResidentId) {
      setFallEventError(copy.incidentSelectResident);
      return;
    }
    if (!fallEventForm.occurred_at) {
      setFallEventError(copy.incidentOccurredAt);
      return;
    }
    setFallEventError("");
    setFallEventNotice("");
    setFallEventSaving(true);
    try {
      const factors = fallEventForm.contributing_factors
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const payload = {
        occurred_at: fallEventForm.occurred_at,
        building: fallEventForm.building || null,
        floor: fallEventForm.floor || null,
        unit: fallEventForm.unit || null,
        room: fallEventForm.room || null,
        injury_severity: fallEventForm.injury_severity || "none",
        ems_called: Boolean(fallEventForm.ems_called),
        hospital_transfer: Boolean(fallEventForm.hospital_transfer),
        witness: fallEventForm.witness || null,
        assistive_device: fallEventForm.assistive_device || null,
        contributing_factors: factors.length ? factors : [],
        notes: fallEventForm.notes || null,
      };
      const created = await apiRequest(`/residents/${selectedResidentId}/fall-events`, {
        method: "POST",
        token,
        body: payload,
      });
      setFallEvents((prev) => [created, ...prev]);
      setSelectedFallEventId(created.id);
      setFallEventNotice(copy.incidentSaved);
      setFallEventForm(buildFallEventForm(selectedResident));
    } catch (error) {
      handleApiError(error, setFallEventError);
    } finally {
      setFallEventSaving(false);
    }
  };

  const handleToggleFallCheck = async (checkType) => {
    if (!token || !selectedFallEventId || !checkType) {
      return;
    }
    const existing = fallEventChecks[checkType];
    const nextCompleted = existing?.status !== "completed";
    setFallEventChecksBusy((prev) => ({ ...prev, [checkType]: true }));
    try {
      const updated = await apiRequest(`/fall-events/${selectedFallEventId}/checks`, {
        method: "POST",
        token,
        body: {
          check_type: checkType,
          completed: nextCompleted,
        },
      });
      setFallEventChecks((prev) => {
        const next = { ...prev, [checkType]: updated };
        const completedCount = fallChecklistItems.filter((item) => next[item]?.status === "completed").length;
        setFallEvents((events) => events.map((event) => (
          event.id === selectedFallEventId
            ? {
                ...event,
                fall_checks_completed: completedCount,
                fall_checks_required: event.fall_checks_required ?? fallChecklistItems.length,
              }
            : event
        )));
        return next;
      });
    } catch (error) {
      handleApiError(error, setFallEventError);
    } finally {
      setFallEventChecksBusy((prev) => ({ ...prev, [checkType]: false }));
    }
  };

  const handleUpdateSchedule = async (event) => {
    event.preventDefault();
    if (!selectedAssessmentId) {
      return;
    }
    setScheduleNotice("");
    if (!validateScheduleForm()) {
      return;
    }
    setScheduleSaving(true);
    try {
      const payload = {
        scheduled_date: scheduleForm.scheduled_date,
        due_date: scheduleForm.due_date || scheduleForm.scheduled_date,
      };
      const updated = await apiRequest(`/assessments/${selectedAssessmentId}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setAssessments((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setAssessmentDetails((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
      setScheduleNotice(copy.assessmentScheduleSaved);
    } catch (error) {
      handleApiError(error, setScheduleNotice);
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleSavePtDetails = async (event) => {
    event.preventDefault();
    if (!selectedAssessmentId) {
      setPtError(copy.selectAssessment);
      return;
    }
    setPtSaving(true);
    setPtError("");
    setPtNotice("");
    const painScore = parseNumber(ptForm.pt_pain_score);
    if (painScore !== null && (!Number.isInteger(painScore) || painScore < 0 || painScore > 10)) {
      setPtError(copy.ptFieldPainInvalid);
      setPtSaving(false);
      return;
    }
    const sessionMinutes = parseNumber(ptForm.pt_session_minutes);
    if (sessionMinutes !== null && (!Number.isInteger(sessionMinutes) || sessionMinutes < 0 || sessionMinutes > 240)) {
      setPtError(copy.ptFieldMinutesInvalid);
      setPtSaving(false);
      return;
    }
    const timeSavedMinutes = parseNumber(ptForm.pt_time_saved_minutes);
    if (timeSavedMinutes !== null && (!Number.isInteger(timeSavedMinutes) || timeSavedMinutes < 0 || timeSavedMinutes > 240)) {
      setPtError(copy.ptFieldMinutesInvalid);
      setPtSaving(false);
      return;
    }
    try {
      const payload = {
        pt_cpt_codes: ptForm.pt_cpt_codes.trim() || null,
        pt_goals: ptForm.pt_goals.trim() || null,
        pt_plan_of_care: ptForm.pt_plan_of_care.trim() || null,
        pt_pain_score: painScore,
        pt_session_minutes: sessionMinutes,
        pt_time_saved_minutes: timeSavedMinutes,
      };
      await apiRequest(`/assessments/${selectedAssessmentId}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setPtNotice(copy.ptSaveSuccess);
      loadAssessmentDetails(selectedAssessmentId);
    } catch (error) {
      handleApiError(error, setPtError);
    } finally {
      setPtSaving(false);
    }
  };

  const handleApplyPtTimer = () => {
    const minutes = Math.round(ptElapsedSeconds / 60);
    if (!Number.isFinite(minutes)) {
      return;
    }
    const suggestedSaved = Math.max(0, 30 - minutes);
    setPtForm((prev) => ({
      ...prev,
      pt_session_minutes: String(minutes),
      pt_time_saved_minutes: prev.pt_time_saved_minutes || String(suggestedSaved),
    }));
  };

  const handleDownloadPtSummary = async () => {
    if (!token || !selectedAssessmentId) {
      setPtError(copy.selectAssessment);
      return;
    }
    if (!ptChecklistComplete) {
      setPtError(copy.ptSummaryBlocked);
      return;
    }
    setPtError("");
    try {
      await downloadProtected(`/assessments/${selectedAssessmentId}/pt-summary`, token, "pt_summary.pdf");
    } catch (error) {
      handleApiError(error, setPtError);
    }
  };

  const handleUpdateResident = async (event) => {
    event.preventDefault();
    if (!selectedResidentId) {
      return;
    }
    setResidentEditNotice("");
    if (!validateResidentEdit()) {
      return;
    }
    setResidentEditSaving(true);
    try {
      const payload = {
        first_name: residentEditForm.first_name.trim(),
        last_name: residentEditForm.last_name.trim(),
        dob: residentEditForm.dob || null,
        sex: residentEditForm.sex || null,
        external_id: residentEditForm.external_id.trim() || null,
        notes: residentEditForm.notes.trim() || null,
        building: residentEditForm.building.trim() || null,
        floor: residentEditForm.floor.trim() || null,
        unit: residentEditForm.unit.trim() || null,
        room: residentEditForm.room.trim() || null,
        unit_id: residentEditForm.unit_id || null,
      };
      const updated = await apiRequest(`/residents/${selectedResidentId}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setResidents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setResidentEditNotice(copy.residentEditSaved);
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
        setResidentEditNotice(copy.sessionExpired);
      } else {
        setResidentEditNotice(error?.message || copy.residentEditError);
      }
    } finally {
      setResidentEditSaving(false);
    }
  };

  const handleResetResidentEdit = () => {
    if (!selectedResident) {
      return;
    }
    setResidentEditForm({
      first_name: selectedResident.first_name || "",
      last_name: selectedResident.last_name || "",
      dob: formatDate(selectedResident.dob),
      sex: selectedResident.sex || "",
      external_id: selectedResident.external_id || "",
      notes: selectedResident.notes || "",
      building: selectedResident.building || "",
      floor: selectedResident.floor || "",
      unit: selectedResident.unit || "",
      room: selectedResident.room || "",
      unit_id: selectedResident.unit_id || "",
    });
    setResidentEditErrors({});
    setResidentEditNotice("");
  };

  const handleCreateUser = async (event) => {
    event.preventDefault();
    if (user?.role !== "admin") {
      setUserError(copy.auditNotAllowed);
      return;
    }
    setUserError("");
    setUserSuccess("");
    if (!validateUserCreate()) {
      return;
    }
    setUserCreateSaving(true);
    try {
      const payload = {
        facility_id: user.facility_id,
        email: userCreateForm.email.trim(),
        full_name: userCreateForm.full_name.trim(),
        role: userCreateForm.role,
        status: userCreateForm.status,
        password: userCreateForm.password,
      };
      const created = await apiRequest("/users", {
        method: "POST",
        token,
        body: payload,
      });
      setUsers((prev) => [created, ...prev]);
      setUserCreateForm({
        email: "",
        full_name: "",
        role: "clinician",
        status: "active",
        password: "",
      });
      setUserCreateErrors({});
      setUserSuccess(copy.userCreated);
    } catch (error) {
      setUserError(error?.message || copy.genericError);
    } finally {
      setUserCreateSaving(false);
    }
  };

  const handleUpdateUser = async (event) => {
    event.preventDefault();
    if (!selectedUserId) {
      return;
    }
    setUserEditNotice("");
    if (!validateUserEdit()) {
      return;
    }
    setUserEditSaving(true);
    try {
      const payload = {
        full_name: userEditForm.full_name.trim(),
        role: userEditForm.role,
        status: userEditForm.status,
      };
      if (userEditForm.password.trim()) {
        payload.password = userEditForm.password.trim();
      }
      const updated = await apiRequest(`/users/${selectedUserId}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setUserEditNotice(copy.userUpdated);
      setUserEditForm((prev) => ({ ...prev, password: "" }));
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
        setUserEditNotice(copy.sessionExpired);
      } else {
        setUserEditNotice(error?.message || copy.genericError);
      }
    } finally {
      setUserEditSaving(false);
    }
  };

  const handleCreateFacility = async (event) => {
    event.preventDefault();
    if (user?.role !== "admin") {
      setFacilityError(copy.auditNotAllowed);
      return;
    }
    setFacilityError("");
    setFacilitySuccess("");
    if (!validateFacilityCreate()) {
      return;
    }
    setFacilityCreateSaving(true);
    try {
      const payload = {
        name: facilityCreateForm.name.trim(),
        address_line1: facilityCreateForm.address_line1.trim() || null,
        address_line2: facilityCreateForm.address_line2.trim() || null,
        city: facilityCreateForm.city.trim() || null,
        state: facilityCreateForm.state.trim() || null,
        zip: facilityCreateForm.zip.trim() || null,
        reassessment_cadence_days: parseNumber(facilityCreateForm.reassessment_cadence_days),
        report_turnaround_hours: parseNumber(facilityCreateForm.report_turnaround_hours),
        assessment_protocol: facilityCreateForm.assessment_protocol,
        capture_method: facilityCreateForm.capture_method,
        role_policy: facilityCreateForm.role_policy,
        qa_checklist: parseChecklistText(facilityCreateForm.qa_checklist),
        fall_checklist: parseChecklistText(facilityCreateForm.fall_checklist),
      };
      const created = await apiRequest("/facilities", {
        method: "POST",
        token,
        body: payload,
      });
      setFacilities((prev) => [created, ...prev]);
      setFacilityCreateForm({
        name: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        zip: "",
        reassessment_cadence_days: "90",
        report_turnaround_hours: "24",
        assessment_protocol: "tug_chair_balance",
        capture_method: "record_upload",
        role_policy: "clinician_admin_only",
        qa_checklist: "",
        fall_checklist: "",
      });
      setFacilityCreateErrors({});
      setFacilitySuccess(copy.facilityCreated);
    } catch (error) {
      setFacilityError(error?.message || copy.genericError);
    } finally {
      setFacilityCreateSaving(false);
    }
  };

  const handleUpdateFacility = async (event) => {
    event.preventDefault();
    if (!selectedFacilityId) {
      return;
    }
    setFacilityEditNotice("");
    if (!validateFacilityEdit()) {
      return;
    }
    setFacilityEditSaving(true);
    try {
      const payload = {
        name: facilityEditForm.name.trim(),
        address_line1: facilityEditForm.address_line1.trim() || null,
        address_line2: facilityEditForm.address_line2.trim() || null,
        city: facilityEditForm.city.trim() || null,
        state: facilityEditForm.state.trim() || null,
        zip: facilityEditForm.zip.trim() || null,
        reassessment_cadence_days: parseNumber(facilityEditForm.reassessment_cadence_days),
        report_turnaround_hours: parseNumber(facilityEditForm.report_turnaround_hours),
        assessment_protocol: facilityEditForm.assessment_protocol,
        capture_method: facilityEditForm.capture_method,
        role_policy: facilityEditForm.role_policy,
        qa_checklist: parseChecklistText(facilityEditForm.qa_checklist),
        fall_checklist: parseChecklistText(facilityEditForm.fall_checklist),
      };
      const updated = await apiRequest(`/facilities/${selectedFacilityId}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setFacilities((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      if (updated.id === user?.facility_id) {
        setFacilityProfile(updated);
      }
      setFacilityEditNotice(copy.facilityUpdated);
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
        setFacilityEditNotice(copy.sessionExpired);
      } else {
        setFacilityEditNotice(error?.message || copy.genericError);
      }
    } finally {
      setFacilityEditSaving(false);
    }
  };

  const handleSaveOnboardingFacility = async () => {
    if (!token || user?.role !== "admin" || !user?.facility_id) {
      return;
    }
    setOnboardingFacilityNotice("");
    setOnboardingFacilitySaving(true);
    try {
      const payload = {
        assessment_protocol: onboardingFacilityForm.assessment_protocol,
        capture_method: onboardingFacilityForm.capture_method,
        role_policy: onboardingFacilityForm.role_policy,
      };
      const updated = await apiRequest(`/facilities/${user.facility_id}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setFacilityProfile(updated);
      setFacilities((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setOnboardingFacilityNotice(copy.facilityUpdated);
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
        setOnboardingFacilityNotice(copy.sessionExpired);
      } else {
        setOnboardingFacilityNotice(error?.message || copy.genericError);
      }
    } finally {
      setOnboardingFacilitySaving(false);
    }
  };

  const handleUploadVideo = async (event) => {
    event.preventDefault();
    let assessmentId = selectedAssessmentId;
    if (!assessmentId) {
      if (!selectedResidentId) {
        setUploadStatus({ busy: false, error: copy.selectResident, success: "", progress: 0 });
        return;
      }
      try {
        const today = formatDate(new Date());
        const created = await apiRequest(`/residents/${selectedResidentId}/assessments`, {
          method: "POST",
          token,
          body: {
            assessment_date: today,
            scheduled_date: today,
            due_date: today,
            assistive_device: null,
          },
        });
        assessmentId = created.id;
        setAssessments((prev) => [created, ...prev]);
        setSelectedAssessmentId(created.id);
      } catch (error) {
        setUploadStatus({ busy: false, error: error?.message || copy.genericError, success: "", progress: 0 });
        return;
      }
    }
    setUploadStatus({ busy: false, error: "", success: "", progress: 0 });
    const fieldErrors = {};
    if (!uploadFile) {
      fieldErrors.file = copy.uploadRequired;
    } else {
      if (!ALLOWED_VIDEO_TYPES.has(uploadFile.type)) {
        fieldErrors.file = copy.uploadTypeError;
      }
      if (uploadFile.size > MAX_VIDEO_SIZE_BYTES) {
        fieldErrors.file = copy.uploadSizeError;
      }
    }
    const metaValid = validateUploadMeta();
    setUploadFieldErrors((prev) => ({ ...prev, ...fieldErrors }));
    if (Object.keys(fieldErrors).length > 0 || !metaValid) {
      return;
    }

    setUploadStatus({ busy: true, error: "", success: "", progress: 0 });
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      if (uploadMeta.duration_seconds) {
        formData.append("duration_seconds", uploadMeta.duration_seconds);
      }
      if (uploadMeta.width) {
        formData.append("width", uploadMeta.width);
      }
      if (uploadMeta.height) {
        formData.append("height", uploadMeta.height);
      }
      await uploadWithProgress(`/assessments/${assessmentId}/videos/upload`, token, formData, (progress) => {
        setUploadStatus((prev) => ({ ...prev, progress }));
      });
      setUploadStatus({ busy: false, error: "", success: copy.uploadSuccess, progress: 100 });
      setUploadFile(null);
      setUploadMeta({ duration_seconds: "", width: "", height: "" });
      setUploadFieldErrors({});
      if (selectedResidentId) {
        const refreshedAssessments = await apiRequest(`/residents/${selectedResidentId}/assessments`, { token });
        setAssessments(refreshedAssessments);
        const latestWithVideo = pickMostRecentAssessmentWithVideo(refreshedAssessments);
        const nextAssessmentId = latestWithVideo?.id || assessmentId;
        setSelectedAssessmentId(nextAssessmentId);
        loadAssessmentDetails(nextAssessmentId);
      } else {
        loadAssessmentDetails(assessmentId);
      }
    } catch (error) {
      setUploadStatus({ busy: false, error: error?.message || copy.genericError, success: "", progress: 0 });
      if (error?.status === 401) {
        setToken("");
        setUser(null);
      }
    }
  };

  const handleSaveScores = async (event) => {
    event.preventDefault();
    if (!selectedAssessmentId) {
      setScoreNotice(copy.selectAssessment);
      return;
    }
    if (!validateScores()) {
      setScoreNotice(copy.scoreInvalid);
      return;
    }
    setScoreSaving(true);
    setScoreNotice("");
    try {
      const scoresPayload = {
        tug_seconds: showTugField ? parseNumber(scoreForm.tug_seconds) : null,
        chair_stand_seconds: showChairField ? parseNumber(scoreForm.chair_stand_seconds) : null,
        balance_side_by_side: showBalanceFields ? Boolean(scoreForm.balance_side_by_side) : null,
        balance_semi_tandem: showBalanceFields ? Boolean(scoreForm.balance_semi_tandem) : null,
        balance_tandem: showBalanceFields ? Boolean(scoreForm.balance_tandem) : null,
        score_notes: scoreForm.score_notes || null,
      };
      const payload = {
        status: scoreForm.status || assessmentDetails?.status || "in_review",
        risk_tier: scoreForm.risk_tier || null,
        clinician_notes: scoreForm.clinician_notes || null,
        scores: scoresPayload,
      };
      await apiRequest(`/assessments/${selectedAssessmentId}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      setScoreNotice(copy.scoreSuccess);
      setScoreFieldErrors({});
      loadAssessmentDetails(selectedAssessmentId);
    } catch (error) {
      handleApiError(error, setScoreNotice);
    } finally {
      setScoreSaving(false);
    }
  };

  const handleSyncModelScores = async () => {
    if (!selectedAssessmentId) {
      setScoreNotice(copy.selectAssessment);
      return;
    }
    if (!token) {
      return;
    }
    setSyncScoresBusy(true);
    setScoreNotice("");
    try {
      const data = await apiRequest(`/assessments/${selectedAssessmentId}`, { token });
      setAssessmentDetails(data);
      if (data?.scores) {
        setScoreNotice(copy.syncModelScoresDone);
      } else if (data?.model_run?.status === "completed") {
        setScoreNotice(copy.syncModelScoresNone);
      } else {
        setScoreNotice(copy.syncModelScoresPending);
      }
    } catch (error) {
      setScoreNotice(error?.message || copy.syncModelScoresError);
      if (error?.status === 401) {
        setToken("");
        setUser(null);
      }
    } finally {
      setSyncScoresBusy(false);
    }
  };

  const handleRunModel = async () => {
    if (!selectedAssessmentId) {
      setScoreNotice(copy.selectAssessment);
      return;
    }
    if (!selectedAssessmentHasVideo) {
      setScoreNotice(copy.runModelNoVideo);
      return;
    }
    if (!token) {
      return;
    }
    setRunModelBusy(true);
    setScoreNotice("");
    try {
      await apiRequest(`/assessments/${selectedAssessmentId}/model/run`, {
        method: "POST",
        token,
      });
      setScoreNotice(copy.runModelQueued);
      loadAssessmentDetails(selectedAssessmentId);
    } catch (error) {
      if (error?.status === 409) {
        setScoreNotice(copy.runModelConflict);
      } else {
        setScoreNotice(error?.message || copy.genericError);
      }
      if (error?.status === 401) {
        setToken("");
        setUser(null);
      }
    } finally {
      setRunModelBusy(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedAssessmentId) {
      setReportError(copy.selectAssessment);
      return;
    }
    setReportBusy(true);
    setReportError("");
    try {
      const report = await apiRequest(`/assessments/${selectedAssessmentId}/reports`, {
        method: "POST",
        token,
      });
      setAssessmentDetails((prev) => (prev ? { ...prev, report } : prev));
    } catch (error) {
      handleApiError(error, setReportError);
    } finally {
      setReportBusy(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!assessmentDetails?.report?.id) {
      return;
    }
    try {
      await downloadProtected(`/reports/${assessmentDetails.report.id}/download`, token, "stride_report.pdf");
    } catch (error) {
      handleApiError(error, setReportError);
    }
  };

  const handleExportResidents = async () => {
    if (!token) {
      return;
    }
    try {
      await downloadProtected("/exports/residents", token, "residents.csv");
    } catch (error) {
      handleApiError(error, setResidentError);
    }
  };

  const handleExportAssessments = async () => {
    if (!token) {
      return;
    }
    if (!selectedResidentId) {
      setAssessmentError(copy.selectResident);
      return;
    }
    const query = buildQueryString({
      resident_id: selectedResidentId,
      status: timelineFilters.status,
      risk_tier: timelineFilters.risk,
      from: timelineFilters.from,
      to: timelineFilters.to,
    });
    try {
      await downloadProtected(`/exports/assessments${query}`, token, "assessments.csv");
    } catch (error) {
      handleApiError(error, setAssessmentError);
    }
  };

  const handleDownloadVideo = async (videoId) => {
    if (!videoId) {
      return;
    }
    try {
      await downloadProtected(`/videos/${videoId}/download`, token, "stride_video.mp4");
    } catch (error) {
      if (error?.status === 401) {
        setToken("");
        setUser(null);
      }
      setUploadStatus((prev) => ({
        ...prev,
        error: error?.message || copy.genericError,
        success: "",
      }));
    }
  };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      {!token ? (
        <section className="hero portal-hero">
          <div className="hero-glow" />
          <div className="container hero-grid">
            <div className="hero-content">
              <div className="app-badge">
                <span className="app-badge-icon"><AppMark /></span>
                <span>{copy.badge}</span>
              </div>
              <p className="eyebrow">{copy.eyebrow}</p>
              <h1>{copy.heading}</h1>
              <p className="lead">{copy.lead}</p>
              <div className="grid features-grid">
                {steps.map((step) => (
                  <div key={step.title} className="feature-card">
                    <Icon name={step.icon} />
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="hero-media">
              <div className="portal-access-card">
                <div className="portal-access-header">
                  <span className="portal-access-badge">
                    <Icon name="shield" />
                    {copy.accessBadge}
                  </span>
                  <div>
                    <h3>{copy.accessTitle}</h3>
                    <p className="text-muted">{copy.accessBody}</p>
                  </div>
                </div>
                <div className="portal-access-grid">
                  <div className="portal-access-main">
                    <form className="portal-form" onSubmit={handleLogin}>
                      <div className="portal-field">
                        <label htmlFor="portal-email">{copy.emailLabel}</label>
                        <input
                          id="portal-email"
                          type="email"
                          autoComplete="username"
                          value={loginForm.email}
                          onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                          required
                        />
                      </div>
                      <div className="portal-field">
                        <label htmlFor="portal-password">{copy.passwordLabel}</label>
                        <input
                          id="portal-password"
                          type="password"
                          autoComplete="current-password"
                          value={loginForm.password}
                          onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                          required
                        />
                      </div>
                      {loginError ? <div className="portal-message portal-error">{loginError}</div> : null}
                      <button className="button primary" type="submit" disabled={loginBusy}>
                        {loginBusy ? copy.loginBusy : copy.loginButton}
                      </button>
                    </form>
                  </div>
                  <aside className="portal-access-side">
                    <div className="portal-security-card">
                      <div className="portal-security-header">
                        <Icon name="badge" />
                        <div>
                          <h4>{copy.accessSecurityTitle}</h4>
                          <p className="text-muted">{copy.accessSecurityBody}</p>
                        </div>
                      </div>
                      <ul className="portal-security-list">
                        {copy.accessSecurityBullets.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      <div className="portal-security-chips">
                        {copy.accessSecurityChips.map((chip) => (
                          <span key={chip} className="portal-chip">{chip}</span>
                        ))}
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="container">
          {!token ? (
            <div className="portal-card portal-locked">
              <h3>{copy.overviewTitle}</h3>
              <p className="text-muted">{copy.accessBody}</p>
            </div>
          ) : (
            <div className="portal-dashboard">
              <aside className="portal-sidebar">
                <nav className="portal-nav" aria-label="Portal sections">
                  {availableNavItems.map((item) => (
                    <button
                      key={item.id}
                      className={`portal-nav-item ${activePanel === item.id ? "active" : ""}`}
                      type="button"
                      onClick={() => handlePanelChange(item.id)}
                    >
                      <Icon name={item.icon} />
                      {item.label}
                      {item.id === "notifications" && notificationUnreadCount > 0 ? (
                        <span className="portal-nav-badge">{notificationUnreadCount}</span>
                      ) : null}
                    </button>
                  ))}
                </nav>
                <button className="portal-nav-item portal-nav-logout" type="button" onClick={handleLogout}>
                  <Icon name="shield" />
                  {copy.logout}
                </button>
              </aside>

              <div className="portal-content">
                <div className="portal-topbar">
                  <div>
                    <span className="portal-meta">{copy.topbarWelcome}</span>
                    <h2>{user?.full_name || user?.email}</h2>
                    <p className="text-muted portal-topbar-subline">
                      {copy.roleLabel}: {roleDisplayName} · {copy.facilityLabel}: {facilityDisplayName}
                    </p>
                  </div>
                  <div className="portal-topbar-meta">
                    <div className="portal-topbar-card">
                      <span className="portal-meta">{copy.roleLabel}</span>
                      <strong>{roleDisplayName}</strong>
                    </div>
                    <div className="portal-topbar-card">
                      <span className="portal-meta">{copy.facilityLabel}</span>
                      <strong>{facilityDisplayName}</strong>
                    </div>
                  </div>
                </div>
                {activePanel === "overview" ? (
                  <div className="portal-panel">
                    <div className="portal-panel-header">
                      <div>
                        <h3>{copy.overviewTitle}</h3>
                        <p className="text-muted">{copy.overviewBody}</p>
                      </div>
                    </div>
                    {!onboardingState.completed ? (
                      <div className="portal-card portal-onboarding-card">
                        <div className="portal-card-header">
                          <div>
                            <h3>{copy.onboardingTitle}</h3>
                            <p className="text-muted">{copy.onboardingBody}</p>
                          </div>
                          <button className="button ghost small" type="button" onClick={handleOnboardingOpen}>
                            {copy.onboardingResume}
                          </button>
                        </div>
                        <div className="portal-onboarding-progress">
                          <div className="portal-onboarding-progress-meta">
                            <span className="portal-meta">{copy.onboardingProgressLabel}</span>
                            <strong>{onboardingCompletedSteps}/{onboardingTotalSteps}</strong>
                          </div>
                          <div className="portal-progress-track">
                            <div
                              className="portal-progress-bar"
                              style={{ width: `${Math.round(onboardingProgress * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="portal-onboarding-list">
                          {onboardingSteps.map((step, index) => {
                            const isAdminOnly = step.adminOnly && user?.role !== "admin";
                            const isDone = isOnboardingStepComplete(step);
                            return (
                              <div key={step.id} className={`portal-onboarding-item ${isDone ? "is-done" : ""}`}>
                                <div>
                                  <span className="portal-meta">{copy.onboardingStepLabel} {index + 1}</span>
                                  <strong>{step.title}</strong>
                                </div>
                                {isAdminOnly ? (
                                  <span className="status-pill status-review">{copy.onboardingAdminOnly}</span>
                                ) : (
                                  <span className={`status-pill ${isDone ? "status-review" : "status-open"}`}>
                                    {isDone ? copy.onboardingStatusDone : copy.onboardingStatusPending}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="portal-card portal-analytics-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.analyticsTitle}</h3>
                          <p className="text-muted">{copy.analyticsBody}</p>
                        </div>
                        <div className="portal-analytics-controls">
                          <label className="portal-filter-field">
                            <span>{copy.analyticsWindowLabel}</span>
                            <select
                              value={analyticsDays}
                              onChange={(event) => setAnalyticsDays(Number(event.target.value))}
                            >
                              {[7, 14, 30, 60, 90].map((value) => (
                                <option key={value} value={value}>{value}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={loadAnalytics}
                            disabled={analyticsLoading}
                          >
                            {copy.analyticsLoad}
                          </button>
                        </div>
                      </div>
                      {analyticsLoading ? (
                        <div className="portal-message">{copy.loading}</div>
                      ) : analyticsError ? (
                        <div className="portal-message portal-error">{analyticsError}</div>
                      ) : (
                        <>
                          <div className="portal-stat-grid">
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsAssessments}</span>
                              <strong>{analyticsAssessments}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsAvgTime}</span>
                              <strong>{Number(analyticsAvgMinutes).toFixed(1)}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsReassessment}</span>
                              <strong>{formatPercent(analyticsReassessment)}</strong>
                            </div>
                          </div>
                          <div className="portal-stat-grid portal-stat-grid-secondary">
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsTotal}</span>
                              <strong>{analyticsTotal}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsCompleted}</span>
                              <strong>{analyticsCompleted}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsCompletionRate}</span>
                              <strong>{formatPercent(analyticsCompletionRate)}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsDueToday}</span>
                              <strong>{analyticsDueToday}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsOverdue}</span>
                              <strong>{analyticsOverdue}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsHighRiskRate}</span>
                              <strong>{formatPercent(analyticsHighRiskRate)}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsVideoCoverage}</span>
                              <strong>{formatPercent(analyticsVideoCoverage)}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsReportCoverage}</span>
                              <strong>{formatPercent(analyticsReportCoverage)}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsTimeToReport}</span>
                              <strong>{Number(analyticsAvgReportMinutes).toFixed(1)}</strong>
                            </div>
                          </div>
                          <div className="portal-analytics-footnote">
                            <span>{copy.analyticsVideos}: <strong>{analyticsVideos}</strong></span>
                            <span>{copy.analyticsReports}: <strong>{analyticsReports}</strong></span>
                          </div>
                          {analyticsUpdated ? (
                            <span className="portal-meta portal-analytics-updated">
                              {copy.analyticsUpdated}: {formatDateTime(analyticsUpdated)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.analyticsPostFallTitle}</h3>
                          <p className="text-muted">{copy.analyticsPostFallBody}</p>
                        </div>
                        <div className="portal-analytics-controls">
                          <label className="portal-filter-field">
                            <span>{copy.analyticsPostFallFilterLabel}</span>
                            <select
                              value={postFallRollupFilter}
                              onChange={(event) => setPostFallRollupFilter(event.target.value)}
                              disabled={postFallRollupLoading}
                            >
                              {postFallRollupFilterOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={() => {
                              const headers = [
                                copy.workflowUnitLabel,
                                copy.analyticsPostFallIncidents,
                                copy.analyticsPostFallCompletion,
                                copy.analyticsPostFallOpen,
                                copy.analyticsPostFallOverdue,
                              ];
                              const rows = postFallRollupFiltered.map((item) => ([
                                item.unitLabel,
                                item.total,
                                `${Math.round(item.completion * 100)}%`,
                                item.open,
                                item.overdue,
                              ]));
                              downloadCsv("post_fall_rollup.csv", headers, rows);
                            }}
                            disabled={postFallRollupFiltered.length === 0}
                          >
                            {copy.analyticsPostFallExport}
                          </button>
                        </div>
                      </div>
                      {analyticsLoading ? (
                        <div className="portal-message">{copy.loading}</div>
                      ) : analyticsError ? (
                        <div className="portal-message portal-error">{analyticsError}</div>
                      ) : (
                        <>
                          <div className="portal-stat-grid portal-stat-grid-secondary">
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsPostFallIncidents}</span>
                              <strong>{analyticsPostFallTotal}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsPostFallCompletion}</span>
                              <strong>{formatPercent(analyticsPostFallCompletion)}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsPostFallOpen}</span>
                              <strong>{analyticsPostFallOpen}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsPostFallOverdue}</span>
                              <strong>{analyticsPostFallOverdue}</strong>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.analyticsPostFallSla}</span>
                              <strong>
                                {Number.isFinite(analyticsPostFallFollowupDays) ? analyticsPostFallFollowupDays : "--"}
                              </strong>
                            </div>
                          </div>
                          {postFallRollupLoading ? (
                            <div className="portal-message">{copy.loading}</div>
                          ) : postFallRollupError ? (
                            <div className="portal-message portal-error">{postFallRollupError}</div>
                          ) : postFallRollupFiltered.length === 0 ? (
                            <div className="portal-message">{copy.analyticsPostFallRollupEmpty}</div>
                          ) : (
                            <div className="portal-user-rows">
                              {postFallRollupFiltered.map((item) => {
                                const badge = item.overdue > 0
                                  ? { label: copy.postFallBadgeOverdue, className: "sla-pill sla-overdue" }
                                  : item.open > 0
                                    ? { label: copy.postFallBadgeOpen, className: "sla-pill sla-warning" }
                                    : { label: copy.postFallBadgeOnTrack, className: "sla-pill sla-ontrack" };
                                return (
                                  <div key={item.key} className="portal-user-row">
                                    <div>
                                      <strong>{item.unitLabel}</strong>
                                      <span>
                                        {copy.analyticsPostFallIncidents}: {item.total} •{" "}
                                        {copy.analyticsPostFallCompletion}: {formatPercent(item.completion)} •{" "}
                                        {copy.analyticsPostFallOpen}: {item.open} •{" "}
                                        {copy.analyticsPostFallOverdue}: {item.overdue}
                                      </span>
                                    </div>
                                    <span className={badge.className}>{badge.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="portal-stat-grid">
                      <div className="portal-stat-card">
                        <span className="portal-meta">{copy.overviewResidents}</span>
                        <strong>{residents.length}</strong>
                      </div>
                      <div className="portal-stat-card">
                        <span className="portal-meta">{copy.overviewAssessments}</span>
                        <strong>{assessments.length}</strong>
                      </div>
                      <div className="portal-stat-card">
                        <span className="portal-meta">{copy.overviewLastAssessment}</span>
                        <strong>{lastAssessmentDate}</strong>
                      </div>
                      <div className="portal-stat-card">
                        <span className="portal-meta">{copy.overviewReport}</span>
                        <strong>{assessmentDetails?.report ? copy.overviewReportReady : copy.overviewReportEmpty}</strong>
                      </div>
                    </div>
                    <div className="portal-panel-actions">
                      <span className="portal-meta">{copy.overviewActions}</span>
                      <div className="portal-action-row">
                        <button className="button ghost" type="button" onClick={() => handlePanelChange("residents")}>
                          {copy.navResidents}
                        </button>
                        <button className="button ghost" type="button" onClick={() => handlePanelChange("uploads")}>
                          {copy.navUploads}
                        </button>
                        <button className="button ghost" type="button" onClick={() => handlePanelChange("reports")}>
                          {copy.navReports}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "notifications" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.notificationsTitle}</h3>
                          <p className="text-muted">{copy.notificationsBody}</p>
                        </div>
                        <div className="portal-card-actions">
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={() => {
                              if (skipNotificationConfirm) {
                                markAllNotificationsRead();
                              } else {
                                setConfirmMarkAllOpen(true);
                              }
                            }}
                            disabled={
                              !token
                              || notificationLoading
                              || notificationFilter === "read"
                              || notificationUnreadCount === 0
                            }
                          >
                            {copy.notificationsMarkAll}
                          </button>
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={() => loadNotifications()}
                            disabled={!token || notificationLoading}
                          >
                            {copy.notificationsLoad}
                          </button>
                        </div>
                      </div>
                      <div className="portal-section-grid portal-section-grid-reverse">
                        <div className="portal-section-col">
                            <div className="portal-section-card">
                              <div className="portal-filter-row">
                                <div className="portal-filter">
                                  <label>{copy.notificationsFilterLabel}</label>
                                  <select
                                    value={notificationFilter}
                                    onChange={(event) => setNotificationFilter(event.target.value)}
                                    disabled={!token}
                                  >
                                    <option value="all">{copy.filterAll}</option>
                                    <option value="unread">{copy.notificationsFilterUnread}</option>
                                    <option value="read">{copy.notificationsFilterRead}</option>
                                  </select>
                                </div>
                                <div className="portal-filter">
                                  <label>{copy.notificationsDeliveryLabel}</label>
                                  <select
                                    value={notificationDeliveryFilter}
                                    onChange={(event) => setNotificationDeliveryFilter(event.target.value)}
                                    disabled={!token}
                                  >
                                    <option value="all">{copy.notificationsDeliveryAll}</option>
                                    <option value="sent">{copy.notificationsDeliverySent}</option>
                                    <option value="queued">{copy.notificationsDeliveryQueued}</option>
                                  </select>
                                </div>
                                <div className="portal-filter-summary">
                                  <span className="portal-meta">
                                    {copy.notificationsStatusUnread}: {notificationUnreadCount}
                                  </span>
                                  {emailDeliveryCounts.total > 0 ? (
                                    <>
                                      <span className="portal-meta">
                                        {copy.notificationsDeliverySent}: {emailDeliveryCounts.sent}
                                      </span>
                                      <span className="portal-meta">
                                        {copy.notificationsDeliveryQueued}: {emailDeliveryCounts.queued}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                            </div>
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <div className="portal-notification-list">
                              {notificationLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : notificationError ? (
                                <div className="portal-message portal-error">{notificationError}</div>
                              ) : filteredNotifications.length === 0 ? (
                                <div className="portal-message">{copy.notificationsEmpty}</div>
                              ) : (
                                filteredNotifications.map((item) => (
                                  <div
                                    key={item.id}
                                    className={`portal-notification-row ${item.status === "unread" ? "is-unread" : ""}`}
                                  >
                                    <div>
                                      <strong>{item.title}</strong>
                                      <p>{item.body}</p>
                                      <span className="portal-meta">{formatDateTime(item.created_at)}</span>
                                    </div>
                                    <div className="portal-notification-actions">
                                      {item.channel === "email" ? (
                                        <span
                                          className={`status-pill ${
                                            item.data?.email_delivery === "sent" ? "status-done" : "status-open"
                                          }`}
                                        >
                                          {item.data?.email_delivery === "sent"
                                            ? copy.notificationsEmailSent
                                            : copy.notificationsEmailQueued}
                                        </span>
                                      ) : null}
                                      <span className={`status-pill ${item.status === "unread" ? "status-review" : "status-done"}`}>
                                        {item.status === "unread" ? copy.notificationsStatusUnread : copy.notificationsStatusRead}
                                      </span>
                                      {item.status === "unread" ? (
                                        <button
                                          className="button ghost small"
                                          type="button"
                                          onClick={() => markNotificationRead(item.id)}
                                        >
                                          {copy.notificationsMarkRead}
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {confirmMarkAllOpen ? (
                  <div className="modal-overlay" role="dialog" aria-modal="true">
                    <button
                      className="modal-backdrop"
                      type="button"
                      aria-label={copy.notificationsConfirmCancel}
                      onClick={() => setConfirmMarkAllOpen(false)}
                    />
                    <div className="modal-panel" role="document">
                      <div>
                        <h3>{copy.notificationsConfirmTitle}</h3>
                        <p className="text-muted">
                          {notificationFilter === "unread"
                            ? copy.notificationsConfirmBodyUnread
                            : copy.notificationsConfirmBodyAll}
                        </p>
                      </div>
                      <div className="modal-actions">
                        <label className="portal-toggle">
                          <input
                            type="checkbox"
                            checked={skipNotificationConfirm}
                            onChange={(event) => updateSkipNotificationConfirm(event.target.checked)}
                          />
                          {copy.notificationsConfirmSkip}
                        </label>
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => setConfirmMarkAllOpen(false)}
                        >
                          {copy.notificationsConfirmCancel}
                        </button>
                        <button
                          className="button primary"
                          type="button"
                          onClick={() => {
                            setConfirmMarkAllOpen(false);
                            markAllNotificationsRead();
                          }}
                          disabled={notificationUnreadCount === 0 || notificationLoading}
                        >
                          {copy.notificationsConfirmAction}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "outcomes" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.outcomesTitle}</h3>
                          <p className="text-muted">{copy.outcomesBody}</p>
                        </div>
                        <div className="portal-analytics-controls">
                          <label className="portal-filter-field">
                            <span>{copy.outcomesWindowLabel}</span>
                            <select
                              value={outcomesDays}
                              onChange={(event) => setOutcomesDays(Number(event.target.value))}
                            >
                              {[30, 60, 90, 180, 365].map((value) => (
                                <option key={value} value={value}>{value}</option>
                              ))}
                            </select>
                          </label>
                          <label className="portal-filter-field">
                            <span>{copy.outcomesWeeksLabel}</span>
                            <select
                              value={outcomesWeeks}
                              onChange={(event) => setOutcomesWeeks(Number(event.target.value))}
                            >
                              {[4, 8, 12, 16].map((value) => (
                                <option key={value} value={value}>{value}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={loadOutcomes}
                            disabled={outcomesLoading}
                          >
                            {copy.outcomesLoad}
                          </button>
                        </div>
                      </div>
                      {outcomesLoading ? (
                        <div className="portal-message">{copy.loading}</div>
                      ) : outcomesError ? (
                        <div className="portal-message portal-error">{outcomesError}</div>
                      ) : !outcomesData ? (
                        <div className="portal-message">{copy.outcomesEmpty}</div>
                      ) : (
                        <>
                          <div className="portal-stat-grid">
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.outcomesImproved}</span>
                              <strong>{outcomesImproved}</strong>
                              <span className="portal-meta">{formatPercent(outcomesImprovedRate)}</span>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.outcomesWorsened}</span>
                              <strong>{outcomesWorsened}</strong>
                              <span className="portal-meta">{formatPercent(outcomesWorsenedRate)}</span>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.outcomesStable}</span>
                              <strong>{outcomesStable}</strong>
                              <span className="portal-meta">{formatPercent(outcomesStableRate)}</span>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.outcomesUnknown}</span>
                              <strong>{outcomesUnknown}</strong>
                            </div>
                          </div>
                          <div className="portal-stat-grid portal-stat-grid-secondary">
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.outcomesAssessed}</span>
                              <strong>{outcomesAssessed}</strong>
                              <span className="portal-meta">{formatPercent(outcomesAssessedRate)}</span>
                            </div>
                            <div className="portal-stat-card">
                              <span className="portal-meta">{copy.outcomesTotalResidents}</span>
                              <strong>{outcomesTotalResidents}</strong>
                            </div>
                          </div>
                          {outcomesUpdated ? (
                            <span className="portal-meta portal-analytics-updated">
                              {copy.analyticsUpdated}: {formatDateTime(outcomesUpdated)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>

                    {!outcomesLoading && !outcomesError && outcomesData ? (
                      <div className="portal-section-grid portal-section-grid-equal">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <div className="portal-card-header">
                              <div>
                                <h4>{copy.outcomesTrendTitle}</h4>
                                <p className="text-muted">{copy.outcomesTrendBody}</p>
                              </div>
                            </div>
                            <div className="outcomes-legend">
                              <span>
                                <span className="legend-swatch trend-low" />
                                {copy.outcomesRiskLow}
                              </span>
                              <span>
                                <span className="legend-swatch trend-moderate" />
                                {copy.outcomesRiskModerate}
                              </span>
                              <span>
                                <span className="legend-swatch trend-high" />
                                {copy.outcomesRiskHigh}
                              </span>
                            </div>
                            <div className="outcomes-trend-list">
                              {outcomesTrendByWeek.length === 0 ? (
                                <div className="portal-message">{copy.outcomesEmpty}</div>
                              ) : (
                                outcomesTrendByWeek.map((item) => {
                                  const total = item.total || 0;
                                  const lowPct = total ? (item.low / total) * 100 : 0;
                                  const moderatePct = total ? (item.moderate / total) * 100 : 0;
                                  const highPct = total ? (item.high / total) * 100 : 0;
                                  return (
                                    <div key={item.week_start} className="outcomes-trend-row">
                                      <span className="portal-meta">{formatDate(item.week_start)}</span>
                                      <div className={`outcomes-trend-bar ${total === 0 ? "is-empty" : ""}`}>
                                        {total > 0 ? (
                                          <>
                                            <span
                                              className="outcomes-trend-segment trend-low"
                                              style={{ width: `${lowPct}%` }}
                                            />
                                            <span
                                              className="outcomes-trend-segment trend-moderate"
                                              style={{ width: `${moderatePct}%` }}
                                            />
                                            <span
                                              className="outcomes-trend-segment trend-high"
                                              style={{ width: `${highPct}%` }}
                                            />
                                          </>
                                        ) : null}
                                      </div>
                                      <span className="portal-meta">{total}</span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <div className="portal-card-header">
                              <div>
                                <h4>{copy.outcomesResidentsTitle}</h4>
                                <p className="text-muted">{copy.outcomesResidentsBody}</p>
                              </div>
                            </div>
                            <div className="outcomes-resident-list">
                              {outcomesResidentTrends.length === 0 ? (
                                <div className="portal-message">{copy.outcomesEmpty}</div>
                              ) : (
                                outcomesResidentTrends.map((item) => {
                                  const trendLabel = outcomesTrendLabelMap[item.trend] || copy.outcomesTrendUnknown;
                                  const trendClass = outcomesTrendClassMap[item.trend] || "trend-pill trend-unknown";
                                  const latestRiskLabel = item.latest_risk ? riskLabelMap[item.latest_risk] : copy.outcomesUnknown;
                                  const previousRiskLabel = item.previous_risk
                                    ? riskLabelMap[item.previous_risk]
                                    : copy.outcomesUnknown;
                                  return (
                                    <div key={item.resident_id} className="outcomes-resident-row">
                                      <div className="outcomes-resident-details">
                                        <strong>{item.first_name} {item.last_name}</strong>
                                        <span className="portal-meta">
                                          {copy.residentIdShort}: {item.external_id || "--"} · {formatDate(item.last_assessment_date) || "--"}
                                        </span>
                                      </div>
                                      <div className="outcomes-resident-meta">
                                        <span className={trendClass}>{trendLabel}</span>
                                        <span className="portal-meta">{copy.outcomesLatestLabel}</span>
                                        {item.latest_risk ? (
                                          <span className={adminRiskClass[item.latest_risk] || "risk-pill"}>
                                            {latestRiskLabel}
                                          </span>
                                        ) : (
                                          <span className="risk-pill">{latestRiskLabel}</span>
                                        )}
                                        <span className="portal-meta">
                                          {copy.outcomesPreviousLabel}: {previousRiskLabel}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activePanel === "workflow" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.workflowTitle}</h3>
                          <p className="text-muted">{copy.workflowBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={loadWorkflowQueue}
                          disabled={workflowLoading}
                        >
                          {copy.workflowRefresh}
                        </button>
                      </div>
                      <div className="portal-section-grid">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <div className="portal-filter-row">
                              <div className="portal-filter">
                                <label>{copy.workflowStatusLabel}</label>
                                <select
                                  value={workflowStatusFilter}
                                  onChange={(event) => setWorkflowStatusFilter(event.target.value)}
                                  disabled={!token}
                                >
                                  {workflowStatusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-filter">
                                <label>{copy.workflowAssignedLabel}</label>
                                <select
                                  value={workflowAssignedFilter}
                                  onChange={(event) => setWorkflowAssignedFilter(event.target.value)}
                                  disabled={!token}
                                >
                                  {workflowAssignedOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-filter">
                                <label>{copy.workflowUnitLabel}</label>
                                <select
                                  value={workflowUnitFilter}
                                  onChange={(event) => setWorkflowUnitFilter(event.target.value)}
                                  disabled={!token || unitLoading}
                                >
                                  {unitFilterOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              {workflowUpdated ? (
                                <div className="portal-filter-summary">
                                  <span className="portal-meta">
                                    {copy.analyticsUpdated}: {formatDateTime(workflowUpdated)}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                            <div className="portal-workflow-list">
                              {workflowLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : workflowError ? (
                                <div className="portal-message portal-error">{workflowError}</div>
                              ) : workflowQueue.length === 0 ? (
                                <div className="portal-message">{copy.workflowEmpty}</div>
                              ) : (
                                workflowQueue.map((item) => {
                                  const isIncident = item.item_type === "fall_event";
                                  const isMine = !isIncident && item.assigned_to && item.assigned_to === user?.id;
                                  const assignedLabel = item.assigned_name || item.assigned_email || "--";
                                  const statusLabel = statusLabelMap[item.status] || item.status;
                                  const riskLabel = item.risk_tier ? riskLabelMap[item.risk_tier] : copy.outcomesUnknown;
                                  const slaHours = item.sla_hours_remaining;
                                  let slaLabel = "";
                                  let slaClass = "sla-pill";
                                  if (Number.isFinite(slaHours)) {
                                    if (slaHours < 0) {
                                      slaLabel = copy.workflowOverdue;
                                      slaClass = "sla-pill sla-overdue";
                                    } else if (slaHours <= workflowWarningHours) {
                                      slaLabel = copy.workflowDueSoon;
                                      slaClass = "sla-pill sla-warning";
                                    } else {
                                      slaLabel = copy.workflowOnTrack;
                                      slaClass = "sla-pill sla-ontrack";
                                    }
                                  }
                                  const slaText = Number.isFinite(slaHours)
                                    ? `${slaLabel} ${formatHours(Math.abs(slaHours))}`
                                    : "--";
                                  const incidentSeverity = isIncident
                                    ? (fallSeverityLabelMap[item.injury_severity] || item.injury_severity || "--")
                                    : null;
                                  const checklistProgress = isIncident
                                    ? `${item.fall_checks_completed || 0}/${item.fall_checks_required || 0}`
                                    : null;
                                  const primaryDate = isIncident ? item.occurred_at : item.assessment_date;
                                  const unitLabel = item.resident_unit_label;
                                  return (
                                    <div key={`${item.item_type}-${item.id}`} className={`portal-workflow-row ${slaHours < 0 ? "is-overdue" : ""}`}>
                                      <div className="portal-workflow-details">
                                        <strong>{item.resident_first_name} {item.resident_last_name}</strong>
                                        <span className="portal-meta">
                                          {copy.residentIdShort}: {item.resident_external_id || "--"} · {formatDate(primaryDate) || "--"}
                                        </span>
                                        <div className="portal-workflow-meta">
                                          {isIncident ? (
                                            <span className="status-pill status-review">{incidentSeverity}</span>
                                          ) : (
                                            <span className={adminStatusClass[item.status] || "status-pill"}>{statusLabel}</span>
                                          )}
                                          {!isIncident ? (
                                            item.risk_tier ? (
                                              <span className={adminRiskClass[item.risk_tier] || "risk-pill"}>{riskLabel}</span>
                                            ) : (
                                              <span className="risk-pill">{riskLabel}</span>
                                            )
                                          ) : (
                                            <span className="portal-meta">{copy.workflowChecklistLabel}: {checklistProgress}</span>
                                          )}
                                          <span className={slaClass}>{slaText}</span>
                                        </div>
                                        <div className="portal-workflow-meta">
                                          {!isIncident ? (
                                            <span className="portal-meta">
                                              {copy.workflowAssignedTo}: {item.assigned_to ? assignedLabel : copy.workflowAssignedUnassigned}
                                            </span>
                                          ) : (
                                            <span className="portal-meta">{copy.workflowIncidentLabel}</span>
                                          )}
                                          <span className="portal-meta">
                                            {copy.workflowDueLabel}: {formatDate(item.due_date) || "--"}
                                          </span>
                                          {unitLabel ? (
                                            <span className="portal-meta">
                                              {copy.workflowUnitLabel}: {unitLabel}
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="portal-workflow-actions">
                                        {isIncident ? (
                                          <button
                                            className="button ghost small"
                                            type="button"
                                            onClick={async () => {
                                              setSelectedResidentId(item.resident_id);
                                              setActivePanel("incidents");
                                              setSelectedFallEventId(item.id);
                                              await loadFallEvents(item.resident_id);
                                            }}
                                          >
                                            {copy.workflowIncidentOpen}
                                          </button>
                                        ) : (
                                          <>
                                            {!item.assigned_to ? (
                                              <button
                                                className="button ghost small"
                                                type="button"
                                                onClick={() => handleAssignWorkflow(item.id, "me")}
                                              >
                                                {copy.workflowClaim}
                                              </button>
                                            ) : null}
                                            {item.assigned_to && (isMine || user?.role === "admin") ? (
                                              <button
                                                className="button ghost small"
                                                type="button"
                                                onClick={() => handleAssignWorkflow(item.id, null)}
                                              >
                                                {copy.workflowUnassign}
                                              </button>
                                            ) : null}
                                            {item.status === "needs_review" ? (
                                              <button
                                                className="button ghost small"
                                                type="button"
                                                onClick={async () => {
                                                  if (!item.assigned_to) {
                                                    await handleAssignWorkflow(item.id, "me");
                                                  }
                                                  handleWorkflowStatusUpdate(item.id, "in_review");
                                                }}
                                              >
                                                {copy.workflowStartReview}
                                              </button>
                                            ) : null}
                                            {item.status !== "completed" ? (
                                              <button
                                                className="button small"
                                                type="button"
                                                onClick={() => handleWorkflowStatusUpdate(item.id, "completed")}
                                              >
                                                {copy.workflowComplete}
                                              </button>
                                            ) : null}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card portal-stack">
                            <div className="portal-legend">
                              <span className="portal-meta">{copy.workflowSlaLabel}</span>
                              <div className="portal-filter-pills">
                                <span className="sla-pill sla-overdue">{copy.workflowOverdue}</span>
                                <span className="sla-pill sla-warning">{copy.workflowDueSoon}</span>
                                <span className="sla-pill sla-ontrack">{copy.workflowOnTrack}</span>
                              </div>
                            </div>
                            <div className="portal-legend">
                              <span className="portal-meta">{copy.workflowAssignedLabel}</span>
                              <div className="portal-filter-pills">
                                <span className="portal-pill">{copy.workflowAssignedMe}</span>
                                <span className="portal-pill">{copy.workflowAssignedUnassigned}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "pt-workflow" ? (
                  <div className="portal-panel">
                    <div className="portal-panel-header">
                      <div>
                        <h3>{copy.ptWorkflowTitle}</h3>
                        <p className="text-muted">{copy.ptWorkflowBody}</p>
                      </div>
                    </div>
                    <div className="portal-section-grid">
                      <div className="portal-section-col">
                        <div className="portal-section-card">
                          <div className="portal-card-header">
                            <div>
                              <h4>{copy.ptWorkflowStepsTitle}</h4>
                              <p className="text-muted">{copy.ptWorkflowContextBody}</p>
                            </div>
                            <div className="portal-pt-progress">
                              <span className="portal-meta">{copy.ptWorkflowProgressLabel}</span>
                              <strong>{ptWorkflowCompleted}/{ptWorkflowSteps.length}</strong>
                            </div>
                          </div>
                          <div className="portal-progress-track">
                            <div
                              className="portal-progress-bar"
                              style={{ width: `${Math.round(ptWorkflowProgress * 100)}%` }}
                            />
                          </div>
                          <div className="portal-progress-grid">
                            {ptWorkflowSteps.map((step) => (
                              <div key={step.id} className={`progress-chip ${step.done ? "complete" : ""}`}>
                                <span>{step.label}</span>
                                <strong>{step.done ? copy.assessmentStatusDone : copy.assessmentStatusMissing}</strong>
                              </div>
                            ))}
                          </div>
                          <div className="portal-assessment-actions">
                            <span className="portal-meta">{copy.ptWorkflowActionsTitle}</span>
                            <div className="portal-action-row">
                              <button className="button ghost small" type="button" onClick={() => handlePanelChange("residents")}>
                                {copy.navResidents}
                              </button>
                              <button
                                className="button ghost small"
                                type="button"
                                onClick={() => handlePanelChange("assessments")}
                                disabled={!selectedResident}
                              >
                                {copy.navAssessments}
                              </button>
                              <button
                                className="button ghost small"
                                type="button"
                                onClick={() => handlePanelChange("uploads")}
                                disabled={!selectedResident}
                              >
                                {copy.navUploads}
                              </button>
                              <button
                                className="button ghost small"
                                type="button"
                                onClick={() => handlePanelChange("scores")}
                                disabled={!selectedAssessment}
                              >
                                {copy.navScores}
                              </button>
                              <button
                                className="button ghost small"
                                type="button"
                                onClick={() => handlePanelChange("reports")}
                                disabled={!selectedAssessment}
                              >
                                {copy.navReports}
                              </button>
                              {qaRequired ? (
                                <button
                                  className="button ghost small"
                                  type="button"
                                  onClick={() => handlePanelChange("qa")}
                                  disabled={!selectedAssessment}
                                >
                                  {copy.navQa}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="portal-section-card">
                          <div className="portal-card-header">
                            <div>
                              <h4>{copy.ptDetailsTitle}</h4>
                              <p className="text-muted">{copy.ptDetailsBody}</p>
                            </div>
                          </div>
                          {!selectedAssessment ? (
                            <div className="portal-message">{copy.selectAssessment}</div>
                          ) : (
                            <form className="portal-form" onSubmit={handleSavePtDetails}>
                              <div className="portal-edit-grid">
                                <div className="portal-field portal-field-full">
                                  <label>{copy.ptFieldCptLabel}</label>
                                  <input
                                    type="text"
                                    value={ptForm.pt_cpt_codes}
                                    onChange={(event) => setPtForm((prev) => ({
                                      ...prev,
                                      pt_cpt_codes: event.target.value,
                                    }))}
                                    disabled={!token || ptSaving}
                                  />
                                  <span className="field-hint">{copy.ptFieldCptHint}</span>
                                </div>
                                <div className="portal-field">
                                  <label>{copy.ptFieldPainLabel}</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max="10"
                                    value={ptForm.pt_pain_score}
                                    onChange={(event) => setPtForm((prev) => ({
                                      ...prev,
                                      pt_pain_score: event.target.value,
                                    }))}
                                    disabled={!token || ptSaving}
                                  />
                                </div>
                                <div className="portal-field">
                                  <label>{copy.ptFieldSessionLabel}</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max="240"
                                    value={ptForm.pt_session_minutes}
                                    onChange={(event) => setPtForm((prev) => ({
                                      ...prev,
                                      pt_session_minutes: event.target.value,
                                    }))}
                                    disabled={!token || ptSaving}
                                  />
                                </div>
                                <div className="portal-field">
                                  <label>{copy.ptFieldTimeSavedLabel}</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max="240"
                                    value={ptForm.pt_time_saved_minutes}
                                    onChange={(event) => setPtForm((prev) => ({
                                      ...prev,
                                      pt_time_saved_minutes: event.target.value,
                                    }))}
                                    disabled={!token || ptSaving}
                                  />
                                  <span className="field-hint">{copy.ptFieldTimeSavedHint}</span>
                                </div>
                                <div className="portal-field portal-field-full">
                                  <label>{copy.ptFieldGoalsLabel}</label>
                                  <textarea
                                    rows="3"
                                    value={ptForm.pt_goals}
                                    onChange={(event) => setPtForm((prev) => ({
                                      ...prev,
                                      pt_goals: event.target.value,
                                    }))}
                                    disabled={!token || ptSaving}
                                  />
                                </div>
                                <div className="portal-field portal-field-full">
                                  <label>{copy.ptFieldPlanLabel}</label>
                                  <textarea
                                    rows="3"
                                    value={ptForm.pt_plan_of_care}
                                    onChange={(event) => setPtForm((prev) => ({
                                      ...prev,
                                      pt_plan_of_care: event.target.value,
                                    }))}
                                    disabled={!token || ptSaving}
                                  />
                                </div>
                              </div>
                              <div className="portal-pt-timer">
                                <div className="portal-pt-timer-header">
                                  <h4>{copy.ptTimerTitle}</h4>
                                  <span className="portal-meta">
                                    {ptElapsedSeconds > 0
                                      ? `${Math.floor(ptElapsedSeconds / 60)}:${String(ptElapsedSeconds % 60).padStart(2, "0")}`
                                      : "0:00"}
                                  </span>
                                </div>
                                <div className="portal-action-row">
                                  <button
                                    className="button ghost small"
                                    type="button"
                                    onClick={() => setPtTimerActive(true)}
                                    disabled={ptTimerActive}
                                  >
                                    {copy.ptTimerStart}
                                  </button>
                                  <button
                                    className="button ghost small"
                                    type="button"
                                    onClick={() => setPtTimerActive(false)}
                                    disabled={!ptTimerActive}
                                  >
                                    {copy.ptTimerPause}
                                  </button>
                                  <button
                                    className="button ghost small"
                                    type="button"
                                    onClick={() => {
                                      setPtTimerActive(false);
                                      setPtElapsedSeconds(0);
                                    }}
                                  >
                                    {copy.ptTimerReset}
                                  </button>
                                  <button
                                    className="button ghost small"
                                    type="button"
                                    onClick={handleApplyPtTimer}
                                    disabled={ptElapsedSeconds === 0}
                                  >
                                    {copy.ptTimerApply}
                                  </button>
                                </div>
                                {ptTimeSavedRange ? (
                                  <div className="portal-message">
                                    {copy.ptFieldTimeSavedLabel}: {ptTimeSavedRange.min}-{ptTimeSavedRange.max} min
                                  </div>
                                ) : null}
                              </div>
                              {ptError ? (
                                <div className="portal-message portal-error">{ptError}</div>
                              ) : null}
                              {ptNotice ? (
                                <div className="portal-message portal-success">{ptNotice}</div>
                              ) : null}
                              <div className="portal-form-actions">
                                <button className="button primary" type="submit" disabled={ptSaving}>
                                  {ptSaving ? copy.saving : copy.ptSaveButton}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </div>
                      <div className="portal-section-col">
                        <div className="portal-section-card">
                          <div className="portal-card-header">
                            <div>
                              <h4>{copy.ptWorkflowContextTitle}</h4>
                              <p className="text-muted">{copy.ptWorkflowContextBody}</p>
                            </div>
                          </div>
                          {selectedResident ? (
                            <div className="portal-assessment-context">
                              <div>
                                <span className="portal-meta">{copy.residentLabelName}</span>
                                <strong>{selectedResident.first_name} {selectedResident.last_name}</strong>
                                <span className="text-muted">
                                  {formatDate(selectedResident.dob) || "--"} · {copy.residentIdShort}: {selectedResident.external_id || "--"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="portal-message">{copy.selectResident}</div>
                          )}
                          {selectedAssessment ? (
                            <div className="portal-assessment-summary">
                              <div>
                                <span className="portal-meta">{copy.assessmentSelected}</span>
                                <strong>{formatDate(selectedAssessment.assessment_date)}</strong>
                                <span className="text-muted">{selectedAssessment.assistive_device || "--"}</span>
                                <span className="text-muted">
                                  {copy.assessmentDue}: {formatDate(selectedAssessment.due_date || selectedAssessment.scheduled_date || selectedAssessment.assessment_date) || "--"}
                                </span>
                              </div>
                              <div className="portal-progress-grid">
                                {[
                                  { label: copy.assessmentStepVideo, done: selectedAssessmentHasVideo },
                                  { label: copy.assessmentStepScores, done: assessmentHasScores || Boolean(selectedAssessment?.has_scores) },
                                  { label: copy.assessmentStepReport, done: assessmentHasReport },
                                ].map((item) => (
                                  <div key={item.label} className={`progress-chip ${item.done ? "complete" : ""}`}>
                                    <span>{item.label}</span>
                                    <strong>{item.done ? copy.assessmentStatusDone : copy.assessmentStatusMissing}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="portal-message">{copy.selectAssessment}</div>
                          )}
                        </div>
                        <div className="portal-section-card">
                          <div className="portal-card-header">
                            <div>
                              <h4>{copy.ptWorkflowNextLabel}</h4>
                              <p className="text-muted">
                                {ptWorkflowNext ? copy.ptWorkflowNextBody : copy.ptWorkflowAllDoneBody}
                              </p>
                            </div>
                          </div>
                          <div className="portal-assessment-summary">
                            <span className="portal-meta">{copy.ptWorkflowNextLabel}</span>
                            <strong>{ptWorkflowNext ? ptWorkflowNext.label : copy.ptWorkflowAllDone}</strong>
                          </div>
                        </div>
                        <div className="portal-section-card">
                          <div className="portal-card-header">
                            <div>
                              <h4>{copy.ptChecklistTitle}</h4>
                              <p className="text-muted">{copy.ptChecklistBody}</p>
                            </div>
                          </div>
                          <div className="portal-checklist-list">
                            {ptChecklistAll.map((item) => (
                              <div key={item.id} className={`portal-checklist-item ${item.done ? "is-done" : ""}`}>
                                <span>{item.label}</span>
                                <span className={`status-pill ${item.done ? "status-review" : "status-open"}`}>
                                  {item.done ? copy.assessmentStatusDone : copy.assessmentStatusMissing}
                                </span>
                              </div>
                            ))}
                          </div>
                          {!ptChecklistComplete && ptChecklistMissing.length ? (
                            <div className="portal-message">
                              {copy.ptSummaryBlocked} {ptChecklistMissing.join(", ")}.
                            </div>
                          ) : null}
                          <div className="portal-form-actions">
                            <button
                              className="button primary"
                              type="button"
                              onClick={handleDownloadPtSummary}
                              disabled={!ptChecklistComplete || !selectedAssessment}
                            >
                              {copy.ptSummaryDownload}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "residents" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.residentsTitle}</h3>
                          <p className="text-muted">{copy.residentsBody}</p>
                        </div>
                        <div className="portal-card-actions">
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={() => setResidentDrawerOpen((prev) => !prev)}
                            disabled={!selectedResident}
                          >
                            {residentDrawerOpen ? copy.residentDrawerToggle : copy.residentDrawerShow}
                          </button>
                          <button
                            className="button ghost small"
                            type="button"
                            onClick={handleExportResidents}
                            disabled={!token || residentLoading}
                          >
                            {copy.exportCsv}
                          </button>
                          <button className="button ghost small" type="button" onClick={loadResidents} disabled={!token}>
                            {copy.refresh}
                          </button>
                        </div>
                      </div>
                      <div className="portal-section-grid">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <div className="portal-search">
                              <input
                                type="search"
                                placeholder={copy.residentSearch}
                                value={residentSearch}
                                onChange={(event) => setResidentSearch(event.target.value)}
                                disabled={!token}
                              />
                            </div>
                            <div className="portal-filter-row">
                              <div className="portal-filter">
                                <label>{copy.residentFilterSex}</label>
                                <select
                                  value={residentSexFilter}
                                  onChange={(event) => setResidentSexFilter(event.target.value)}
                                  disabled={!token}
                                >
                                  {sexFilterOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-filter">
                                <label>{copy.residentFilterLocation}</label>
                                <input
                                  type="text"
                                  placeholder={copy.residentFilterLocationPlaceholder}
                                  value={residentLocationFilter}
                                  onChange={(event) => setResidentLocationFilter(event.target.value)}
                                  disabled={!token}
                                />
                              </div>
                              <div className="portal-filter">
                                <label>{copy.residentSort}</label>
                                <select
                                  value={residentSort}
                                  onChange={(event) => setResidentSort(event.target.value)}
                                  disabled={!token}
                                >
                                  <option value="recent">{copy.residentSortNewest}</option>
                                  <option value="name">{copy.residentSortName}</option>
                                </select>
                              </div>
                              <div className="portal-filter-summary">
                                <span className="portal-meta">
                                  {copy.residentCount} {sortedResidents.length} {copy.residentCountOf} {residents.length}
                                </span>
                              </div>
                            </div>
                            <div className="portal-list portal-list-tall">
                              {residentLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : sortedResidents.length === 0 ? (
                                <div className="portal-message">
                                  {residents.length === 0 ? copy.residentEmpty : copy.residentFilterEmptyList}
                                </div>
                              ) : (
                                sortedResidents.map((resident) => {
                                  const unitLabel = unitLabelMap[resident.unit_id];
                                  return (
                                    <button
                                      key={resident.id}
                                      className={`portal-row ${resident.id === selectedResidentId ? "active" : ""}`}
                                      type="button"
                                      onClick={() => {
                                        setSelectedResidentId(resident.id);
                                        setResidentDrawerOpen(true);
                                      }}
                                    >
                                      <div>
                                        <strong>{resident.first_name} {resident.last_name}</strong>
                                        <div className="portal-row-meta">
                                          <span>{formatDate(resident.dob) || "--"}</span>
                                          <span aria-hidden="true">•</span>
                                          <span>{copy.residentAgeLabel}: {getAge(resident.dob) ?? "--"}</span>
                                          {resident.external_id ? (
                                            <>
                                              <span aria-hidden="true">•</span>
                                              <span>{copy.residentIdShort}: {resident.external_id}</span>
                                            </>
                                          ) : null}
                                          {formatResidentLocation(resident) ? (
                                            <>
                                              <span aria-hidden="true">•</span>
                                              <span>{formatResidentLocation(resident)}</span>
                                            </>
                                          ) : null}
                                          {unitLabel ? (
                                            <>
                                              <span aria-hidden="true">•</span>
                                              <span>{copy.residentLabelUnitAssignment}: {unitLabel}</span>
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                      <span className="portal-pill">{resident.sex || "--"}</span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                            {residentError ? <div className="portal-message portal-error">{residentError}</div> : null}
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <form className="portal-form" onSubmit={handleCreateResident}>
                              <h4>{copy.residentNew}</h4>
                              <div className={`portal-field ${residentFieldErrors.first_name ? "has-error" : ""}`}>
                                <label>{copy.residentFirst}</label>
                                <input
                                  type="text"
                                  value={newResident.first_name}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("first_name", value);
                                    setResidentFieldErrors((prev) => ({ ...prev, first_name: "" }));
                                    setResidentSuccess("");
                                    setResidentError("");
                                  }}
                                  disabled={!token}
                                  required
                                />
                                {residentFieldErrors.first_name ? (
                                  <span className="field-error">{residentFieldErrors.first_name}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${residentFieldErrors.last_name ? "has-error" : ""}`}>
                                <label>{copy.residentLastName}</label>
                                <input
                                  type="text"
                                  value={newResident.last_name}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("last_name", value);
                                    setResidentFieldErrors((prev) => ({ ...prev, last_name: "" }));
                                    setResidentSuccess("");
                                    setResidentError("");
                                  }}
                                  disabled={!token}
                                  required
                                />
                                {residentFieldErrors.last_name ? (
                                  <span className="field-error">{residentFieldErrors.last_name}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${residentFieldErrors.dob ? "has-error" : ""}`}>
                                <label>{copy.residentDob}</label>
                                <input
                                  type="date"
                                  value={newResident.dob}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("dob", value);
                                    setResidentFieldErrors((prev) => ({ ...prev, dob: "" }));
                                    setResidentSuccess("");
                                    setResidentError("");
                                  }}
                                  disabled={!token}
                                  required
                                />
                                {residentFieldErrors.dob ? (
                                  <span className="field-error">{residentFieldErrors.dob}</span>
                                ) : null}
                                {newResidentAge !== null ? (
                                  <span className="field-hint">{copy.residentAgeLabel}: {newResidentAge}</span>
                                ) : null}
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentSex}</label>
                                <select
                                  value={newResident.sex}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("sex", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                >
                                  {sexOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentExternal}</label>
                                <input
                                  type="text"
                                  value={newResident.external_id}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("external_id", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelBuilding}</label>
                                <input
                                  type="text"
                                  value={newResident.building}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("building", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelFloor}</label>
                                <input
                                  type="text"
                                  value={newResident.floor}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("floor", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelUnit}</label>
                                <input
                                  type="text"
                                  value={newResident.unit}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("unit", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelRoom}</label>
                                <input
                                  type="text"
                                  value={newResident.room}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("room", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelUnitAssignment}</label>
                                <select
                                  value={newResident.unit_id}
                                  onChange={(event) => updateNewResidentField("unit_id", event.target.value)}
                                  disabled={!token || unitLoading}
                                >
                                  {unitOptions.map((option) => (
                                    <option key={option.value || "none"} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentNotes}</label>
                                <textarea
                                  value={newResident.notes}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    updateNewResidentField("notes", value);
                                    setResidentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              {residentDuplicate ? (
                                <div className="portal-message">
                                  <strong>{copy.residentDuplicateWarning}</strong>
                                  <span className="portal-duplicate-detail">
                                    {residentDuplicate.first_name} {residentDuplicate.last_name} · {formatDate(residentDuplicate.dob) || "--"}
                                  </span>
                                  <div className="portal-message-actions">
                                    <button
                                      className="button ghost small"
                                      type="button"
                                      onClick={() => handleCreateResident(null, { allowDuplicate: true })}
                                      disabled={!token || residentSaving}
                                    >
                                      {copy.residentDuplicateAction}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              {residentSuccess ? <div className="portal-message portal-success">{residentSuccess}</div> : null}
                              <div className="portal-form-actions">
                                <button className="button primary" type="submit" disabled={!token || residentSaving}>
                                  {residentSaving ? copy.saving : copy.residentSave}
                                </button>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={() => {
                                    setNewResident({
                                      first_name: "",
                                      last_name: "",
                                      dob: "",
                                      sex: "",
                                      external_id: "",
                                      notes: "",
                                      building: "",
                                      floor: "",
                                      unit: "",
                                      room: "",
                                      unit_id: "",
                                    });
                                    setResidentFieldErrors({});
                                    setResidentDuplicate(null);
                                    setResidentSuccess("");
                                    setResidentError("");
                                  }}
                                  disabled={!token || residentSaving}
                                >
                                  {copy.residentClear}
                                </button>
                              </div>
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "assessments" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.assessmentsTitle}</h3>
                          <p className="text-muted">{copy.assessmentsBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={() => loadAssessments(selectedResidentId)}
                          disabled={!token || !selectedResidentId}
                        >
                          {copy.refresh}
                        </button>
                      </div>
                      <div className="portal-section-grid">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <div className="portal-search">
                              <input
                                type="search"
                                placeholder={copy.assessmentSearch}
                                value={assessmentSearch}
                                onChange={(event) => setAssessmentSearch(event.target.value)}
                                disabled={!token || !selectedResident}
                              />
                            </div>
                            <div className="portal-list portal-list-tall">
                              {!selectedResident ? (
                                <div className="portal-message">{copy.residentSelect}</div>
                              ) : assessmentLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : filteredAssessments.length === 0 ? (
                                <div className="portal-message">
                                  {assessments.length === 0 ? copy.assessmentEmpty : copy.assessmentFilterEmptyList}
                                </div>
                              ) : (
                                filteredAssessments.map((assessment) => (
                                  <button
                                    key={assessment.id}
                                    className={`portal-row ${assessment.id === selectedAssessmentId ? "active" : ""}`}
                                    type="button"
                                    onClick={() => setSelectedAssessmentId(assessment.id)}
                                  >
                                    <div>
                                      <strong>{formatDate(assessment.assessment_date)}</strong>
                                      <span>{assessment.assistive_device || "--"}</span>
                                    </div>
                                    <div className="portal-status">
                                      {assessment.status ? (
                                        <span className={adminStatusClass[assessment.status] || "status-pill"}>
                                          {statusOptions.find((item) => item.value === assessment.status)?.label || assessment.status}
                                        </span>
                                      ) : null}
                                      {assessment.video_count ? (
                                        <span className="status-pill status-done">{copy.badgeVideo}</span>
                                      ) : null}
                                      {assessment.has_scores ? (
                                        <span className="status-pill status-review">{copy.badgeScores}</span>
                                      ) : null}
                                      {(() => {
                                        const dueStatus = getDueStatus(assessment);
                                        return dueStatus ? (
                                          <span className={dueStatus.className}>{dueStatus.label}</span>
                                        ) : null;
                                      })()}
                                      {assessment.risk_tier ? (
                                        <span className={adminRiskClass[assessment.risk_tier] || "risk-pill"}>
                                          {riskOptions.find((item) => item.value === assessment.risk_tier)?.label || assessment.risk_tier}
                                        </span>
                                      ) : null}
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                            {assessmentError ? <div className="portal-message portal-error">{assessmentError}</div> : null}
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {selectedResident ? (
                              <div className="portal-assessment-context">
                                <div>
                                  <span className="portal-meta">{copy.residentLabelName}</span>
                                  <strong>{selectedResident.first_name} {selectedResident.last_name}</strong>
                                  <span className="text-muted">
                                    {formatDate(selectedResident.dob) || "--"} · {copy.residentIdShort}: {selectedResident.external_id || "--"}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="portal-message">{copy.residentSelect}</div>
                            )}
                            {selectedAssessment ? (
                              <div className="portal-assessment-summary">
                                <div>
                                  <span className="portal-meta">{copy.assessmentSelected}</span>
                                  <strong>{formatDate(selectedAssessment.assessment_date)}</strong>
                                  <span className="text-muted">{selectedAssessment.assistive_device || "--"}</span>
                                  <span className="text-muted">
                                    {copy.assessmentDue}: {formatDate(selectedAssessment.due_date || selectedAssessment.scheduled_date || selectedAssessment.assessment_date) || "--"}
                                  </span>
                                  {(() => {
                                    const dueStatus = getDueStatus(selectedAssessment);
                                    return dueStatus ? (
                                      <span className={dueStatus.className}>{dueStatus.label}</span>
                                    ) : null;
                                  })()}
                                </div>
                                <div className="portal-progress-grid">
                                  {[
                                    { label: copy.assessmentStepVideo, done: assessmentHasVideo },
                                    { label: copy.assessmentStepScores, done: assessmentHasScores },
                                    { label: copy.assessmentStepReport, done: assessmentHasReport },
                                  ].map((item) => (
                                    <div key={item.label} className={`progress-chip ${item.done ? "complete" : ""}`}>
                                      <span>{item.label}</span>
                                      <strong>{item.done ? copy.assessmentStatusDone : copy.assessmentStatusMissing}</strong>
                                    </div>
                                  ))}
                                </div>
                                <div className="portal-assessment-actions">
                                  <span className="portal-meta">{copy.assessmentQuickActions}</span>
                                  <div className="portal-action-row">
                                    <button className="button ghost small" type="button" onClick={() => handlePanelChange("uploads")}>
                                      {copy.navUploads}
                                    </button>
                                    <button className="button ghost small" type="button" onClick={() => handlePanelChange("scores")}>
                                      {copy.navScores}
                                    </button>
                                    <button className="button ghost small" type="button" onClick={() => handlePanelChange("reports")}>
                                      {copy.navReports}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {selectedAssessment ? (
                            <div className="portal-section-card">
                              <form className="portal-form" onSubmit={handleUpdateSchedule}>
                                <h4>{copy.assessmentScheduleTitle}</h4>
                                <p className="text-muted">{copy.assessmentScheduleBody}</p>
                                <div className={`portal-field ${scheduleErrors.scheduled_date ? "has-error" : ""}`}>
                                  <label>{copy.assessmentScheduled}</label>
                                  <input
                                    type="date"
                                    value={scheduleForm.scheduled_date}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setScheduleForm((prev) => {
                                        const next = { ...prev, scheduled_date: value };
                                        if (!prev.due_date || prev.due_date === prev.scheduled_date) {
                                          next.due_date = value;
                                        }
                                        return next;
                                      });
                                      setScheduleErrors((prev) => ({ ...prev, scheduled_date: "" }));
                                    }}
                                    disabled={!token || scheduleSaving}
                                    required
                                  />
                                  {scheduleErrors.scheduled_date ? (
                                    <span className="field-error">{scheduleErrors.scheduled_date}</span>
                                  ) : null}
                                </div>
                                <div className={`portal-field ${scheduleErrors.due_date ? "has-error" : ""}`}>
                                  <label>{copy.assessmentDue}</label>
                                  <input
                                    type="date"
                                    value={scheduleForm.due_date}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setScheduleForm((prev) => ({ ...prev, due_date: value }));
                                      setScheduleErrors((prev) => ({ ...prev, due_date: "" }));
                                    }}
                                    disabled={!token || scheduleSaving}
                                  />
                                  {scheduleErrors.due_date ? (
                                    <span className="field-error">{scheduleErrors.due_date}</span>
                                  ) : null}
                                </div>
                                {scheduleNotice ? (
                                  <div className={`portal-message ${scheduleNotice === copy.assessmentScheduleSaved ? "portal-success" : "portal-error"}`}>
                                    {scheduleNotice}
                                  </div>
                                ) : null}
                                <button className="button primary" type="submit" disabled={!token || scheduleSaving}>
                                  {scheduleSaving ? copy.saving : copy.assessmentScheduleSave}
                                </button>
                              </form>
                            </div>
                          ) : null}
                          <div className="portal-section-card">
                            <form className="portal-form" onSubmit={handleCreateAssessment}>
                              <h4>{copy.assessmentNew}</h4>
                              <div className={`portal-field ${assessmentFieldErrors.assessment_date ? "has-error" : ""}`}>
                                <label>{copy.assessmentDate}</label>
                                <input
                                  type="date"
                                  value={newAssessment.assessment_date}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setNewAssessment((prev) => {
                                      const next = { ...prev, assessment_date: value };
                                      if (!prev.scheduled_date || prev.scheduled_date === prev.assessment_date) {
                                        next.scheduled_date = value;
                                      }
                                      if (!prev.due_date || prev.due_date === prev.scheduled_date) {
                                        next.due_date = value;
                                      }
                                      return next;
                                    });
                                    setAssessmentFieldErrors((prev) => ({ ...prev, assessment_date: "" }));
                                    setAssessmentSuccess("");
                                    setAssessmentError("");
                                  }}
                                  disabled={!token}
                                  required
                                />
                                {assessmentFieldErrors.assessment_date ? (
                                  <span className="field-error">{assessmentFieldErrors.assessment_date}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${assessmentFieldErrors.scheduled_date ? "has-error" : ""}`}>
                                <label>{copy.assessmentScheduled}</label>
                                <input
                                  type="date"
                                  value={newAssessment.scheduled_date}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setNewAssessment((prev) => {
                                      const next = { ...prev, scheduled_date: value };
                                      if (!prev.due_date || prev.due_date === prev.scheduled_date) {
                                        next.due_date = value;
                                      }
                                      return next;
                                    });
                                    setAssessmentFieldErrors((prev) => ({ ...prev, scheduled_date: "" }));
                                  }}
                                  disabled={!token}
                                />
                                {assessmentFieldErrors.scheduled_date ? (
                                  <span className="field-error">{assessmentFieldErrors.scheduled_date}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${assessmentFieldErrors.due_date ? "has-error" : ""}`}>
                                <label>{copy.assessmentDue}</label>
                                <input
                                  type="date"
                                  value={newAssessment.due_date}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setNewAssessment((prev) => ({ ...prev, due_date: value }));
                                    setAssessmentFieldErrors((prev) => ({ ...prev, due_date: "" }));
                                  }}
                                  disabled={!token}
                                />
                                {assessmentFieldErrors.due_date ? (
                                  <span className="field-error">{assessmentFieldErrors.due_date}</span>
                                ) : null}
                              </div>
                              <div className="portal-field">
                                <label>{copy.assessmentDevice}</label>
                                <input
                                  type="text"
                                  value={newAssessment.assistive_device}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setNewAssessment((prev) => ({ ...prev, assistive_device: value }));
                                    setAssessmentSuccess("");
                                  }}
                                  disabled={!token}
                                />
                              </div>
                              {assessmentSuccess ? <div className="portal-message portal-success">{assessmentSuccess}</div> : null}
                              <button className="button primary" type="submit" disabled={!token || assessmentSaving || !selectedResident}>
                                {assessmentSaving ? copy.saving : copy.assessmentSave}
                              </button>
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "incidents" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.incidentsTitle}</h3>
                          <p className="text-muted">{copy.incidentsBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={() => loadFallEvents(selectedResidentId)}
                          disabled={!token || !selectedResidentId || fallEventLoading}
                        >
                          {copy.refresh}
                        </button>
                      </div>
                      <div className="portal-section-grid">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {!selectedResident ? (
                              <div className="portal-message">{copy.incidentSelectResident}</div>
                            ) : fallEventLoading ? (
                              <div className="portal-message">{copy.loading}</div>
                            ) : fallEvents.length === 0 ? (
                              <div className="portal-message">{copy.incidentEmpty}</div>
                            ) : (
                              <div className="portal-list portal-list-tall">
                                {fallEvents.map((event) => {
                                  const locationLabel = formatFallEventLocation(event);
                                  const requiredChecks = Number.isFinite(Number(event.fall_checks_required))
                                    ? Number(event.fall_checks_required)
                                    : fallChecklistItems.length;
                                  const completedChecks = Number.isFinite(Number(event.fall_checks_completed))
                                    ? Number(event.fall_checks_completed)
                                    : 0;
                                  let followupBadge = null;
                                  if (requiredChecks > 0 && completedChecks < requiredChecks && event.occurred_at) {
                                    const occurredDate = new Date(event.occurred_at);
                                    if (!Number.isNaN(occurredDate.getTime())) {
                                      const dueDate = new Date(occurredDate);
                                      dueDate.setHours(0, 0, 0, 0);
                                      dueDate.setDate(dueDate.getDate() + fallFollowupDays);
                                      const today = new Date();
                                      today.setHours(0, 0, 0, 0);
                                      const overdue = dueDate < today;
                                      followupBadge = {
                                        label: overdue ? copy.incidentFollowupOverdue : copy.incidentFollowupDue,
                                        className: overdue ? "status-escalated" : "status-open",
                                        due: formatDate(dueDate),
                                      };
                                    }
                                  }
                                  return (
                                    <button
                                      key={event.id}
                                      className={`portal-row ${event.id === selectedFallEventId ? "active" : ""}`}
                                      type="button"
                                      onClick={() => setSelectedFallEventId(event.id)}
                                    >
                                      <div>
                                        <strong>{formatDateTime(event.occurred_at) || "--"}</strong>
                                        <div className="portal-row-meta">
                                          <span>{fallSeverityLabelMap[event.injury_severity] || event.injury_severity || "--"}</span>
                                          {locationLabel ? (
                                            <>
                                              <span aria-hidden="true">•</span>
                                              <span>{locationLabel}</span>
                                            </>
                                          ) : null}
                                        </div>
                                        <div className="portal-row-meta">
                                          <span>
                                            {copy.incidentLinkedAssessment}: {formatDate(event.last_assessment_date) || "--"}
                                          </span>
                                          <span aria-hidden="true">•</span>
                                          <span>
                                            {copy.incidentLinkedRisk}: {riskLabelMap[event.last_risk_tier] || event.last_risk_tier || "--"}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="portal-status">
                                        {followupBadge ? (
                                          <div className="portal-status-stack">
                                            <span className={`status-pill ${followupBadge.className}`} title={followupBadge.due}>
                                              {followupBadge.label}
                                            </span>
                                            <span className="portal-meta">
                                              {copy.workflowDueLabel}: {followupBadge.due}
                                            </span>
                                          </div>
                                        ) : null}
                                        {event.ems_called ? (
                                          <span className="status-pill status-review">EMS</span>
                                        ) : null}
                                        {event.hospital_transfer ? (
                                          <span className="status-pill status-done">Hospital</span>
                                        ) : null}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {fallEventError ? <div className="portal-message portal-error">{fallEventError}</div> : null}
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <form className="portal-form" onSubmit={handleCreateFallEvent}>
                              <h4>{copy.incidentNew}</h4>
                              <div className="portal-field">
                                <label>{copy.incidentOccurredAt}</label>
                                <input
                                  type="datetime-local"
                                  value={fallEventForm.occurred_at}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, occurred_at: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                  required
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelBuilding}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.building}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, building: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelFloor}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.floor}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, floor: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelUnit}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.unit}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, unit: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.residentLabelRoom}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.room}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, room: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.incidentSeverity}</label>
                                <select
                                  value={fallEventForm.injury_severity}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, injury_severity: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                >
                                  {fallSeverityOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-toggle-row">
                                <label className="portal-toggle">
                                  <input
                                    type="checkbox"
                                    checked={fallEventForm.ems_called}
                                    onChange={(event) => setFallEventForm((prev) => ({ ...prev, ems_called: event.target.checked }))}
                                    disabled={!token || !selectedResident || fallEventSaving}
                                  />
                                  <span>{copy.incidentEmsCalled}</span>
                                </label>
                                <label className="portal-toggle">
                                  <input
                                    type="checkbox"
                                    checked={fallEventForm.hospital_transfer}
                                    onChange={(event) => setFallEventForm((prev) => ({ ...prev, hospital_transfer: event.target.checked }))}
                                    disabled={!token || !selectedResident || fallEventSaving}
                                  />
                                  <span>{copy.incidentHospitalTransfer}</span>
                                </label>
                              </div>
                              <div className="portal-field">
                                <label>{copy.incidentWitness}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.witness}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, witness: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.incidentAssistiveDevice}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.assistive_device}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, assistive_device: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.incidentFactors}</label>
                                <input
                                  type="text"
                                  value={fallEventForm.contributing_factors}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, contributing_factors: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                                <span className="field-hint">{copy.incidentFactorsHint}</span>
                              </div>
                              <div className="portal-field">
                                <label>{copy.incidentNotes}</label>
                                <textarea
                                  value={fallEventForm.notes}
                                  onChange={(event) => setFallEventForm((prev) => ({ ...prev, notes: event.target.value }))}
                                  disabled={!token || !selectedResident || fallEventSaving}
                                />
                              </div>
                              {fallEventNotice ? <div className="portal-message portal-success">{fallEventNotice}</div> : null}
                              <button className="button primary" type="submit" disabled={!token || !selectedResident || fallEventSaving}>
                                {fallEventSaving ? copy.saving : copy.incidentSave}
                              </button>
                            </form>
                          </div>
                          <div className="portal-section-card">
                            <div className="portal-card-header">
                              <div>
                                <h4>{copy.incidentChecklistTitle}</h4>
                                {selectedFallEvent && fallChecklistItems.length > 0 ? (
                                  <p className="text-muted">
                                    {fallChecklistCompleted}/{fallChecklistItems.length}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            {!selectedFallEvent ? (
                              <div className="portal-message">{copy.incidentSelectEvent}</div>
                            ) : fallChecklistItems.length === 0 ? (
                              <div className="portal-message">{copy.incidentChecklistEmpty}</div>
                            ) : (
                              <div className="portal-checklist">
                                {fallChecklistItems.map((item) => {
                                  const status = fallEventChecks[item]?.status;
                                  const done = status === "completed";
                                  const busy = fallEventChecksBusy[item];
                                  return (
                                    <button
                                      key={item}
                                      className={`portal-checklist-item ${done ? "is-complete" : ""}`}
                                      type="button"
                                      onClick={() => handleToggleFallCheck(item)}
                                      disabled={busy || !token}
                                    >
                                      <span>{item}</span>
                                      <strong>{done ? copy.incidentChecklistDone : copy.incidentChecklistPending}</strong>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "uploads" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.uploadTitle}</h3>
                          <p className="text-muted">{copy.uploadBody}</p>
                        </div>
                      </div>
                      <div className="portal-section-grid portal-section-grid-reverse">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {selectedAssessment ? (
                              <div className="portal-assessment-context">
                                <div>
                                  <span className="portal-meta">{copy.assessmentSelected}</span>
                                  <strong>{formatDate(selectedAssessment.assessment_date)}</strong>
                                  <span className="text-muted">{selectedResident ? `${selectedResident.first_name} ${selectedResident.last_name}` : "--"}</span>
                                </div>
                              </div>
                            ) : null}
                            <div className="portal-guidelines">
                              <h4>{copy.uploadGuidelinesTitle}</h4>
                              <ul className="portal-checklist">
                                <li>{copy.uploadRuleDuration}</li>
                                <li>{copy.uploadRuleResolution}</li>
                                <li>{copy.uploadRuleFormat}</li>
                              </ul>
                              <p className="field-hint">{copy.uploadMetaHint}</p>
                            </div>
                            {!selectedResident ? (
                              <div className="portal-message">{copy.selectResident}</div>
                            ) : !selectedAssessment ? (
                              <div className="portal-message">{copy.uploadAutoCreate}</div>
                            ) : null}
                            {assessmentDetails?.videos?.length ? (
                              <div className="portal-downloads">
                                {assessmentDetails.videos.slice(0, 2).map((video) => (
                                  <button
                                    key={video.id}
                                    className="button ghost small"
                                    type="button"
                                    onClick={() => handleDownloadVideo(video.id)}
                                  >
                                    Video {formatDate(video.created_at)}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <form className="portal-form" onSubmit={handleUploadVideo}>
                              <div className={`portal-field ${uploadFieldErrors.file ? "has-error" : ""}`}>
                                <label>{copy.uploadFile}</label>
                                <input
                                  type="file"
                                  accept="video/mp4,video/quicktime"
                            onChange={handleUploadFileChange}
                                  disabled={!token || !selectedResident || uploadStatus.busy}
                                />
                                <span className="field-hint">{copy.uploadFileHint}</span>
                                {uploadFile ? (
                                  <div className="portal-file-card">
                                    <div>
                                      <span className="portal-meta">{copy.uploadSelected}</span>
                                      <strong>{uploadFile.name}</strong>
                                      <span className="text-muted">
                                        {formatBytes(uploadFile.size)} · {uploadFile.type || "video"}
                                      </span>
                                    </div>
                                    <button
                                      className="button ghost small"
                                      type="button"
                                      onClick={resetUpload}
                                      disabled={!token || uploadStatus.busy}
                                    >
                                      {copy.uploadClear}
                                    </button>
                                  </div>
                                ) : null}
                                {uploadFieldErrors.file ? (
                                  <span className="field-error">{uploadFieldErrors.file}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${uploadFieldErrors.duration_seconds ? "has-error" : ""}`}>
                                <label>{copy.uploadDuration}</label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={uploadMeta.duration_seconds}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setUploadMeta((prev) => ({ ...prev, duration_seconds: value }));
                                    setUploadFieldErrors((prev) => ({ ...prev, duration_seconds: "" }));
                                  }}
                                  disabled={!token || !selectedResident || uploadStatus.busy}
                                />
                                {uploadFieldErrors.duration_seconds ? (
                                  <span className="field-error">{uploadFieldErrors.duration_seconds}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${uploadFieldErrors.width ? "has-error" : ""}`}>
                                <label>{copy.uploadWidth}</label>
                                <input
                                  type="number"
                                  value={uploadMeta.width}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setUploadMeta((prev) => ({ ...prev, width: value }));
                                    setUploadFieldErrors((prev) => ({ ...prev, width: "" }));
                                  }}
                                  disabled={!token || !selectedResident || uploadStatus.busy}
                                />
                                {uploadFieldErrors.width ? (
                                  <span className="field-error">{uploadFieldErrors.width}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${uploadFieldErrors.height ? "has-error" : ""}`}>
                                <label>{copy.uploadHeight}</label>
                                <input
                                  type="number"
                                  value={uploadMeta.height}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setUploadMeta((prev) => ({ ...prev, height: value }));
                                    setUploadFieldErrors((prev) => ({ ...prev, height: "" }));
                                  }}
                                  disabled={!token || !selectedResident || uploadStatus.busy}
                                />
                                {uploadFieldErrors.height ? (
                                  <span className="field-error">{uploadFieldErrors.height}</span>
                                ) : null}
                              </div>
                              {uploadStatus.error ? <div className="portal-message portal-error">{uploadStatus.error}</div> : null}
                              {uploadStatus.success ? <div className="portal-message portal-success">{uploadStatus.success}</div> : null}
                              {uploadStatus.busy ? (
                                <div className="portal-progress">
                                  <div className="portal-progress-track">
                                    <div className="portal-progress-bar" style={{ width: `${uploadStatus.progress}%` }} />
                                  </div>
                                  <span className="portal-progress-label">
                                    {copy.uploadProgressLabel} · {uploadStatus.progress}%
                                  </span>
                                </div>
                              ) : null}
                              <div className="portal-form-actions">
                                <button className="button primary" type="submit" disabled={!token || !selectedResident || uploadStatus.busy}>
                                  {uploadStatus.busy ? copy.uploadBusy : copy.uploadButton}
                                </button>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={resetUpload}
                                  disabled={!token || uploadStatus.busy}
                                >
                                  {copy.uploadClear}
                                </button>
                              </div>
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "scores" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.scoresTitle}</h3>
                          <p className="text-muted">{copy.scoresBody}</p>
                        </div>
                      </div>
                      <div className="portal-section-grid portal-section-grid-reverse">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {!selectedAssessment ? (
                              <div className="portal-message">{copy.selectAssessment}</div>
                            ) : (
                              <>
                                <div className="portal-assessment-context">
                                  <div>
                                    <span className="portal-meta">{copy.assessmentSelected}</span>
                                    <strong>{formatDate(selectedAssessment.assessment_date)}</strong>
                                    <span className="text-muted">
                                      {selectedResident ? `${selectedResident.first_name} ${selectedResident.last_name}` : "--"}
                                    </span>
                                  </div>
                                  <div className="portal-status">
                                    {selectedAssessment.status ? (
                                      <span className={adminStatusClass[selectedAssessment.status] || "status-pill"}>
                                        {statusOptions.find((item) => item.value === selectedAssessment.status)?.label || selectedAssessment.status}
                                      </span>
                                    ) : null}
                                    {selectedAssessment.risk_tier ? (
                                      <span className={adminRiskClass[selectedAssessment.risk_tier] || "risk-pill"}>
                                        {riskOptions.find((item) => item.value === selectedAssessment.risk_tier)?.label || selectedAssessment.risk_tier}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            <form className="portal-form" onSubmit={handleSaveScores}>
                              <div className="portal-field">
                                <label>{copy.statusLabel}</label>
                                <select
                                  value={scoreForm.status}
                                  onChange={(event) => setScoreForm((prev) => ({ ...prev, status: event.target.value }))}
                                  disabled={!token || !selectedAssessment}
                                >
                                  <option value="">--</option>
                                  {statusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.riskLabel}</label>
                                <select
                                  value={scoreForm.risk_tier}
                                  onChange={(event) => setScoreForm((prev) => ({ ...prev, risk_tier: event.target.value }))}
                                  disabled={!token || !selectedAssessment}
                                >
                                  <option value="">--</option>
                                  {riskOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              {showTugField ? (
                                <div className={`portal-field ${scoreFieldErrors.tug_seconds ? "has-error" : ""}`}>
                                  <label>{copy.tugLabel}</label>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={scoreForm.tug_seconds}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setScoreForm((prev) => ({ ...prev, tug_seconds: value }));
                                      setScoreFieldErrors((prev) => ({ ...prev, tug_seconds: "" }));
                                      setScoreNotice("");
                                    }}
                                    disabled={!token || !selectedAssessment}
                                  />
                                  {scoreFieldErrors.tug_seconds ? (
                                    <span className="field-error">{scoreFieldErrors.tug_seconds}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {showChairField ? (
                                <div className={`portal-field ${scoreFieldErrors.chair_stand_seconds ? "has-error" : ""}`}>
                                  <label>{copy.chairLabel}</label>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={scoreForm.chair_stand_seconds}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setScoreForm((prev) => ({ ...prev, chair_stand_seconds: value }));
                                      setScoreFieldErrors((prev) => ({ ...prev, chair_stand_seconds: "" }));
                                      setScoreNotice("");
                                    }}
                                    disabled={!token || !selectedAssessment}
                                  />
                                  {scoreFieldErrors.chair_stand_seconds ? (
                                    <span className="field-error">{scoreFieldErrors.chair_stand_seconds}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {showBalanceFields ? (
                                <div className="portal-toggle-row">
                                  <label className="portal-toggle">
                                    <input
                                      type="checkbox"
                                      checked={scoreForm.balance_side_by_side}
                                      onChange={(event) => setScoreForm((prev) => ({ ...prev, balance_side_by_side: event.target.checked }))}
                                      disabled={!token || !selectedAssessment}
                                    />
                                    <span>{copy.balanceSide}</span>
                                  </label>
                                  <label className="portal-toggle">
                                    <input
                                      type="checkbox"
                                      checked={scoreForm.balance_semi_tandem}
                                      onChange={(event) => setScoreForm((prev) => ({ ...prev, balance_semi_tandem: event.target.checked }))}
                                      disabled={!token || !selectedAssessment}
                                    />
                                    <span>{copy.balanceSemi}</span>
                                  </label>
                                  <label className="portal-toggle">
                                    <input
                                      type="checkbox"
                                      checked={scoreForm.balance_tandem}
                                      onChange={(event) => setScoreForm((prev) => ({ ...prev, balance_tandem: event.target.checked }))}
                                      disabled={!token || !selectedAssessment}
                                    />
                                    <span>{copy.balanceTandem}</span>
                                  </label>
                                </div>
                              ) : null}
                              <div className="portal-field">
                                <label>{copy.scoreNotes}</label>
                                <textarea
                                  value={scoreForm.score_notes}
                                  onChange={(event) => setScoreForm((prev) => ({ ...prev, score_notes: event.target.value }))}
                                  disabled={!token || !selectedAssessment}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.clinicianNotes}</label>
                                <textarea
                                  value={scoreForm.clinician_notes}
                                  onChange={(event) => setScoreForm((prev) => ({ ...prev, clinician_notes: event.target.value }))}
                                  disabled={!token || !selectedAssessment}
                                />
                              </div>
                              {scoreNotice ? <div className="portal-message">{scoreNotice}</div> : null}
                              <div className="portal-form-actions">
                                <button className="button primary" type="submit" disabled={!token || !selectedAssessment || scoreSaving}>
                                  {scoreSaving ? copy.scoreBusy : copy.scoreSave}
                                </button>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={handleSyncModelScores}
                                  disabled={!token || !selectedAssessment || syncScoresBusy}
                                >
                                  {syncScoresBusy ? copy.syncModelScoresBusy : copy.syncModelScores}
                                </button>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={handleRunModel}
                                  disabled={!token || !selectedAssessment || runModelBusy || !selectedAssessmentHasVideo}
                                >
                                  {runModelBusy ? copy.runModelBusy : copy.runModelNow}
                                </button>
                              </div>
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "reports" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.reportTitle}</h3>
                          <p className="text-muted">{copy.reportBody}</p>
                        </div>
                      </div>
                      <div className="portal-section-grid portal-section-grid-reverse">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {selectedAssessment ? (
                              <div className="portal-report-summary">
                                <div>
                                  <span className="portal-meta">{copy.reportSummaryTitle}</span>
                                  {assessmentHasReport ? (
                                    <>
                                      <strong>{copy.reportReadyLabel}</strong>
                                      <span className="text-muted">
                                        {copy.reportCreatedOn}: {formatDateTime(assessmentDetails?.report?.created_at)}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-muted">{copy.reportSummaryEmpty}</span>
                                  )}
                                </div>
                                <div>
                                  <span className="portal-meta">{copy.reportChecklistTitle}</span>
                                  <ul className="portal-checklist">
                                    {reportChecklistItems.map((item) => (
                                      <li key={item.label} className={item.done ? "is-complete" : ""}>
                                        <span>{item.label}</span>
                                        <strong>{item.done ? copy.assessmentStatusDone : copy.assessmentStatusMissing}</strong>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="field-hint">{copy.reportGenerateHelp}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="portal-message">{copy.selectAssessment}</div>
                            )}
                          </div>
                        </div>
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {reportError ? <div className="portal-message portal-error">{reportError}</div> : null}
                            {selectedAssessment && !canGenerateReport ? (
                              <div className="portal-message">{reportGateMessage}</div>
                            ) : null}
                            {assessmentDetails?.report ? (
                              <div className="portal-report">
                                <span className="portal-meta">Report {assessmentDetails.report.id}</span>
                                <div className="portal-report-actions">
                                  <button
                                    className="button ghost small"
                                    type="button"
                                    onClick={async () => {
                                      const reportId = assessmentDetails.report.id;
                                      if (reportPreview.url && reportPreview.id === reportId) {
                                        clearReportPreview();
                                        return;
                                      }
                                      setReportPreview({ url: "", id: reportId, busy: true, error: "" });
                                      try {
                                        const url = await fetchBlobUrl(`/reports/${reportId}/download`, token);
                                        setReportPreview({ url, id: reportId, busy: false, error: "" });
                                      } catch (error) {
                                        setReportPreview({ url: "", id: reportId, busy: false, error: copy.reportPreviewError });
                                        handleApiError(error, setReportError);
                                      }
                                    }}
                                    disabled={reportPreview.busy}
                                  >
                                    {reportPreview.url ? copy.reportHidePreview : copy.reportPreview}
                                  </button>
                                  <button className="button ghost" type="button" onClick={handleDownloadReport}>
                                    {copy.reportDownload}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            <button
                              className="button primary"
                              type="button"
                              onClick={handleGenerateReport}
                              disabled={!token || !selectedAssessment || reportBusy || !canGenerateReport}
                            >
                              {reportBusy ? copy.reportBusy : copy.reportButton}
                            </button>
                            {reportPreview.busy ? <div className="portal-message">{copy.reportPreviewBusy}</div> : null}
                            {reportPreview.error ? <div className="portal-message portal-error">{reportPreview.error}</div> : null}
                            {detailsLoading ? <div className="portal-message">{copy.loading}</div> : null}
                          </div>
                          <div className="portal-section-card">
                            <div className="portal-card-header">
                              <div>
                                <h4>{copy.reportHistoryTitle}</h4>
                                <p className="text-muted">{copy.reportHistoryBody}</p>
                              </div>
                            </div>
                            {!selectedAssessment ? (
                              <div className="portal-message">{copy.selectAssessment}</div>
                            ) : reportHistory.length === 0 ? (
                              <div className="portal-message">{copy.reportHistoryEmpty}</div>
                            ) : (
                              <div className="portal-report-history">
                                {reportHistory.map((item) => {
                                  const label = reportTypeLabelMap[item.report_type] || item.report_type || "--";
                                  return (
                                    <div key={item.id} className="portal-report-row">
                                      <div>
                                        <strong>{label}</strong>
                                        <span className="portal-meta">
                                          {formatDateTime(item.created_at) || "--"}
                                        </span>
                                      </div>
                                      <button
                                        className="button ghost small"
                                        type="button"
                                        onClick={() => downloadProtected(
                                          `/reports/${item.id}/download`,
                                          token,
                                          item.report_type === "pt_summary" ? "pt_summary.pdf" : "stride_report.pdf"
                                        )}
                                        disabled={!token}
                                      >
                                        {copy.reportHistoryDownload}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          {reportPreview.url ? (
                            <div className="portal-section-card">
                              <div className="portal-report-preview">
                                <iframe title="Report preview" src={reportPreview.url} />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "qa" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.qaTitle}</h3>
                          <p className="text-muted">{copy.qaBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={() => {
                            const headers = [
                              copy.qaResident,
                              copy.qaAssessment,
                              copy.qaStatusLabel,
                              ...qaSteps,
                              copy.qaNotes,
                            ];
                            const rows = assessments.map((assessment) => {
                              const residentName = selectedResident
                                ? `${selectedResident.first_name} ${selectedResident.last_name}`
                                : "";
                              const checks = qaChecks[assessment.id] || {};
                              const completed = qaSteps.every((step) => checks[step]);
                              const escalated = Boolean(qaEscalations[assessment.id]);
                              const statusLabel = escalated
                                ? copy.qaStatusEscalated
                                : (completed ? copy.qaStatusReady : copy.qaStatusNeeds);
                              return [
                                residentName,
                                formatDate(assessment.assessment_date),
                                statusLabel,
                                ...qaSteps.map((step) => (checks[step] ? "Yes" : "No")),
                                qaNotes[assessment.id] || "",
                              ];
                            });
                            downloadCsv("pilot_qa.csv", headers, rows);
                          }}
                          disabled={assessments.length === 0}
                        >
                          {copy.qaExport}
                        </button>
                      </div>
                      {qaError ? <div className="portal-message portal-error">{qaError}</div> : null}
                      <div className="portal-section-grid portal-section-grid-reverse">
                        <div className="portal-section-col">
                          <div className="portal-section-card">
                            {!selectedResident ? (
                              <div className="portal-message">{copy.residentSelect}</div>
                            ) : (
                              <div className="portal-assessment-context">
                                <div>
                                  <span className="portal-meta">{copy.residentLabelName}</span>
                                  <strong>{selectedResident.first_name} {selectedResident.last_name}</strong>
                                  <span className="text-muted">
                                    {formatDate(selectedResident.dob) || "--"} · {copy.residentIdShort}: {selectedResident.external_id || "--"}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        {selectedResident ? (
                          <div className="portal-section-col">
                            <div className="portal-section-card">
                              {qaLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : assessments.length === 0 ? (
                                <div className="portal-message">{copy.qaEmpty}</div>
                              ) : (
                                <div className="qa-table">
                                  {assessments.map((assessment) => {
                                    const checks = qaChecks[assessment.id] || {};
                                    const completed = qaSteps.every((step) => checks[step]);
                                    const escalated = Boolean(qaEscalations[assessment.id]);
                                    const statusLabel = escalated
                                      ? copy.qaStatusEscalated
                                      : (completed ? copy.qaStatusReady : copy.qaStatusNeeds);
                                    const statusClass = escalated
                                      ? "status-pill status-escalated"
                                      : `status-pill ${completed ? "status-review" : "status-open"}`;
                                    return (
                                      <div key={assessment.id} className="qa-row">
                                        <div className="qa-cell">
                                          <strong>{formatDate(assessment.assessment_date)}</strong>
                                          <span className="text-muted">{assessment.assistive_device || "--"}</span>
                                        </div>
                                        <div className="qa-cell qa-checklist">
                                          {qaSteps.map((step) => (
                                            <label key={step} className={`qa-check ${checks[step] ? "checked" : ""}`}>
                                              <input
                                                type="checkbox"
                                                checked={Boolean(checks[step])}
                                                onChange={() => handleQaToggle(assessment.id, step)}
                                              />
                                              <span>{step}</span>
                                            </label>
                                          ))}
                                        </div>
                                        <div className="qa-cell qa-notes">
                                          <textarea
                                            placeholder={copy.qaNotes}
                                            value={qaNotes[assessment.id] || ""}
                                            onChange={(event) => handleQaNoteChange(assessment.id, event.target.value)}
                                            onBlur={() => handleQaNoteBlur(assessment.id)}
                                          />
                                        </div>
                                        <div className="qa-cell">
                                          <span className={statusClass}>{statusLabel}</span>
                                          <button
                                            className="button ghost small qa-escalate"
                                            type="button"
                                            onClick={() => handleQaEscalateToggle(assessment.id)}
                                          >
                                            {copy.qaEscalateAction}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "users" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.userAdminTitle}</h3>
                          <p className="text-muted">{copy.userAdminBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={loadUsers}
                          disabled={!token || user?.role !== "admin" || userLoading}
                        >
                          {copy.refresh}
                        </button>
                      </div>
                      {user?.role !== "admin" ? (
                        <div className="portal-message">{copy.auditNotAllowed}</div>
                      ) : userLoading ? (
                        <div className="portal-message">{copy.loading}</div>
                      ) : userError ? (
                        <div className="portal-message portal-error">{userError}</div>
                      ) : (
                        <div className="portal-user-grid">
                          <div className="portal-user-list portal-section-card">
                            <div className="portal-search">
                              <input
                                type="search"
                                placeholder={copy.userSearch}
                                value={userSearch}
                                onChange={(event) => {
                                  setUserSearch(event.target.value);
                                  setUserError("");
                                }}
                              />
                            </div>
                            <div className="portal-user-rows">
                              {filteredUsers.length === 0 ? (
                                <div className="portal-message">{copy.userListEmpty}</div>
                              ) : (
                                filteredUsers.map((item) => (
                                  <button
                                    key={item.id}
                                    className={`portal-user-row ${item.id === selectedUserId ? "active" : ""}`}
                                    type="button"
                                    onClick={() => setSelectedUserId(item.id)}
                                  >
                                    <div>
                                      <strong>{item.full_name}</strong>
                                      <span>{item.email}</span>
                                    </div>
                                    <div className="portal-user-badges">
                                      <span className="portal-pill">{userRoleLabelMap[item.role] || item.role}</span>
                                      <span className={`status-pill ${item.status === "active" ? "status-review" : "status-open"}`}>
                                        {userStatusLabelMap[item.status] || item.status}
                                      </span>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="portal-user-forms portal-section-card">
                            <form className="portal-form" onSubmit={handleCreateUser}>
                              <h4>{copy.userAddTitle}</h4>
                              <div className={`portal-field ${userCreateErrors.email ? "has-error" : ""}`}>
                                <label>{copy.userEmailLabel}</label>
                                <input
                                  type="email"
                                  value={userCreateForm.email}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setUserCreateForm((prev) => ({ ...prev, email: value }));
                                    setUserCreateErrors((prev) => ({ ...prev, email: "" }));
                                    setUserSuccess("");
                                    setUserError("");
                                  }}
                                />
                                {userCreateErrors.email ? <span className="field-error">{userCreateErrors.email}</span> : null}
                              </div>
                              <div className={`portal-field ${userCreateErrors.full_name ? "has-error" : ""}`}>
                                <label>{copy.userNameLabel}</label>
                                <input
                                  type="text"
                                  value={userCreateForm.full_name}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setUserCreateForm((prev) => ({ ...prev, full_name: value }));
                                    setUserCreateErrors((prev) => ({ ...prev, full_name: "" }));
                                    setUserSuccess("");
                                    setUserError("");
                                  }}
                                />
                                {userCreateErrors.full_name ? <span className="field-error">{userCreateErrors.full_name}</span> : null}
                              </div>
                              <div className="portal-field">
                                <label>{copy.userRoleLabel}</label>
                                <select
                                  value={userCreateForm.role}
                                  onChange={(event) => setUserCreateForm((prev) => ({ ...prev, role: event.target.value }))}
                                >
                                  {userRoleOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.userStatusLabel}</label>
                                <select
                                  value={userCreateForm.status}
                                  onChange={(event) => setUserCreateForm((prev) => ({ ...prev, status: event.target.value }))}
                                >
                                  {userStatusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className={`portal-field ${userCreateErrors.password ? "has-error" : ""}`}>
                                <label>{copy.userPasswordLabel}</label>
                                <input
                                  type="password"
                                  value={userCreateForm.password}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setUserCreateForm((prev) => ({ ...prev, password: value }));
                                    setUserCreateErrors((prev) => ({ ...prev, password: "" }));
                                    setUserSuccess("");
                                    setUserError("");
                                  }}
                                />
                                <span className="field-hint">{copy.userPasswordHint}</span>
                                {userCreateErrors.password ? <span className="field-error">{userCreateErrors.password}</span> : null}
                              </div>
                              {userSuccess ? <div className="portal-message portal-success">{userSuccess}</div> : null}
                              <button className="button primary" type="submit" disabled={userCreateSaving}>
                                {userCreateSaving ? copy.saving : copy.userCreateButton}
                              </button>
                            </form>

                            <form className="portal-form" onSubmit={handleUpdateUser}>
                              <h4>{copy.userEditTitle}</h4>
                              {!selectedUser ? (
                                <div className="portal-message">{copy.userSelectHint}</div>
                              ) : (
                                <>
                                  <div className={`portal-field ${userEditErrors.full_name ? "has-error" : ""}`}>
                                    <label>{copy.userNameLabel}</label>
                                    <input
                                      type="text"
                                      value={userEditForm.full_name}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setUserEditForm((prev) => ({ ...prev, full_name: value }));
                                        setUserEditErrors((prev) => ({ ...prev, full_name: "" }));
                                        setUserEditNotice("");
                                      }}
                                      disabled={userEditSaving}
                                    />
                                    {userEditErrors.full_name ? <span className="field-error">{userEditErrors.full_name}</span> : null}
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.userRoleLabel}</label>
                                    <select
                                      value={userEditForm.role}
                                      onChange={(event) => setUserEditForm((prev) => ({ ...prev, role: event.target.value }))}
                                      disabled={userEditSaving}
                                    >
                                      {userRoleOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.userStatusLabel}</label>
                                    <select
                                      value={userEditForm.status}
                                      onChange={(event) => setUserEditForm((prev) => ({ ...prev, status: event.target.value }))}
                                      disabled={userEditSaving}
                                    >
                                      {userStatusOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.userPasswordReset}</label>
                                    <input
                                      type="password"
                                      value={userEditForm.password}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setUserEditForm((prev) => ({ ...prev, password: value }));
                                        setUserEditNotice("");
                                      }}
                                      disabled={userEditSaving}
                                    />
                                    <span className="field-hint">{copy.userPasswordOptional}</span>
                                  </div>
                                  {userEditNotice ? (
                                    <div className={`portal-message ${userEditNotice === copy.userUpdated ? "portal-success" : "portal-error"}`}>
                                      {userEditNotice}
                                    </div>
                                  ) : null}
                                  <button className="button primary" type="submit" disabled={userEditSaving}>
                                    {userEditSaving ? copy.saving : copy.userSaveButton}
                                  </button>
                                </>
                              )}
                            </form>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activePanel === "facilities" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.facilityAdminTitle}</h3>
                          <p className="text-muted">{copy.facilityAdminBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={loadFacilities}
                          disabled={!token || user?.role !== "admin" || facilityLoading}
                        >
                          {copy.refresh}
                        </button>
                      </div>
                      {user?.role !== "admin" ? (
                        <div className="portal-message">{copy.auditNotAllowed}</div>
                      ) : facilityLoading ? (
                        <div className="portal-message">{copy.loading}</div>
                      ) : facilityError ? (
                        <div className="portal-message portal-error">{facilityError}</div>
                      ) : (
                        <div className="portal-user-grid">
                          <div className="portal-user-list portal-section-card">
                            <div className="portal-search">
                              <input
                                type="search"
                                placeholder={copy.facilitySearch}
                                value={facilitySearch}
                                onChange={(event) => {
                                  setFacilitySearch(event.target.value);
                                  setFacilityError("");
                                  setFacilitySuccess("");
                                }}
                              />
                            </div>
                            <div className="portal-user-rows">
                              {filteredFacilities.length === 0 ? (
                                <div className="portal-message">{copy.facilityListEmpty}</div>
                              ) : (
                                filteredFacilities.map((item) => (
                                  <button
                                    key={item.id}
                                    className={`portal-user-row ${item.id === selectedFacilityId ? "active" : ""}`}
                                    type="button"
                                    onClick={() => setSelectedFacilityId(item.id)}
                                  >
                                    <div>
                                      <strong>{item.name}</strong>
                                      <span>
                                        {[item.city, item.state].filter(Boolean).join(", ") || item.zip || "--"}
                                      </span>
                                    </div>
                                    <div className="portal-user-badges">
                                      <span className="portal-pill">
                                        {item.reassessment_cadence_days || 90}d
                                      </span>
                                      <span className="portal-pill">
                                        {item.report_turnaround_hours || 24}h
                                      </span>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="portal-user-forms portal-section-card">
                            <form className="portal-form" onSubmit={handleCreateFacility}>
                              <h4>{copy.facilityAddTitle}</h4>
                              <div className={`portal-field ${facilityCreateErrors.name ? "has-error" : ""}`}>
                                <label>{copy.facilityName}</label>
                                <input
                                  type="text"
                                  value={facilityCreateForm.name}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setFacilityCreateForm((prev) => ({ ...prev, name: value }));
                                    setFacilityCreateErrors((prev) => ({ ...prev, name: "" }));
                                    setFacilitySuccess("");
                                    setFacilityError("");
                                  }}
                                />
                                {facilityCreateErrors.name ? <span className="field-error">{facilityCreateErrors.name}</span> : null}
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityAddress1}</label>
                                <input
                                  type="text"
                                  value={facilityCreateForm.address_line1}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, address_line1: event.target.value }))}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityAddress2}</label>
                                <input
                                  type="text"
                                  value={facilityCreateForm.address_line2}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, address_line2: event.target.value }))}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityCity}</label>
                                <input
                                  type="text"
                                  value={facilityCreateForm.city}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, city: event.target.value }))}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityState}</label>
                                <input
                                  type="text"
                                  value={facilityCreateForm.state}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, state: event.target.value }))}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityZip}</label>
                                <input
                                  type="text"
                                  value={facilityCreateForm.zip}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, zip: event.target.value }))}
                                />
                              </div>
                              <div className={`portal-field ${facilityCreateErrors.reassessment_cadence_days ? "has-error" : ""}`}>
                                <label>{copy.facilityCadence}</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={facilityCreateForm.reassessment_cadence_days}
                                  onChange={(event) => {
                                    setFacilityCreateForm((prev) => ({ ...prev, reassessment_cadence_days: event.target.value }));
                                    setFacilityCreateErrors((prev) => ({ ...prev, reassessment_cadence_days: "" }));
                                  }}
                                />
                                {facilityCreateErrors.reassessment_cadence_days ? (
                                  <span className="field-error">{facilityCreateErrors.reassessment_cadence_days}</span>
                                ) : null}
                              </div>
                              <div className={`portal-field ${facilityCreateErrors.report_turnaround_hours ? "has-error" : ""}`}>
                                <label>{copy.facilityReportSla}</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={facilityCreateForm.report_turnaround_hours}
                                  onChange={(event) => {
                                    setFacilityCreateForm((prev) => ({ ...prev, report_turnaround_hours: event.target.value }));
                                    setFacilityCreateErrors((prev) => ({ ...prev, report_turnaround_hours: "" }));
                                  }}
                                />
                                {facilityCreateErrors.report_turnaround_hours ? (
                                  <span className="field-error">{facilityCreateErrors.report_turnaround_hours}</span>
                                ) : null}
                              </div>
                              <div className="portal-field portal-field-full">
                                <span className="portal-meta">{copy.facilitySettingsTitle}</span>
                                <p className="text-muted">{copy.facilitySettingsBody}</p>
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityProtocolLabel}</label>
                                <select
                                  value={facilityCreateForm.assessment_protocol}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({
                                    ...prev,
                                    assessment_protocol: event.target.value,
                                  }))}
                                >
                                  {protocolOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityCaptureLabel}</label>
                                <select
                                  value={facilityCreateForm.capture_method}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({
                                    ...prev,
                                    capture_method: event.target.value,
                                  }))}
                                >
                                  {captureMethodOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityRolePolicyLabel}</label>
                                <select
                                  value={facilityCreateForm.role_policy}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({
                                    ...prev,
                                    role_policy: event.target.value,
                                  }))}
                                >
                                  {rolePolicyOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityChecklist}</label>
                                <textarea
                                  rows={4}
                                  value={facilityCreateForm.qa_checklist}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, qa_checklist: event.target.value }))}
                                />
                                <span className="field-hint">{copy.facilityChecklistHint}</span>
                              </div>
                              <div className="portal-field">
                                <label>{copy.facilityFallChecklist}</label>
                                <textarea
                                  rows={4}
                                  value={facilityCreateForm.fall_checklist}
                                  onChange={(event) => setFacilityCreateForm((prev) => ({ ...prev, fall_checklist: event.target.value }))}
                                />
                                <span className="field-hint">{copy.facilityFallChecklistHint}</span>
                              </div>
                              {facilitySuccess ? <div className="portal-message portal-success">{facilitySuccess}</div> : null}
                              <button className="button primary" type="submit" disabled={facilityCreateSaving}>
                                {facilityCreateSaving ? copy.saving : copy.facilityCreateButton}
                              </button>
                            </form>

                            <form className="portal-form" onSubmit={handleUpdateFacility}>
                              <h4>{copy.facilityEditTitle}</h4>
                              {!selectedFacility ? (
                                <div className="portal-message">{copy.facilitySelectHint}</div>
                              ) : (
                                <>
                                  <div className={`portal-field ${facilityEditErrors.name ? "has-error" : ""}`}>
                                    <label>{copy.facilityName}</label>
                                    <input
                                      type="text"
                                      value={facilityEditForm.name}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setFacilityEditForm((prev) => ({ ...prev, name: value }));
                                        setFacilityEditErrors((prev) => ({ ...prev, name: "" }));
                                        setFacilityEditNotice("");
                                      }}
                                      disabled={facilityEditSaving}
                                    />
                                    {facilityEditErrors.name ? <span className="field-error">{facilityEditErrors.name}</span> : null}
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityAddress1}</label>
                                    <input
                                      type="text"
                                      value={facilityEditForm.address_line1}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, address_line1: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityAddress2}</label>
                                    <input
                                      type="text"
                                      value={facilityEditForm.address_line2}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, address_line2: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityCity}</label>
                                    <input
                                      type="text"
                                      value={facilityEditForm.city}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, city: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityState}</label>
                                    <input
                                      type="text"
                                      value={facilityEditForm.state}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, state: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityZip}</label>
                                    <input
                                      type="text"
                                      value={facilityEditForm.zip}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, zip: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                  </div>
                                  <div className={`portal-field ${facilityEditErrors.reassessment_cadence_days ? "has-error" : ""}`}>
                                    <label>{copy.facilityCadence}</label>
                                    <input
                                      type="number"
                                      min="1"
                                      value={facilityEditForm.reassessment_cadence_days}
                                      onChange={(event) => {
                                        setFacilityEditForm((prev) => ({ ...prev, reassessment_cadence_days: event.target.value }));
                                        setFacilityEditErrors((prev) => ({ ...prev, reassessment_cadence_days: "" }));
                                      }}
                                      disabled={facilityEditSaving}
                                    />
                                    {facilityEditErrors.reassessment_cadence_days ? (
                                      <span className="field-error">{facilityEditErrors.reassessment_cadence_days}</span>
                                    ) : null}
                                  </div>
                                  <div className={`portal-field ${facilityEditErrors.report_turnaround_hours ? "has-error" : ""}`}>
                                    <label>{copy.facilityReportSla}</label>
                                    <input
                                      type="number"
                                      min="1"
                                      value={facilityEditForm.report_turnaround_hours}
                                      onChange={(event) => {
                                        setFacilityEditForm((prev) => ({ ...prev, report_turnaround_hours: event.target.value }));
                                        setFacilityEditErrors((prev) => ({ ...prev, report_turnaround_hours: "" }));
                                      }}
                                      disabled={facilityEditSaving}
                                    />
                                    {facilityEditErrors.report_turnaround_hours ? (
                                  <span className="field-error">{facilityEditErrors.report_turnaround_hours}</span>
                                ) : null}
                              </div>
                                  <div className="portal-field portal-field-full">
                                    <span className="portal-meta">{copy.facilitySettingsTitle}</span>
                                    <p className="text-muted">{copy.facilitySettingsBody}</p>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityProtocolLabel}</label>
                                    <select
                                      value={facilityEditForm.assessment_protocol}
                                      onChange={(event) => setFacilityEditForm((prev) => ({
                                        ...prev,
                                        assessment_protocol: event.target.value,
                                      }))}
                                      disabled={facilityEditSaving}
                                    >
                                      {protocolOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityCaptureLabel}</label>
                                    <select
                                      value={facilityEditForm.capture_method}
                                      onChange={(event) => setFacilityEditForm((prev) => ({
                                        ...prev,
                                        capture_method: event.target.value,
                                      }))}
                                      disabled={facilityEditSaving}
                                    >
                                      {captureMethodOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityRolePolicyLabel}</label>
                                    <select
                                      value={facilityEditForm.role_policy}
                                      onChange={(event) => setFacilityEditForm((prev) => ({
                                        ...prev,
                                        role_policy: event.target.value,
                                      }))}
                                      disabled={facilityEditSaving}
                                    >
                                      {rolePolicyOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityChecklist}</label>
                                    <textarea
                                      rows={4}
                                      value={facilityEditForm.qa_checklist}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, qa_checklist: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                    <span className="field-hint">{copy.facilityChecklistHint}</span>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.facilityFallChecklist}</label>
                                    <textarea
                                      rows={4}
                                      value={facilityEditForm.fall_checklist}
                                      onChange={(event) => setFacilityEditForm((prev) => ({ ...prev, fall_checklist: event.target.value }))}
                                      disabled={facilityEditSaving}
                                    />
                                    <span className="field-hint">{copy.facilityFallChecklistHint}</span>
                                  </div>
                                  {facilityEditNotice ? (
                                    <div className={`portal-message ${facilityEditNotice === copy.facilityUpdated ? "portal-success" : "portal-error"}`}>
                                      {facilityEditNotice}
                                    </div>
                                  ) : null}
                                  <button className="button primary" type="submit" disabled={facilityEditSaving}>
                                    {facilityEditSaving ? copy.saving : copy.facilitySaveButton}
                                  </button>
                                </>
                              )}
                            </form>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activePanel === "units" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.unitsTitle}</h3>
                          <p className="text-muted">{copy.unitsBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={loadUnits}
                          disabled={!token || user?.role !== "admin" || unitLoading}
                        >
                          {copy.refresh}
                        </button>
                      </div>
                      {user?.role !== "admin" ? (
                        <div className="portal-message">{copy.auditNotAllowed}</div>
                      ) : unitLoading ? (
                        <div className="portal-message">{copy.loading}</div>
                      ) : (
                        <div className="portal-user-grid">
                          <div className="portal-user-list portal-section-card">
                            {facilities.length > 1 ? (
                              <div className="portal-filter">
                                <label>{copy.facilityLabel}</label>
                                <select
                                  value={selectedFacilityId || ""}
                                  onChange={(event) => setSelectedFacilityId(event.target.value)}
                                >
                                  {facilities.map((facility) => (
                                    <option key={facility.id} value={facility.id}>{facility.name}</option>
                                  ))}
                                </select>
                              </div>
                            ) : null}
                            <div className="portal-user-rows">
                              {units.length === 0 ? (
                                <div className="portal-message">{copy.unitEmpty}</div>
                              ) : (
                                units.map((unit) => (
                                  <div key={unit.id} className="portal-user-row">
                                    <div>
                                      <strong>{unit.label}</strong>
                                      <span>
                                        {[unit.building, unit.floor, unit.unit, unit.room].filter(Boolean).join(" • ") || "--"}
                                      </span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                            {unitError ? <div className="portal-message portal-error">{unitError}</div> : null}
                          </div>
                          <div className="portal-user-forms portal-section-card">
                            <form className="portal-form" onSubmit={handleCreateUnit}>
                              <h4>{copy.unitCreate}</h4>
                              <div className="portal-field">
                                <label>{copy.unitLabel}</label>
                                <input
                                  type="text"
                                  value={unitForm.label}
                                  onChange={(event) => setUnitForm((prev) => ({ ...prev, label: event.target.value }))}
                                  disabled={unitSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.unitBuilding}</label>
                                <input
                                  type="text"
                                  value={unitForm.building}
                                  onChange={(event) => setUnitForm((prev) => ({ ...prev, building: event.target.value }))}
                                  disabled={unitSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.unitFloor}</label>
                                <input
                                  type="text"
                                  value={unitForm.floor}
                                  onChange={(event) => setUnitForm((prev) => ({ ...prev, floor: event.target.value }))}
                                  disabled={unitSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.unitUnit}</label>
                                <input
                                  type="text"
                                  value={unitForm.unit}
                                  onChange={(event) => setUnitForm((prev) => ({ ...prev, unit: event.target.value }))}
                                  disabled={unitSaving}
                                />
                              </div>
                              <div className="portal-field">
                                <label>{copy.unitRoom}</label>
                                <input
                                  type="text"
                                  value={unitForm.room}
                                  onChange={(event) => setUnitForm((prev) => ({ ...prev, room: event.target.value }))}
                                  disabled={unitSaving}
                                />
                              </div>
                              {unitNotice ? <div className="portal-message portal-success">{unitNotice}</div> : null}
                              <button className="button primary" type="submit" disabled={unitSaving}>
                                {unitSaving ? copy.saving : copy.unitCreate}
                              </button>
                            </form>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activePanel === "exports" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.exportCenterTitle}</h3>
                          <p className="text-muted">{copy.exportCenterBody}</p>
                        </div>
                      </div>
                      {user?.role !== "admin" ? (
                        <div className="portal-message">{copy.auditNotAllowed}</div>
                      ) : (
                        <div className="portal-section-grid">
                          <div className="portal-section-col">
                            <div className="portal-section-card">
                              <form className="portal-form" onSubmit={handleCreateExportToken}>
                            <span className="portal-meta">{copy.exportTokenTitle}</span>
                            <div className="portal-edit-grid">
                              <div className="portal-field">
                                <label>{copy.exportTokenType}</label>
                                <select
                                  value={exportTokenForm.export_type}
                                  onChange={(event) => {
                                    setExportTokenForm((prev) => ({ ...prev, export_type: event.target.value }));
                                    setExportTokenResult(null);
                                    setExportTokenError("");
                                  }}
                                >
                                  {exportTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="portal-field">
                                <label>{copy.exportTokenExpires}</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="168"
                                  value={exportTokenForm.expires_in_hours}
                                  onChange={(event) => setExportTokenForm((prev) => ({
                                    ...prev,
                                    expires_in_hours: event.target.value,
                                  }))}
                                />
                              </div>
                              <div className="portal-field portal-field-full">
                                <label>{copy.exportTokenFacility}</label>
                                {facilities.length ? (
                                  <select
                                    value={exportFacilityId}
                                    onChange={(event) => setExportFacilityId(event.target.value)}
                                  >
                                    {facilities.map((facility) => (
                                      <option key={facility.id} value={facility.id}>{facility.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    placeholder={copy.exportFacilityPlaceholder}
                                    value={exportFacilityId}
                                    onChange={(event) => setExportFacilityId(event.target.value)}
                                  />
                                )}
                              </div>
                              {exportTokenForm.export_type === "assessments" ? (
                                <>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterResident}</label>
                                    <input
                                      type="text"
                                      value={exportTokenForm.resident_id}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        resident_id: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterStatus}</label>
                                    <select
                                      value={exportTokenForm.status}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        status: event.target.value,
                                      }))}
                                    >
                                      {exportStatusOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterRisk}</label>
                                    <select
                                      value={exportTokenForm.risk_tier}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        risk_tier: event.target.value,
                                      }))}
                                    >
                                      <option value="all">{copy.filterAll}</option>
                                      {riskOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterAssigned}</label>
                                    <input
                                      type="text"
                                      placeholder={copy.exportAssignedPlaceholder}
                                      value={exportTokenForm.assigned_to}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        assigned_to: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterFrom}</label>
                                    <input
                                      type="date"
                                      value={exportTokenForm.from}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        from: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterTo}</label>
                                    <input
                                      type="date"
                                      value={exportTokenForm.to}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        to: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterScheduledFrom}</label>
                                    <input
                                      type="date"
                                      value={exportTokenForm.scheduled_from}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        scheduled_from: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterScheduledTo}</label>
                                    <input
                                      type="date"
                                      value={exportTokenForm.scheduled_to}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        scheduled_to: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterDueFrom}</label>
                                    <input
                                      type="date"
                                      value={exportTokenForm.due_from}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        due_from: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportFilterDueTo}</label>
                                    <input
                                      type="date"
                                      value={exportTokenForm.due_to}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        due_to: event.target.value,
                                      }))}
                                    />
                                  </div>
                                </>
                              ) : null}
                              {exportTokenForm.export_type === "audit" ? (
                                <>
                                  <div className="portal-field">
                                    <label>{copy.exportAuditAction}</label>
                                    <input
                                      type="text"
                                      value={exportTokenForm.audit_action}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        audit_action: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportAuditEntity}</label>
                                    <input
                                      type="text"
                                      value={exportTokenForm.audit_entity_type}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        audit_entity_type: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportAuditUser}</label>
                                    <input
                                      type="text"
                                      value={exportTokenForm.audit_user_id}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        audit_user_id: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportAuditFrom}</label>
                                    <input
                                      type="datetime-local"
                                      value={exportTokenForm.audit_from}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        audit_from: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportAuditTo}</label>
                                    <input
                                      type="datetime-local"
                                      value={exportTokenForm.audit_to}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        audit_to: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportAuditLimit}</label>
                                    <select
                                      value={exportTokenForm.audit_limit}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        audit_limit: event.target.value,
                                      }))}
                                    >
                                      {["50", "100", "200", "500"].map((value) => (
                                        <option key={value} value={value}>{value}</option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              ) : null}
                              {exportTokenForm.export_type === "post_fall_rollup" ? (
                                <>
                                  <div className="portal-field">
                                    <label>{copy.analyticsWindowLabel}</label>
                                    <input
                                      type="number"
                                      min="1"
                                      max="90"
                                      value={exportTokenForm.post_fall_days}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        post_fall_days: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.analyticsPostFallFilterLabel}</label>
                                    <select
                                      value={exportTokenForm.post_fall_unit_id}
                                      onChange={(event) => setExportTokenForm((prev) => ({
                                        ...prev,
                                        post_fall_unit_id: event.target.value,
                                      }))}
                                      disabled={unitLoading}
                                    >
                                      {unitFilterOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              ) : null}
                              {exportTokenForm.export_type === "bundle" ? (
                                <div className="portal-field portal-field-full">
                                  <label>{copy.exportTokenInclude}</label>
                                  <div className="portal-toggle-row">
                                    <label className="portal-toggle">
                                      <input
                                        type="checkbox"
                                        checked={exportTokenForm.include_residents}
                                        onChange={(event) => setExportTokenForm((prev) => ({
                                          ...prev,
                                          include_residents: event.target.checked,
                                        }))}
                                      />
                                      {copy.exportIncludeResidents}
                                    </label>
                                    <label className="portal-toggle">
                                      <input
                                        type="checkbox"
                                        checked={exportTokenForm.include_assessments}
                                        onChange={(event) => setExportTokenForm((prev) => ({
                                          ...prev,
                                          include_assessments: event.target.checked,
                                        }))}
                                      />
                                      {copy.exportIncludeAssessments}
                                    </label>
                                    <label className="portal-toggle">
                                      <input
                                        type="checkbox"
                                        checked={exportTokenForm.include_audit}
                                        onChange={(event) => setExportTokenForm((prev) => ({
                                          ...prev,
                                          include_audit: event.target.checked,
                                        }))}
                                      />
                                      {copy.exportIncludeAudit}
                                    </label>
                                  </div>
                                </div>
                              ) : null}
                              {exportTokenResult?.download_url ? (
                                <>
                                  <div className="portal-field portal-field-full">
                                    <label>{copy.exportTokenId}</label>
                                    <input type="text" readOnly value={exportTokenResult.id} />
                                  </div>
                                  <div className="portal-field portal-field-full">
                                    <label>{copy.exportTokenLink}</label>
                                    <input
                                      type="text"
                                      readOnly
                                      value={`${API_BASE}${exportTokenResult.download_url}`}
                                    />
                                  </div>
                                </>
                              ) : null}
                            </div>
                            {exportTokenError ? (
                              <div className="portal-message portal-error">{exportTokenError}</div>
                            ) : null}
                            {exportTokenResult ? (
                              <div className="portal-message portal-success">{copy.exportTokenSuccess}</div>
                            ) : null}
                            <div className="portal-form-actions">
                              <button className="button primary" type="submit" disabled={exportTokenBusy}>
                                {exportTokenBusy ? copy.exportTokenBusy : copy.exportTokenCreate}
                              </button>
                              {exportTokenResult?.download_url ? (
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={() => {
                                    const url = `${API_BASE}${exportTokenResult.download_url}`;
                                    window.open(url, "_blank", "noopener");
                                  }}
                                >
                                  {copy.exportTokenDownload}
                                </button>
                              ) : null}
                            </div>
                              </form>
                            </div>
                            <div className="portal-section-card">
                              <div className="portal-panel-header">
                                <div>
                                  <h4>{copy.exportScheduleTitle}</h4>
                                  <p className="text-muted">{copy.exportScheduleBody}</p>
                                </div>
                              </div>
                              <form className="portal-form" onSubmit={handleSaveExportSchedule}>
                                <div className="portal-edit-grid">
                                  <div className="portal-field">
                                    <label>{copy.exportScheduleName}</label>
                                    <input
                                      type="text"
                                      value={exportScheduleForm.name}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        name: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportTokenType}</label>
                                    <select
                                      value={exportScheduleForm.export_type}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        export_type: event.target.value,
                                      }))}
                                    >
                                      {exportTypeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportScheduleFrequency}</label>
                                    <select
                                      value={exportScheduleForm.frequency}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        frequency: event.target.value,
                                      }))}
                                    >
                                      <option value="daily">{copy.exportScheduleDaily}</option>
                                      <option value="weekly">{copy.exportScheduleWeekly}</option>
                                    </select>
                                  </div>
                                  {exportScheduleForm.frequency === "weekly" ? (
                                    <div className="portal-field">
                                      <label>{copy.exportScheduleDay}</label>
                                      <select
                                        value={exportScheduleForm.day_of_week}
                                        onChange={(event) => setExportScheduleForm((prev) => ({
                                          ...prev,
                                          day_of_week: event.target.value,
                                        }))}
                                      >
                                        {weekdayOptions.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : null}
                                  <div className="portal-field">
                                    <label>{copy.exportScheduleHour}</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="23"
                                      value={exportScheduleForm.hour}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        hour: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportScheduleMinute}</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="59"
                                      value={exportScheduleForm.minute}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        minute: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportScheduleStatus}</label>
                                    <select
                                      value={exportScheduleForm.schedule_status}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        schedule_status: event.target.value,
                                      }))}
                                    >
                                      <option value="active">{copy.exportScheduleActive}</option>
                                      <option value="paused">{copy.exportSchedulePaused}</option>
                                    </select>
                                  </div>
                                  <div className="portal-field">
                                    <label>{copy.exportScheduleExpires}</label>
                                    <input
                                      type="number"
                                      min="1"
                                      max="168"
                                      value={exportScheduleForm.expires_hours}
                                      onChange={(event) => setExportScheduleForm((prev) => ({
                                        ...prev,
                                        expires_hours: event.target.value,
                                      }))}
                                    />
                                  </div>
                                  {exportScheduleForm.export_type === "assessments" ? (
                                    <>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterResident}</label>
                                        <input
                                          type="text"
                                          value={exportScheduleForm.resident_id}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            resident_id: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterStatus}</label>
                                        <select
                                          value={exportScheduleForm.status}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            status: event.target.value,
                                          }))}
                                        >
                                          {exportStatusOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterRisk}</label>
                                        <select
                                          value={exportScheduleForm.risk_tier}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            risk_tier: event.target.value,
                                          }))}
                                        >
                                          <option value="all">{copy.filterAll}</option>
                                          {riskOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterAssigned}</label>
                                        <input
                                          type="text"
                                          placeholder={copy.exportAssignedPlaceholder}
                                          value={exportScheduleForm.assigned_to}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            assigned_to: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterFrom}</label>
                                        <input
                                          type="date"
                                          value={exportScheduleForm.from}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            from: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterTo}</label>
                                        <input
                                          type="date"
                                          value={exportScheduleForm.to}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            to: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterScheduledFrom}</label>
                                        <input
                                          type="date"
                                          value={exportScheduleForm.scheduled_from}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            scheduled_from: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterScheduledTo}</label>
                                        <input
                                          type="date"
                                          value={exportScheduleForm.scheduled_to}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            scheduled_to: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterDueFrom}</label>
                                        <input
                                          type="date"
                                          value={exportScheduleForm.due_from}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            due_from: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportFilterDueTo}</label>
                                        <input
                                          type="date"
                                          value={exportScheduleForm.due_to}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            due_to: event.target.value,
                                          }))}
                                        />
                                      </div>
                                    </>
                                  ) : null}
                                  {exportScheduleForm.export_type === "audit" ? (
                                    <>
                                      <div className="portal-field">
                                        <label>{copy.exportAuditAction}</label>
                                        <input
                                          type="text"
                                          value={exportScheduleForm.audit_action}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            audit_action: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportAuditEntity}</label>
                                        <input
                                          type="text"
                                          value={exportScheduleForm.audit_entity_type}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            audit_entity_type: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportAuditUser}</label>
                                        <input
                                          type="text"
                                          value={exportScheduleForm.audit_user_id}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            audit_user_id: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportAuditFrom}</label>
                                        <input
                                          type="datetime-local"
                                          value={exportScheduleForm.audit_from}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            audit_from: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportAuditTo}</label>
                                        <input
                                          type="datetime-local"
                                          value={exportScheduleForm.audit_to}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            audit_to: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.exportAuditLimit}</label>
                                        <select
                                          value={exportScheduleForm.audit_limit}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            audit_limit: event.target.value,
                                          }))}
                                        >
                                          {["50", "100", "200", "500"].map((value) => (
                                            <option key={value} value={value}>{value}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </>
                                  ) : null}
                                  {exportScheduleForm.export_type === "post_fall_rollup" ? (
                                    <>
                                      <div className="portal-field">
                                        <label>{copy.analyticsWindowLabel}</label>
                                        <input
                                          type="number"
                                          min="1"
                                          max="90"
                                          value={exportScheduleForm.post_fall_days}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            post_fall_days: event.target.value,
                                          }))}
                                        />
                                      </div>
                                      <div className="portal-field">
                                        <label>{copy.analyticsPostFallFilterLabel}</label>
                                        <select
                                          value={exportScheduleForm.post_fall_unit_id}
                                          onChange={(event) => setExportScheduleForm((prev) => ({
                                            ...prev,
                                            post_fall_unit_id: event.target.value,
                                          }))}
                                          disabled={unitLoading}
                                        >
                                          {unitFilterOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </>
                                  ) : null}
                                  {exportScheduleForm.export_type === "bundle" ? (
                                    <div className="portal-field portal-field-full">
                                      <label>{copy.exportTokenInclude}</label>
                                      <div className="portal-toggle-row">
                                        <label className="portal-toggle">
                                          <input
                                            type="checkbox"
                                            checked={exportScheduleForm.include_residents}
                                            onChange={(event) => setExportScheduleForm((prev) => ({
                                              ...prev,
                                              include_residents: event.target.checked,
                                            }))}
                                          />
                                          {copy.exportIncludeResidents}
                                        </label>
                                        <label className="portal-toggle">
                                          <input
                                            type="checkbox"
                                            checked={exportScheduleForm.include_assessments}
                                            onChange={(event) => setExportScheduleForm((prev) => ({
                                              ...prev,
                                              include_assessments: event.target.checked,
                                            }))}
                                          />
                                          {copy.exportIncludeAssessments}
                                        </label>
                                        <label className="portal-toggle">
                                          <input
                                            type="checkbox"
                                            checked={exportScheduleForm.include_audit}
                                            onChange={(event) => setExportScheduleForm((prev) => ({
                                              ...prev,
                                              include_audit: event.target.checked,
                                            }))}
                                          />
                                          {copy.exportIncludeAudit}
                                        </label>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                                {exportScheduleError ? (
                                  <div className="portal-message portal-error">{exportScheduleError}</div>
                                ) : null}
                                {exportScheduleNotice ? (
                                  <div className="portal-message portal-success">{exportScheduleNotice}</div>
                                ) : null}
                                <div className="portal-form-actions">
                                  <button className="button primary" type="submit" disabled={exportScheduleSaving}>
                                    {exportScheduleSaving
                                      ? copy.saving
                                      : (editingExportScheduleId ? copy.exportScheduleUpdate : copy.exportScheduleCreate)}
                                  </button>
                                  {editingExportScheduleId ? (
                                    <button
                                      className="button ghost"
                                      type="button"
                                      onClick={() => resetExportScheduleForm()}
                                      disabled={exportScheduleSaving}
                                    >
                                      {copy.exportScheduleCancel}
                                    </button>
                                  ) : null}
                                </div>
                              </form>
                              <div className="portal-schedule-list">
                                {exportScheduleLoading ? (
                                  <div className="portal-message">{copy.loading}</div>
                                ) : exportSchedules.length === 0 ? (
                                  <div className="portal-message">{copy.exportScheduleEmpty}</div>
                                ) : (
                                  exportSchedules.map((item) => {
                                    const scheduleTime = `${String(item.hour).padStart(2, "0")}:${String(item.minute).padStart(2, "0")}`;
                                    const dayLabel = item.frequency === "weekly"
                                      ? (weekdayOptions.find((day) => day.value === String(item.day_of_week))?.label
                                        || copy.exportScheduleDay)
                                      : copy.exportScheduleDaily;
                                    const cadence = item.frequency === "weekly"
                                      ? `${copy.exportScheduleWeekly} · ${dayLabel} ${scheduleTime}`
                                      : `${copy.exportScheduleDaily} · ${scheduleTime}`;
                                    const statusLabel = item.status === "active"
                                      ? copy.exportScheduleActive
                                      : copy.exportSchedulePaused;
                                    const isEditing = editingExportScheduleId === item.id;
                                    return (
                                      <div key={item.id} className={`portal-schedule-row ${isEditing ? "is-editing" : ""}`}>
                                        <div className="portal-schedule-details">
                                          <strong>{item.name}</strong>
                                          <span className="text-muted">
                                            {exportTypeLabelMap[item.export_type] || item.export_type} · {item.facility_name} · {cadence}
                                          </span>
                                          <div className="portal-schedule-meta">
                                            <span className="portal-meta">
                                              {copy.exportScheduleNextRun}: {formatDateTime(item.next_run_at) || "--"}
                                            </span>
                                            <span className="portal-meta">
                                              {copy.exportScheduleLastRun}: {formatDateTime(item.last_run_at) || "--"}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="portal-schedule-actions">
                                          <span className={`status-pill ${item.status === "active" ? "status-review" : "status-open"}`}>
                                            {statusLabel}
                                          </span>
                                          <button
                                            className="button ghost small"
                                            type="button"
                                            onClick={() => applyExportScheduleToForm(item)}
                                          >
                                            {copy.exportScheduleEdit}
                                          </button>
                                          <button
                                            className="button ghost small"
                                            type="button"
                                            onClick={() => handleRunExportSchedule(item.id)}
                                          >
                                            {copy.exportScheduleRun}
                                          </button>
                                          <button
                                            className="button ghost small"
                                            type="button"
                                            onClick={() => handleToggleExportSchedule(
                                              item.id,
                                              item.status === "active" ? "paused" : "active"
                                            )}
                                          >
                                            {item.status === "active" ? copy.exportSchedulePause : copy.exportScheduleResume}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="portal-section-col">
                            <div className="portal-section-card">
                              <div className="portal-panel-header">
                                <div>
                                  <h4>{copy.facilityRollupTitle}</h4>
                                  <p className="text-muted">{copy.facilityRollupBody}</p>
                                </div>
                                <button
                                  className="button ghost small"
                                  type="button"
                                  onClick={loadFacilityRollup}
                                  disabled={facilityRollupLoading}
                                >
                                  {copy.facilityRollupLoad}
                                </button>
                              </div>
                              {facilityRollupLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : facilityRollupError ? (
                                <div className="portal-message portal-error">{facilityRollupError}</div>
                              ) : facilityRollup.length === 0 ? (
                                <div className="portal-message">{copy.facilityRollupEmpty}</div>
                              ) : (
                                <div className="portal-rollup-list">
                                  <div className="portal-rollup-row portal-rollup-header">
                                    <span>{copy.exportTokenFacility}</span>
                                    <span>{copy.facilityRollupResidents}</span>
                                    <span>{copy.facilityRollupAssessments}</span>
                                    <span>{copy.facilityRollupCompleted}</span>
                                    <span>{copy.facilityRollupHighRisk}</span>
                                    <span>{copy.facilityRollupDueToday}</span>
                                    <span>{copy.facilityRollupOverdue}</span>
                                    <span>{copy.facilityRollupReports}</span>
                                  </div>
                                  {facilityRollup.map((item) => (
                                    <div key={item.id} className="portal-rollup-row">
                                      <div>
                                        <strong>{item.name}</strong>
                                        <span className="text-muted">
                                          {[item.city, item.state].filter(Boolean).join(", ") || "--"}
                                        </span>
                                      </div>
                                      <span>{item.residents}</span>
                                      <span>{item.assessments_total}</span>
                                      <span>{item.assessments_completed}</span>
                                      <span>{item.assessments_high_risk}</span>
                                      <span>{item.assessments_due_today}</span>
                                      <span>{item.assessments_overdue}</span>
                                      <span>{item.reports_generated}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="portal-section-card">
                            <div className="portal-panel-header">
                              <div>
                                <h4>{copy.exportLogsTitle}</h4>
                                <p className="text-muted">{copy.exportLogsBody}</p>
                              </div>
                              <button
                                className="button ghost small"
                                type="button"
                                onClick={loadExportLogs}
                                disabled={exportLogsLoading}
                              >
                                {copy.exportLogsLoad}
                              </button>
                            </div>
                            <div className="portal-filter-grid">
                              <label className="portal-filter-field">
                                <span>{copy.exportLogsFilterType}</span>
                                <select
                                  value={exportLogFilters.export_type}
                                  onChange={(event) => setExportLogFilters((prev) => ({
                                    ...prev,
                                    export_type: event.target.value,
                                  }))}
                                >
                                  <option value="all">{copy.filterAll}</option>
                                  {exportTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="portal-filter-field">
                                <span>{copy.exportLogsLimit}</span>
                                <select
                                  value={exportLogFilters.limit}
                                  onChange={(event) => setExportLogFilters((prev) => ({
                                    ...prev,
                                    limit: event.target.value,
                                  }))}
                                >
                                  {["50", "100", "200", "500"].map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="portal-filter-actions">
                              <button
                                className="button primary"
                                type="button"
                                onClick={() => loadExportLogs()}
                                disabled={exportLogsLoading}
                              >
                                {copy.exportLogsLoad}
                              </button>
                              <button
                                className="button ghost"
                                type="button"
                                onClick={() => {
                                  const reset = buildExportLogFilters();
                                  setExportLogFilters(reset);
                                }}
                                disabled={exportLogsLoading}
                              >
                                {copy.auditReset}
                              </button>
                            </div>
                            {exportLogsLoading ? (
                              <div className="portal-message">{copy.loading}</div>
                            ) : exportLogsError ? (
                              <div className="portal-message portal-error">{exportLogsError}</div>
                            ) : exportLogs.length === 0 ? (
                              <div className="portal-message">{copy.exportLogsEmpty}</div>
                            ) : (
                              <div className="portal-export-list">
                                <div className="portal-export-row portal-export-header">
                                  <span>{copy.exportLogsType}</span>
                                  <span>{copy.exportLogsStatus}</span>
                                  <span>{copy.exportLogsWhen}</span>
                                  <span>{copy.exportLogsToken}</span>
                                </div>
                                {exportLogs.slice(0, 12).map((log) => (
                                  <div key={log.id} className="portal-export-row">
                                    <div>
                                      <strong>{log.export_type}</strong>
                                      {log.params ? (
                                        <span className="text-muted">{JSON.stringify(log.params)}</span>
                                      ) : null}
                                    </div>
                                    <div>
                                      <span>{log.status}</span>
                                    </div>
                                    <span>{formatDateTime(log.created_at)}</span>
                                    <span className="text-muted">{shortenId(log.export_token_id)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activePanel === "audit" ? (
                  <div className="portal-panel">
                    <div className="portal-card">
                      <div className="portal-card-header">
                        <div>
                          <h3>{copy.adminToolsTitle}</h3>
                          <p className="text-muted">{copy.adminToolsBody}</p>
                        </div>
                        <button
                          className="button ghost small"
                          type="button"
                          onClick={loadAuditLogs}
                          disabled={!token || user?.role !== "admin" || auditLoading}
                        >
                          {copy.auditLoad}
                        </button>
                      </div>
                      {user?.role !== "admin" ? (
                        <div className="portal-message">{copy.auditNotAllowed}</div>
                      ) : (
                        <div className="portal-section-grid">
                          <div className="portal-section-col">
                            <div className="portal-section-card">
                              <div className="portal-audit-filters">
                                <span className="portal-meta">{copy.auditFiltersTitle}</span>
                                <div className="portal-filter-presets">
                                  <span className="portal-meta">{copy.auditPresetsLabel}</span>
                                  <div className="portal-filter-pills">
                                    <button
                                      className="button ghost small"
                                      type="button"
                                      onClick={() => applyAuditPresetRange(1)}
                                      disabled={auditLoading}
                                    >
                                      {copy.auditPreset24h}
                                    </button>
                                    <button
                                      className="button ghost small"
                                      type="button"
                                      onClick={() => applyAuditPresetRange(7)}
                                      disabled={auditLoading}
                                    >
                                      {copy.auditPreset7d}
                                    </button>
                                    <button
                                      className="button ghost small"
                                      type="button"
                                      onClick={() => applyAuditPresetRange(30)}
                                      disabled={auditLoading}
                                    >
                                      {copy.auditPreset30d}
                                    </button>
                                    <button
                                      className="button ghost small"
                                      type="button"
                                      onClick={applyAuditPresetUser}
                                      disabled={auditLoading || !user?.id}
                                    >
                                      {copy.auditPresetMe}
                                    </button>
                                  </div>
                                </div>
                                <div className="portal-filter-grid">
                                  <label className="portal-filter-field">
                                    <span>{copy.auditFilterAction}</span>
                                    <input
                                      type="text"
                                      placeholder="assessment.updated"
                                      value={auditFilters.action}
                                      onChange={(event) => setAuditFilters((prev) => ({ ...prev, action: event.target.value }))}
                                      list="audit-action-list"
                                    />
                                    {auditActionOptions.length ? (
                                      <datalist id="audit-action-list">
                                        {auditActionOptions.map((action) => (
                                          <option key={action} value={action} />
                                        ))}
                                      </datalist>
                                    ) : null}
                                  </label>
                                  <label className="portal-filter-field">
                                    <span>{copy.auditFilterEntity}</span>
                                    <input
                                      type="text"
                                      placeholder="assessment"
                                      value={auditFilters.entity_type}
                                      onChange={(event) => setAuditFilters((prev) => ({ ...prev, entity_type: event.target.value }))}
                                      list="audit-entity-list"
                                    />
                                    {auditEntityOptions.length ? (
                                      <datalist id="audit-entity-list">
                                        {auditEntityOptions.map((entity) => (
                                          <option key={entity} value={entity} />
                                        ))}
                                      </datalist>
                                    ) : null}
                                  </label>
                                  <label className="portal-filter-field">
                                    <span>{copy.auditFilterUser}</span>
                                    <select
                                      value={auditFilters.user_id}
                                      onChange={(event) => setAuditFilters((prev) => ({ ...prev, user_id: event.target.value }))}
                                    >
                                      <option value="">{copy.auditFilterUserAll}</option>
                                      {users.map((userItem) => {
                                        const label = userItem.full_name || userItem.email || userItem.id;
                                        const suffix = userItem.full_name && userItem.email ? ` (${userItem.email})` : "";
                                        return (
                                          <option key={userItem.id} value={userItem.id}>
                                            {label}{suffix}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </label>
                                  <label className="portal-filter-field">
                                    <span>{copy.auditFilterFrom}</span>
                                    <input
                                      type="datetime-local"
                                      value={auditFilters.from}
                                      onChange={(event) => setAuditFilters((prev) => ({ ...prev, from: event.target.value }))}
                                    />
                                  </label>
                                  <label className="portal-filter-field">
                                    <span>{copy.auditFilterTo}</span>
                                    <input
                                      type="datetime-local"
                                      value={auditFilters.to}
                                      onChange={(event) => setAuditFilters((prev) => ({ ...prev, to: event.target.value }))}
                                    />
                                  </label>
                                  <label className="portal-filter-field">
                                    <span>{copy.auditFilterLimit}</span>
                                    <select
                                      value={auditFilters.limit}
                                      onChange={(event) => setAuditFilters((prev) => ({ ...prev, limit: event.target.value }))}
                                    >
                                      {["50", "100", "200", "500"].map((value) => (
                                        <option key={value} value={value}>{value}</option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                                <div className="portal-filter-actions">
                                  <button
                                    className="button primary"
                                    type="button"
                                    onClick={() => loadAuditLogs()}
                                    disabled={auditLoading}
                                  >
                                    {copy.auditApply}
                                  </button>
                                  <button
                                    className="button ghost"
                                    type="button"
                                    onClick={() => {
                                      const reset = buildAuditFilters();
                                      setAuditFilters(reset);
                                    }}
                                    disabled={auditLoading}
                                  >
                                    {copy.auditReset}
                                  </button>
                                  <button
                                    className="button ghost"
                                    type="button"
                                    onClick={handleExportAuditCsv}
                                    disabled={auditLoading || auditExporting}
                                  >
                                    {auditExporting ? copy.auditExportBusy : copy.auditExport}
                                  </button>
                                </div>
                                {auditExportError ? (
                                  <div className="portal-message portal-error">{auditExportError}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="portal-section-col">
                            <div className="portal-section-card">
                              {auditLoading ? (
                                <div className="portal-message">{copy.loading}</div>
                              ) : auditError ? (
                                <div className="portal-message portal-error">{auditError}</div>
                              ) : auditLogs.length === 0 ? (
                                <div className="portal-message">{copy.auditEmpty}</div>
                              ) : (
                                <div className="portal-audit-list">
                                  <div className="portal-audit-row portal-audit-header">
                                    <span>{copy.auditAction}</span>
                                    <span>{copy.auditEntity}</span>
                                    <span>{copy.auditWhen}</span>
                                  </div>
                                  {auditLogs.slice(0, 12).map((log) => {
                                    const userPrimary = log.user_name || log.user_email || log.user_id || "--";
                                    const userSecondary = [];
                                    if (log.user_email && log.user_email !== userPrimary) {
                                      userSecondary.push(log.user_email);
                                    }
                                    if (log.user_role) {
                                      userSecondary.push(log.user_role);
                                    }
                                    if (log.user_id && log.user_id !== userPrimary) {
                                      userSecondary.push(log.user_id);
                                    }
                                    return (
                                      <div key={log.id} className="portal-audit-row">
                                        <div>
                                          <strong>{log.action}</strong>
                                          <span className="text-muted">{userPrimary}</span>
                                          {userSecondary.length ? (
                                            <span className="text-muted">{userSecondary.join(" · ")}</span>
                                          ) : null}
                                        </div>
                                        <div>
                                          <span>{log.entity_type}</span>
                                          <span className="text-muted">{log.entity_id}</span>
                                        </div>
                                        <span>{formatDate(log.created_at)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>

      {onboardingOpen && onboardingCurrentStep ? (
        <div className="modal-overlay onboarding-overlay" role="dialog" aria-modal="true">
          <button
            className="modal-backdrop"
            type="button"
            aria-label="Close onboarding"
            onClick={handleOnboardingDismiss}
          />
          <div className="modal-panel onboarding-panel" role="document">
            <div className="onboarding-header">
              <div>
                <span className="portal-meta">{copy.onboardingTitle}</span>
                <h3>{onboardingCurrentStep.title}</h3>
                <p className="text-muted">{onboardingCurrentStep.body}</p>
              </div>
              <span className="onboarding-progress-chip">
                {onboardingStepIndex + 1} / {onboardingSteps.length}
              </span>
            </div>
            <div className="onboarding-stepper">
              {onboardingSteps.map((step, index) => {
                const isDone = isOnboardingStepComplete(step);
                return (
                  <button
                    key={step.id}
                    className={`onboarding-step ${index === onboardingStepIndex ? "active" : ""} ${isDone ? "done" : ""}`}
                    type="button"
                    onClick={() => setOnboardingStepIndex(index)}
                  >
                    <span className="onboarding-step-count">{index + 1}</span>
                    <span className="onboarding-step-title">{step.title}</span>
                  </button>
                );
              })}
            </div>
            <div className="onboarding-body">
              {onboardingCurrentStep.id === "facility" && user?.role === "admin" ? (
                <div className="onboarding-form">
                  <div className="portal-edit-grid">
                    <label className="portal-field">
                      <span>{copy.facilityProtocolLabel}</span>
                      <select
                        value={onboardingFacilityForm.assessment_protocol}
                        onChange={(event) => setOnboardingFacilityForm((prev) => ({
                          ...prev,
                          assessment_protocol: event.target.value,
                        }))}
                      >
                        {protocolOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="portal-field">
                      <span>{copy.facilityCaptureLabel}</span>
                      <select
                        value={onboardingFacilityForm.capture_method}
                        onChange={(event) => setOnboardingFacilityForm((prev) => ({
                          ...prev,
                          capture_method: event.target.value,
                        }))}
                      >
                        {captureMethodOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="portal-field">
                      <span>{copy.facilityRolePolicyLabel}</span>
                      <select
                        value={onboardingFacilityForm.role_policy}
                        onChange={(event) => setOnboardingFacilityForm((prev) => ({
                          ...prev,
                          role_policy: event.target.value,
                        }))}
                      >
                        {rolePolicyOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {onboardingFacilityNotice ? (
                    <div className={`portal-message ${onboardingFacilityNotice === copy.facilityUpdated ? "portal-success" : "portal-error"}`}>
                      {onboardingFacilityNotice}
                    </div>
                  ) : null}
                  <div className="portal-form-actions">
                    <button
                      className="button primary"
                      type="button"
                      onClick={handleSaveOnboardingFacility}
                      disabled={onboardingFacilitySaving}
                    >
                      {onboardingFacilitySaving ? copy.saving : copy.facilitySaveButton}
                    </button>
                  </div>
                </div>
              ) : null}
              {onboardingCurrentStep.adminOnly && user?.role !== "admin" ? (
                <div className="portal-message">{copy.onboardingAdminNote}</div>
              ) : (
                <div className="onboarding-checklist">
                  <span className="portal-meta">{copy.onboardingChecklistLabel}</span>
                  {onboardingCurrentStep.checks.map((check) => {
                    const isAuto = Boolean(check.autoKey);
                    const isDone = isOnboardingCheckComplete(check);
                    return (
                      <label key={check.id} className={`onboarding-check ${isDone ? "is-done" : ""}`}>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => toggleOnboardingCheck(check.id)}
                          disabled={isAuto}
                        />
                        <span>{check.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {onboardingCurrentStep.actionLabel && (!onboardingCurrentStep.adminOnly || isAdmin) ? (
                <div className="onboarding-actions">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => {
                      handlePanelChange(onboardingCurrentStep.actionPanel);
                      setOnboardingOpen(false);
                    }}
                  >
                    {onboardingCurrentStep.actionLabel}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="onboarding-footer">
              <button
                className="button ghost"
                type="button"
                onClick={() => setOnboardingStepIndex((prev) => Math.max(prev - 1, 0))}
                disabled={onboardingStepIndex === 0}
              >
                {copy.onboardingBack}
              </button>
              <div className="onboarding-footer-actions">
                <button className="button ghost" type="button" onClick={handleOnboardingDismiss}>
                  {copy.onboardingSkip}
                </button>
                {onboardingStepIndex < onboardingSteps.length - 1 ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => setOnboardingStepIndex((prev) => Math.min(prev + 1, onboardingSteps.length - 1))}
                  >
                    {copy.onboardingNext}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    type="button"
                    onClick={handleOnboardingComplete}
                    disabled={!onboardingAllComplete}
                  >
                    {copy.onboardingFinish}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {residentDrawerOpen && selectedResident ? (
        <div className="drawer-overlay" role="dialog" aria-modal="true">
          <button
            className="drawer-backdrop"
            type="button"
            aria-label="Close resident detail"
            onClick={() => setResidentDrawerOpen(false)}
          />
          <div className="drawer-panel portal-drawer-panel" role="document" ref={drawerRef}>
            <div className="drawer-header">
              <div>
                <h3>{copy.residentDrawer}</h3>
                <p className="text-muted">{copy.residentOverview}</p>
              </div>
              <button
                className="button ghost small"
                type="button"
                onClick={() => setResidentDrawerOpen(false)}
              >
                {copy.residentDrawerToggle}
              </button>
            </div>
            <div className="portal-resident-summary portal-drawer-summary">
              <div>
                <span className="portal-meta">{copy.residentLastAssessment}</span>
                <strong>{lastAssessmentDate}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentTotal}</span>
                <strong>{assessments.length}</strong>
              </div>
            </div>
            <div className="portal-resident-info">
              <div>
                <span className="portal-meta">{copy.residentLabelName}</span>
                <strong>{selectedResident.first_name} {selectedResident.last_name}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelDob}</span>
                <strong>{formatDate(selectedResident.dob) || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelAge}</span>
                <strong>{getAge(selectedResident.dob) ?? "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelSex}</span>
                <strong>{selectedResident.sex || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelExternal}</span>
                <strong>{selectedResident.external_id || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelBuilding}</span>
                <strong>{selectedResident.building || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelFloor}</span>
                <strong>{selectedResident.floor || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelUnit}</span>
                <strong>{selectedResident.unit || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelRoom}</span>
                <strong>{selectedResident.room || "--"}</strong>
              </div>
              <div>
                <span className="portal-meta">{copy.residentLabelUnitAssignment}</span>
                <strong>{unitLabelMap[selectedResident.unit_id] || "--"}</strong>
              </div>
            </div>
            {selectedResident.notes ? (
              <div className="portal-notes">
                <span className="portal-meta">{copy.residentLabelNotes}</span>
                <p>{selectedResident.notes}</p>
              </div>
            ) : null}
            <form className="portal-form portal-edit-form" onSubmit={handleUpdateResident}>
              <h4>{copy.residentEditTitle}</h4>
              <div className="portal-edit-grid">
                <div className={`portal-field ${residentEditErrors.first_name ? "has-error" : ""}`}>
                  <label>{copy.residentFirst}</label>
                  <input
                    type="text"
                    value={residentEditForm.first_name}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, first_name: value }));
                      setResidentEditErrors((prev) => ({ ...prev, first_name: "" }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                  {residentEditErrors.first_name ? (
                    <span className="field-error">{residentEditErrors.first_name}</span>
                  ) : null}
                </div>
                <div className={`portal-field ${residentEditErrors.last_name ? "has-error" : ""}`}>
                  <label>{copy.residentLastName}</label>
                  <input
                    type="text"
                    value={residentEditForm.last_name}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, last_name: value }));
                      setResidentEditErrors((prev) => ({ ...prev, last_name: "" }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                  {residentEditErrors.last_name ? (
                    <span className="field-error">{residentEditErrors.last_name}</span>
                  ) : null}
                </div>
                <div className={`portal-field ${residentEditErrors.dob ? "has-error" : ""}`}>
                  <label>{copy.residentDob}</label>
                  <input
                    type="date"
                    value={residentEditForm.dob}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, dob: value }));
                      setResidentEditErrors((prev) => ({ ...prev, dob: "" }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                  {residentEditErrors.dob ? (
                    <span className="field-error">{residentEditErrors.dob}</span>
                  ) : null}
                </div>
                <div className="portal-field">
                  <label>{copy.residentSex}</label>
                  <select
                    value={residentEditForm.sex}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, sex: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  >
                    {sexOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="portal-field">
                  <label>{copy.residentLabelExternal}</label>
                  <input
                    type="text"
                    value={residentEditForm.external_id}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, external_id: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                </div>
                <div className="portal-field">
                  <label>{copy.residentLabelBuilding}</label>
                  <input
                    type="text"
                    value={residentEditForm.building}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, building: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                </div>
                <div className="portal-field">
                  <label>{copy.residentLabelFloor}</label>
                  <input
                    type="text"
                    value={residentEditForm.floor}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, floor: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                </div>
                <div className="portal-field">
                  <label>{copy.residentLabelUnit}</label>
                  <input
                    type="text"
                    value={residentEditForm.unit}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, unit: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                </div>
                <div className="portal-field">
                  <label>{copy.residentLabelRoom}</label>
                  <input
                    type="text"
                    value={residentEditForm.room}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, room: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                </div>
                <div className="portal-field">
                  <label>{copy.residentLabelUnitAssignment}</label>
                  <select
                    value={residentEditForm.unit_id}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, unit_id: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving || unitLoading}
                  >
                    {unitOptions.map((option) => (
                      <option key={option.value || "none"} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="portal-field portal-field-full">
                  <label>{copy.residentLabelNotes}</label>
                  <textarea
                    value={residentEditForm.notes}
                    onChange={(event) => {
                      const value = event.target.value;
                      setResidentEditForm((prev) => ({ ...prev, notes: value }));
                      setResidentEditNotice("");
                    }}
                    disabled={!token || residentEditSaving}
                  />
                </div>
              </div>
              {residentEditNotice ? (
                <div className={`portal-message ${residentEditSuccess ? "portal-success" : "portal-error"}`}>
                  {residentEditNotice}
                </div>
              ) : null}
              <div className="portal-form-actions">
                <button
                  className="button ghost small"
                  type="button"
                  onClick={handleResetResidentEdit}
                  disabled={!token || residentEditSaving}
                >
                  {copy.residentEditReset}
                </button>
                <button
                  className="button primary"
                  type="submit"
                  disabled={!token || residentEditSaving}
                >
                  {residentEditSaving ? copy.saving : copy.residentEditSave}
                </button>
              </div>
            </form>
            <div>
              <h4>{copy.residentHistory}</h4>
              <div className="portal-timeline-filters">
                <div className="portal-field">
                  <label>{copy.filterStatus}</label>
                  <select
                    value={timelineFilters.status}
                    onChange={(event) => setTimelineFilters((prev) => ({ ...prev, status: event.target.value }))}
                  >
                    <option value="all">{copy.filterAll}</option>
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="portal-field">
                  <label>{copy.filterRisk}</label>
                  <select
                    value={timelineFilters.risk}
                    onChange={(event) => setTimelineFilters((prev) => ({ ...prev, risk: event.target.value }))}
                  >
                    <option value="all">{copy.filterAll}</option>
                    {riskOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="portal-field">
                  <label>{copy.filterFrom}</label>
                  <input
                    type="date"
                    value={timelineFilters.from}
                    onChange={(event) => setTimelineFilters((prev) => ({ ...prev, from: event.target.value }))}
                  />
                </div>
                <div className="portal-field">
                  <label>{copy.filterTo}</label>
                  <input
                    type="date"
                    value={timelineFilters.to}
                    onChange={(event) => setTimelineFilters((prev) => ({ ...prev, to: event.target.value }))}
                  />
                </div>
              </div>
              <div className="portal-timeline-actions">
                <button
                  className="button ghost small"
                  type="button"
                  onClick={handleExportAssessments}
                  disabled={!token || filteredTimeline.length === 0}
                >
                  {copy.exportCsv}
                </button>
              </div>
              {assessments.length === 0 ? (
                <div className="portal-message">{copy.residentNone}</div>
              ) : filteredTimeline.length === 0 ? (
                <div className="portal-message">{copy.residentFilterEmpty}</div>
              ) : (
                <div className="portal-timeline">
                  {filteredTimeline.map((assessment) => (
                    <div key={assessment.id} className="portal-timeline-item">
                      <div className="portal-timeline-dot" />
                      <div>
                        <strong>{formatDate(assessment.assessment_date)}</strong>
                        <span>{assessment.assistive_device || "--"}</span>
                        <div className="portal-status">
                          {assessment.status ? (
                            <span className={adminStatusClass[assessment.status] || "status-pill"}>
                              {statusLabelMap[assessment.status] || assessment.status}
                            </span>
                          ) : null}
                          {assessment.risk_tier ? (
                            <span className={adminRiskClass[assessment.risk_tier] || "risk-pill"}>
                              {riskLabelMap[assessment.risk_tier] || assessment.risk_tier}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

function SolutionsPage({ title, eyebrow, summary, highlights, metrics, cta, locale, buildHrefFor, currentPath }) {
  const isEs = locale === "es";
  const steps = isEs ? landingStepsEs : landingSteps;
  const copy = isEs
    ? {
        workflowHeading: "Como encaja en tu flujo",
        workflowBody: "Captura rapida, analisis objetivo y siguientes pasos accionables.",
        ctaTitle: cta.title,
      }
    : {
        workflowHeading: "How it fits into your workflow",
        workflowBody: "Quick capture, objective analysis, and actionable next steps.",
        ctaTitle: cta.title,
      };

  return (
    <Layout locale={locale} buildHrefFor={buildHrefFor} currentPath={currentPath}>
      <section className="hero">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-content">
            <div className="app-badge">
              <span className="app-badge-icon"><AppMark /></span>
              <span>{title}</span>
            </div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{summary.title}</h1>
            <p className="lead">{summary.body}</p>
            <div className="cta-row">
              <button className="button primary" type="button">{cta.primary}</button>
              <button className="button ghost" type="button">{cta.secondary}</button>
            </div>
            <div className="stat-row">
              {metrics.map((stat) => (
                <div key={stat.label} className="stat-card">
                  <span className="stat-number">{stat.value}</span>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-media">
            <div className="workflow-card floating">
              <div className="workflow-header">
                <span>Care workflow</span>
                <span className="media-chip">2-3 min</span>
              </div>
              <div className="workflow-track">
                <div className="workflow-node">Record</div>
                <div className="workflow-node">Assess</div>
                <div className="workflow-node">Plan</div>
                <div className="workflow-node">Document</div>
              </div>
            </div>
            <div className="workflow-card light">
              <h3>Operational clarity</h3>
              <p>Consistent mobility data, shared across care teams and programs.</p>
              <div className="workflow-metrics">
                <div>
                  <span className="metric-label">Reports per day</span>
                  <strong>12-18</strong>
                </div>
                <div>
                  <span className="metric-label">Time saved</span>
                  <strong>3 hrs / week</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>{summary.sectionTitle}</h2>
            <p>{summary.sectionBody}</p>
          </div>
          <div className="grid features-grid">
            {highlights.map((item) => (
              <div key={item.title} className="feature-card">
                <Icon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="section-heading">
            <h2>{copy.workflowHeading}</h2>
            <p>{copy.workflowBody}</p>
          </div>
          <div className="steps-grid">
            {steps.map((step) => (
              <div key={step.title} className="step-card">
                <span className="step-label">{step.label}</span>
                <Icon name={step.icon} />
                <h3>{step.title}</h3>
                <ul>
                  {step.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container callout">
          <div>
            <h2>{cta.title}</h2>
            <p>{cta.body}</p>
          </div>
          <button className="button primary" type="button">{cta.primary}</button>
        </div>
      </section>
    </Layout>
  );
}

const solutionsContent = {
  primaryCare: {
    title: "Primary Care",
    eyebrow: "Solutions for primary care teams",
    summary: {
      title: "Fall risk screening that fits within primary care visits",
      body: "Screen patients quickly, document consistently, and share clear next steps without disrupting tight schedules.",
      sectionTitle: "Support primary care with objective mobility data",
      sectionBody: "StrideSafe provides a consistent, billable workflow for fall risk screening and intervention planning.",
    },
    highlights: [
      { icon: "survey", title: "Quick screening", body: "Capture gait risk in minutes during visits." },
      { icon: "doc", title: "Documentation-ready", body: "Structured summaries for patient charts." },
      { icon: "insights", title: "Risk stratification", body: "Identify high-risk patients quickly." },
    ],
    metrics: [
      { value: "2-3 min", label: "per screening" },
      { value: "14", label: "risk factors tracked" },
      { value: "AWV-ready", label: "workflow fit" },
    ],
    cta: {
      title: "Bring StrideSafe into your practice",
      body: "See how the workflow fits into annual wellness and chronic care visits.",
      primary: "Book a Primary Care Demo",
      secondary: "Download Overview",
    },
  },
  seniorLiving: {
    title: "Senior Living",
    eyebrow: "Solutions for senior living communities",
    summary: {
      title: "Reduce fall risk across your community",
      body: "Standardize screenings, reduce variability, and support proactive care for residents.",
      sectionTitle: "A fall prevention workflow built for senior living",
      sectionBody: "Empower staff to run consistent assessments and track outcomes over time.",
    },
    highlights: [
      { icon: "home", title: "Community-wide monitoring", body: "Scale assessments across campuses." },
      { icon: "target", title: "Risk-focused care", body: "Prioritize residents needing intervention." },
      { icon: "trend", title: "Progress tracking", body: "Monitor changes over time." },
    ],
    metrics: [
      { value: "12-18", label: "assessments per day" },
      { value: "30 sec", label: "capture time" },
      { value: "Multi-site", label: "ready" },
    ],
    cta: {
      title: "Upgrade your fall prevention program",
      body: "See how StrideSafe supports resident safety and staff efficiency.",
      primary: "Schedule a Community Demo",
      secondary: "Talk to Sales",
    },
  },
  homeHealth: {
    title: "Home Health",
    eyebrow: "Solutions for home health teams",
    summary: {
      title: "Objective mobility insights in the home",
      body: "Bring clinical-grade assessments into home visits with a smartphone-only workflow.",
      sectionTitle: "Care at home with measurable outcomes",
      sectionBody: "Capture objective gait data, track progress, and share reports with care teams.",
    },
    highlights: [
      { icon: "phone", title: "Mobile-first", body: "No equipment beyond a phone or tablet." },
      { icon: "insights", title: "Objective measures", body: "Consistent scoring across caregivers." },
      { icon: "doc", title: "Exportable reports", body: "Share insights with physicians and family." },
    ],
    metrics: [
      { value: "HIPAA", label: "aligned" },
      { value: "3", label: "steps per workflow" },
      { value: "2-3 min", label: "total time" },
    ],
    cta: {
      title: "Modernize home health mobility screening",
      body: "Enable faster, more consistent assessments on every visit.",
      primary: "Book a Home Health Demo",
      secondary: "Request Info",
    },
  },
  orthopedics: {
    title: "Orthopedics",
    eyebrow: "Solutions for orthopedic and sports teams",
    summary: {
      title: "Monitor gait recovery with objective data",
      body: "Track rehab progress, document outcomes, and tailor treatment plans without a gait lab.",
      sectionTitle: "Measure recovery with precision",
      sectionBody: "StrideSafe delivers clinical-grade gait parameters to guide orthopedic care.",
    },
    highlights: [
      { icon: "trend", title: "Progress monitoring", body: "Track mobility changes post-op." },
      { icon: "badge", title: "Validated parameters", body: "Clinical-grade gait metrics." },
      { icon: "shield", title: "Documentation support", body: "Support outcomes and compliance." },
    ],
    metrics: [
      { value: "3D", label: "pose tracking" },
      { value: "47+", label: "parameters" },
      { value: "Clinic-ready", label: "reports" },
    ],
    cta: {
      title: "Bring gait lab insight to orthopedics",
      body: "See how StrideSafe supports recovery and outcome tracking.",
      primary: "Book an Ortho Demo",
      secondary: "Talk to Sales",
    },
  },
};

const solutionsContentEs = {
  primaryCare: {
    title: "Atencion primaria",
    eyebrow: "Soluciones para equipos de atencion primaria",
    summary: {
      title: "Evaluacion de riesgo de caidas que cabe en visitas de atencion primaria",
      body: "Evalua pacientes rapidamente, documenta de forma consistente y comparte proximos pasos sin afectar la agenda.",
      sectionTitle: "Apoya la atencion primaria con datos objetivos de movilidad",
      sectionBody: "StrideSafe brinda un flujo consistente y facturable para evaluacion de riesgo e intervencion.",
    },
    highlights: [
      { icon: "survey", title: "Evaluacion rapida", body: "Captura riesgo de marcha en minutos." },
      { icon: "doc", title: "Listo para documentacion", body: "Resumenes estructurados para el expediente." },
      { icon: "insights", title: "Estratificacion de riesgo", body: "Identifica pacientes de alto riesgo rapidamente." },
    ],
    metrics: [
      { value: "2-3 min", label: "por evaluacion" },
      { value: "14", label: "factores de riesgo" },
      { value: "AWV", label: "listo" },
    ],
    cta: {
      title: "Lleva StrideSafe a tu practica",
      body: "Ve como el flujo encaja en visitas de bienestar y cuidado cronico.",
      primary: "Agenda una demo",
      secondary: "Descargar resumen",
    },
  },
  seniorLiving: {
    title: "Residencias para mayores",
    eyebrow: "Soluciones para comunidades de adultos mayores",
    summary: {
      title: "Reduce el riesgo de caidas en toda tu comunidad",
      body: "Estandariza evaluaciones, reduce variabilidad y apoya el cuidado proactivo.",
      sectionTitle: "Un flujo de prevencion para residencias",
      sectionBody: "Empodera al personal para evaluar y seguir resultados con consistencia.",
    },
    highlights: [
      { icon: "home", title: "Monitoreo comunitario", body: "Escala evaluaciones en multiples sedes." },
      { icon: "target", title: "Cuidado enfocado en riesgo", body: "Prioriza residentes que necesitan intervencion." },
      { icon: "trend", title: "Seguimiento de progreso", body: "Monitorea cambios con el tiempo." },
    ],
    metrics: [
      { value: "12-18", label: "evaluaciones por dia" },
      { value: "30 seg", label: "tiempo de captura" },
      { value: "Multi-sitio", label: "listo" },
    ],
    cta: {
      title: "Mejora tu programa de prevencion",
      body: "Ve como StrideSafe apoya seguridad y eficiencia del personal.",
      primary: "Agenda una demo",
      secondary: "Hablar con ventas",
    },
  },
  homeHealth: {
    title: "Salud en el hogar",
    eyebrow: "Soluciones para equipos de salud en el hogar",
    summary: {
      title: "Insights objetivos de movilidad en el hogar",
      body: "Lleva evaluaciones clinicas a visitas en casa con solo un smartphone.",
      sectionTitle: "Cuidado en casa con resultados medibles",
      sectionBody: "Captura datos objetivos, sigue progreso y comparte reportes.",
    },
    highlights: [
      { icon: "phone", title: "Movil primero", body: "Sin equipos mas alla de telefono o tablet." },
      { icon: "insights", title: "Medidas objetivas", body: "Puntuaciones consistentes entre cuidadores." },
      { icon: "doc", title: "Reportes exportables", body: "Comparte insights con medicos y familias." },
    ],
    metrics: [
      { value: "HIPAA", label: "alineado" },
      { value: "3", label: "pasos por flujo" },
      { value: "2-3 min", label: "tiempo total" },
    ],
    cta: {
      title: "Moderniza la evaluacion en el hogar",
      body: "Habilita evaluaciones mas rapidas y consistentes en cada visita.",
      primary: "Agenda una demo",
      secondary: "Solicitar informacion",
    },
  },
  orthopedics: {
    title: "Ortopedia",
    eyebrow: "Soluciones para equipos de ortopedia y deporte",
    summary: {
      title: "Monitorea la recuperacion con datos objetivos",
      body: "Sigue el progreso, documenta resultados y ajusta tratamientos.",
      sectionTitle: "Mide la recuperacion con precision",
      sectionBody: "StrideSafe entrega parametros clinicos para guiar el cuidado.",
    },
    highlights: [
      { icon: "trend", title: "Monitoreo de progreso", body: "Sigue cambios de movilidad post-operatorio." },
      { icon: "badge", title: "Parametros validados", body: "Metricas de marcha de nivel clinico." },
      { icon: "shield", title: "Soporte de documentacion", body: "Respalda resultados y cumplimiento." },
    ],
    metrics: [
      { value: "3D", label: "seguimiento de pose" },
      { value: "47+", label: "parametros" },
      { value: "Clinica", label: "lista" },
    ],
    cta: {
      title: "Lleva insight de laboratorio a ortopedia",
      body: "Ve como StrideSafe apoya recuperacion y resultados.",
      primary: "Agenda una demo",
      secondary: "Hablar con ventas",
    },
  },
};

export default function App() {
  const route = useHashRoute();
  const locale = getLocaleFromRoute(route);
  const normalizedRoute = stripLocaleFromRoute(route, locale);
  const buildHrefFor = (path, targetLocale = locale) => buildHref(path, targetLocale);
  const solutions = locale === "es" ? solutionsContentEs : solutionsContent;

  usePageMeta(locale, normalizedRoute);

  if (normalizedRoute.startsWith("/about")) {
    return (
      <AboutPage
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/admin-review")) {
    return (
      <AdminReviewPage
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/portal")) {
    return (
      <PortalPage
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/pt-workflow")) {
    return (
      <PtWorkflowPage
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/gait-lab")) {
    return (
      <GaitLabPage
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/solutions/primary-care")) {
    return (
      <SolutionsPage
        {...solutions.primaryCare}
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/solutions/senior-living")) {
    return (
      <SolutionsPage
        {...solutions.seniorLiving}
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/solutions/home-health")) {
    return (
      <SolutionsPage
        {...solutions.homeHealth}
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/solutions/orthopedics")) {
    return (
      <SolutionsPage
        {...solutions.orthopedics}
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  if (normalizedRoute.startsWith("/stridesafe-home")) {
    return (
      <StrideSafeHomePage
        locale={locale}
        buildHrefFor={buildHrefFor}
        currentPath={normalizedRoute}
      />
    );
  }

  return (
    <LandingPage
      locale={locale}
      buildHrefFor={buildHrefFor}
      currentPath={normalizedRoute}
    />
  );
}
