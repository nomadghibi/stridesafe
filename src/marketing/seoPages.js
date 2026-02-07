const defaultCompliance = {
  title_en: "Compliance-ready operations",
  title_es: "Operaciones listas para cumplimiento",
  body_en:
    "StrideSafe supports HIPAA-aligned workflows with SOC 2-aligned controls and least-privilege access.",
  body_es:
    "StrideSafe soporta flujos alineados con HIPAA con controles alineados a SOC 2 y acceso por roles.",
  bullets_en: [
    "Role-based access and facility isolation",
    "Audit logs for critical actions",
    "Data minimization and export controls",
  ],
  bullets_es: [
    "Acceso por roles y aislamiento por instalaciones",
    "Logs de auditoria para acciones criticas",
    "Minimizacion de datos y control de exportaciones",
  ],
};

const defaultCta = {
  title_en: "See StrideSafe in your community",
  title_es: "Ve StrideSafe en tu comunidad",
  body_en: "Schedule a demo focused on your fall prevention workflow and staffing model.",
  body_es: "Agenda una demo enfocada en tu flujo de prevencion y modelo de personal.",
  button_en: "Request a Demo",
  button_es: "Solicitar demo",
};

const baseProofPoints = [
  {
    title_en: "2-3 minute assessments",
    title_es: "Evaluaciones de 2-3 minutos",
    body_en: "Capture consistent fall risk screening without adding visit time.",
    body_es: "Captura evaluaciones consistentes sin agregar tiempo a la visita.",
  },
  {
    title_en: "Documentation-ready outputs",
    title_es: "Reportes listos para documentar",
    body_en: "Generate PDF summaries that align with clinical documentation needs.",
    body_es: "Genera resumenes PDF alineados con documentacion clinica.",
  },
  {
    title_en: "Operational visibility",
    title_es: "Visibilidad operativa",
    body_en: "Track overdue screenings and post-fall follow-ups by unit.",
    body_es: "Sigue pendientes y seguimientos post-caida por unidad.",
  },
];

export const seoPages = [
  {
    slug: "/fall-risk-assessment-software-senior-living",
    navLabel_en: "Fall Risk Software",
    navLabel_es: "Software de caidas",
    primaryKeyword: "Fall Risk Assessment Software for Senior Living",
    secondaryKeywords: [
      "Senior living fall risk assessment",
      "Fall prevention workflows",
      "Resident risk stratification",
    ],
    title_en: "Fall Risk Assessment Software for Senior Living | StrideSafe",
    description_en:
      "Standardize fall risk screening, documentation, and outcomes reporting across senior living communities.",
    title_es: "Software de evaluacion de riesgo de caidas | StrideSafe",
    description_es:
      "Estandariza evaluaciones, documentacion y reportes de resultados en residencias para mayores.",
    h1_en: "Fall Risk Assessment Software for Senior Living",
    h1_es: "Software de evaluacion de riesgo de caidas para residencias",
    lead_en:
      "StrideSafe helps senior living teams run consistent fall risk assessments, stratify residents, and document care plans in minutes.",
    lead_es:
      "StrideSafe ayuda a equipos de residencias a evaluar riesgo, estratificar y documentar planes en minutos.",
    problem_en:
      "Falls drive clinical risk, liability, and resident outcomes. Standardize assessment workflows so every resident receives consistent screening and follow-up.",
    problem_es:
      "Las caidas aumentan riesgo clinico y responsabilidades. Estandariza evaluaciones para asegurar seguimiento consistente.",
    workflow_en:
      "Use a repeatable workflow from capture to documentation without adding staff burden.",
    workflow_es:
      "Usa un flujo repetible desde captura hasta documentacion sin sobrecargar al equipo.",
    workflow_bullets_en: [
      "Capture video or enter TUG, chair stand, and balance",
      "Auto-score risk tier with clinical context",
      "Generate post-fall checklists and PDF reports",
    ],
    workflow_bullets_es: [
      "Captura video o registra TUG, chair stand y balance",
      "Auto-puntua riesgo con contexto clinico",
      "Genera checklist post-caida y reportes PDF",
    ],
    proof_en: "Measure outcomes and keep leadership informed.",
    proof_es: "Mide resultados y mantén informada a la gerencia.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    faq: [
      {
        q_en: "Does StrideSafe replace existing fall prevention programs?",
        a_en: "No. It standardizes screening and documentation so your current program runs consistently.",
        q_es: "StrideSafe reemplaza programas existentes?",
        a_es: "No. Estandariza evaluacion y documentacion para que tu programa funcione con consistencia.",
      },
      {
        q_en: "Can teams track post-fall follow-ups?",
        a_en: "Yes. Workflow queues and checklists help track due and overdue follow-ups.",
        q_es: "Se pueden seguir seguimientos post-caida?",
        a_es: "Si. Las colas y checklists ayudan a seguir pendientes y vencidos.",
      },
    ],
  },
  {
    slug: "/fall-prevention-assisted-living",
    navLabel_en: "Assisted Living",
    navLabel_es: "Vida asistida",
    primaryKeyword: "Fall Prevention Program Platform for Assisted Living",
    secondaryKeywords: ["Assisted living fall prevention", "Resident mobility screening"],
    title_en: "Fall Prevention for Assisted Living Communities | StrideSafe",
    description_en:
      "Deliver consistent fall risk screening, documentation, and proactive care planning across assisted living teams.",
    title_es: "Prevencion de caidas en vida asistida | StrideSafe",
    description_es:
      "Evaluaciones consistentes, documentacion y planes proactivos para equipos de vida asistida.",
    h1_en: "Fall Prevention for Assisted Living Communities",
    h1_es: "Prevencion de caidas para comunidades de vida asistida",
    lead_en:
      "Support independence with standardized mobility screening and clear next steps for residents who need extra support.",
    lead_es:
      "Apoya la independencia con evaluaciones estandarizadas y pasos claros para residentes con riesgo.",
    problem_en:
      "Assisted living teams need consistent screening to keep residents safe while preserving independence.",
    problem_es:
      "Los equipos de vida asistida necesitan evaluaciones consistentes para mantener seguridad e independencia.",
    workflow_en:
      "Run quick screenings, document outcomes, and set follow-up cadence for residents who need support.",
    workflow_es:
      "Ejecuta evaluaciones rapidas, documenta resultados y define seguimiento para residentes en riesgo.",
    workflow_bullets_en: [
      "Capture gait screening during routine visits",
      "Generate risk tier and care plan summary",
      "Schedule follow-up assessments by unit",
    ],
    workflow_bullets_es: [
      "Captura evaluacion de marcha en visitas rutinarias",
      "Genera riesgo y resumen de plan de cuidado",
      "Agenda reevaluaciones por unidad",
    ],
    proof_en: "Keep leadership informed with unit-level rollups.",
    proof_es: "Informa liderazgo con rollups por unidad.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/resident-fall-risk-profiles",
      "/post-fall-assessment-documentation",
      "/risk-stratification-care-pathways",
    ],
  },
  {
    slug: "/fall-prevention-skilled-nursing-facilities",
    navLabel_en: "Skilled Nursing",
    navLabel_es: "SNF",
    primaryKeyword: "Fall Prevention for Skilled Nursing Facilities (SNF)",
    secondaryKeywords: ["SNF fall prevention", "Skilled nursing documentation"],
    title_en: "Fall Prevention for Skilled Nursing Facilities | StrideSafe",
    description_en:
      "Standardize fall risk assessments, post-fall documentation, and outcomes reporting for SNF teams.",
    title_es: "Prevencion de caidas para SNF | StrideSafe",
    description_es:
      "Estandariza evaluaciones, documentacion post-caida y reportes para equipos SNF.",
    h1_en: "Fall Prevention for Skilled Nursing Facilities",
    h1_es: "Prevencion de caidas para centros de enfermeria especializada",
    lead_en:
      "High-acuity environments need defensible documentation and consistent workflows. StrideSafe keeps teams aligned.",
    lead_es:
      "Entornos de alta complejidad requieren documentacion defendible y flujos consistentes.",
    problem_en:
      "SNF teams face higher acuity, regulatory scrutiny, and tighter documentation requirements.",
    problem_es:
      "Los equipos SNF enfrentan mayor complejidad clinica y exigencias regulatorias.",
    workflow_en:
      "Capture standardized screenings and generate documentation-ready reports for clinical oversight.",
    workflow_es:
      "Captura evaluaciones estandarizadas y genera reportes listos para documentacion.",
    workflow_bullets_en: [
      "Standardize TUG, chair stand, and balance capture",
      "Generate post-fall checklists and incident summaries",
      "Track compliance with SLA-ready queues",
    ],
    workflow_bullets_es: [
      "Estandariza TUG, chair stand y balance",
      "Genera checklist post-caida y resumenes de incidentes",
      "Sigue cumplimiento con colas y SLA",
    ],
    proof_en: "Provide leadership-ready reporting across shifts and units.",
    proof_es: "Entrega reportes para liderazgo por turnos y unidades.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/post-fall-assessment-documentation",
      "/workflow-queue-sla",
      "/audit-logs-incident-timeline",
    ],
  },
  {
    slug: "/fall-prevention-memory-care",
    navLabel_en: "Memory Care",
    navLabel_es: "Memoria",
    primaryKeyword: "Fall Prevention for Memory Care",
    secondaryKeywords: ["Memory care fall prevention", "Cognitive impairment safety"],
    title_en: "Fall Prevention for Memory Care | StrideSafe",
    description_en:
      "Support memory care teams with structured fall risk screening, post-fall documentation, and care plans.",
    title_es: "Prevencion de caidas en cuidado de memoria | StrideSafe",
    description_es:
      "Apoya equipos de memoria con evaluacion estructurada, documentacion y planes de cuidado.",
    h1_en: "Fall Prevention for Memory Care",
    h1_es: "Prevencion de caidas para cuidado de memoria",
    lead_en:
      "Memory care requires proactive monitoring and clear documentation. StrideSafe keeps teams aligned.",
    lead_es:
      "El cuidado de memoria requiere monitoreo proactivo y documentacion clara.",
    problem_en:
      "Residents with cognitive impairment need frequent monitoring and consistent follow-up.",
    problem_es:
      "Residentes con deterioro cognitivo requieren monitoreo frecuente y seguimiento consistente.",
    workflow_en:
      "Capture mobility screening, document incidents, and assign follow-ups in one workflow.",
    workflow_es:
      "Captura movilidad, documenta incidentes y asigna seguimientos en un solo flujo.",
    workflow_bullets_en: [
      "Consistent screening with minimal staff time",
      "Post-fall checklist for safety protocols",
      "Resident-level profiles to monitor change",
    ],
    workflow_bullets_es: [
      "Evaluaciones consistentes con poco tiempo",
      "Checklist post-caida para protocolos de seguridad",
      "Perfiles por residente para monitorear cambios",
    ],
    proof_en: "Align caregivers, nurses, and leadership around the same data.",
    proof_es: "Alinea cuidadores, enfermeria y liderazgo con los mismos datos.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/resident-fall-risk-profiles",
      "/post-fall-assessment-documentation",
      "/audit-logs-incident-timeline",
    ],
  },
  {
    slug: "/post-fall-assessment-documentation",
    navLabel_en: "Post-fall Documentation",
    navLabel_es: "Documentacion post-caida",
    primaryKeyword: "Post-Fall Assessment + Care Plan Documentation",
    secondaryKeywords: ["Post-fall checklist", "Incident documentation"],
    title_en: "Post-Fall Assessment Documentation | StrideSafe",
    description_en:
      "Standardize post-fall documentation, checklists, and follow-up workflows for senior living teams.",
    title_es: "Documentacion post-caida | StrideSafe",
    description_es:
      "Estandariza documentacion post-caida, checklists y seguimientos para residencias.",
    h1_en: "Post-Fall Assessment and Documentation",
    h1_es: "Evaluacion y documentacion post-caida",
    lead_en:
      "Capture incidents fast, document follow-ups, and produce audit-ready summaries for leadership.",
    lead_es:
      "Registra incidentes rapido, documenta seguimientos y genera resumenes listos para auditoria.",
    problem_en:
      "Post-fall workflows are often inconsistent across shifts and teams.",
    problem_es:
      "Los flujos post-caida suelen ser inconsistentes entre turnos y equipos.",
    workflow_en:
      "Move from incident intake to follow-up documentation with a structured checklist.",
    workflow_es:
      "Pasa de la captura del incidente a la documentacion con checklist estructurado.",
    workflow_bullets_en: [
      "Log incident details and suspected factors",
      "Complete post-fall checklist and follow-up assessment",
      "Attach documentation-ready PDF summaries",
    ],
    workflow_bullets_es: [
      "Registra detalles y factores sospechados",
      "Completa checklist y reevaluacion",
      "Adjunta resumenes PDF listos",
    ],
    proof_en: "Ensure every incident has complete documentation and follow-up status.",
    proof_es: "Asegura documentacion completa y seguimiento en cada incidente.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    faq: [
      {
        q_en: "Can we track checklist completion by staff?",
        a_en: "Yes. Each checklist item captures completion status and timestamps.",
        q_es: "Se puede seguir la finalizacion por personal?",
        a_es: "Si. Cada item captura estado y timestamp.",
      },
      {
        q_en: "Does this replace incident reporting tools?",
        a_en: "StrideSafe complements incident systems with assessment documentation and follow-up tracking.",
        q_es: "Esto reemplaza herramientas de incidentes?",
        a_es: "StrideSafe complementa sistemas de incidentes con documentacion y seguimiento.",
      },
    ],
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/audit-logs-incident-timeline",
      "/workflow-queue-sla",
      "/fall-reduction-outcomes-qapi-dashboard",
    ],
  },
  {
    slug: "/gait-mobility-screening-senior-living",
    navLabel_en: "Gait Screening",
    navLabel_es: "Screening de marcha",
    primaryKeyword: "Gait & Mobility Screening for Senior Living (TUG, chair stand, balance)",
    secondaryKeywords: ["TUG chair stand balance", "Mobility screening"],
    title_en: "Gait and Mobility Screening for Senior Living | StrideSafe",
    description_en:
      "Run consistent TUG, chair stand, and balance screening to identify fall risk early.",
    title_es: "Screening de marcha y movilidad | StrideSafe",
    description_es:
      "Realiza TUG, chair stand y balance de forma consistente para identificar riesgo temprano.",
    h1_en: "Gait and Mobility Screening for Senior Living",
    h1_es: "Screening de marcha y movilidad para residencias",
    lead_en:
      "Capture standardized gait and mobility testing with clear scoring and documentation-ready outputs.",
    lead_es:
      "Captura pruebas estandarizadas con puntuacion clara y salidas listas para documentacion.",
    problem_en:
      "Inconsistent capture makes it hard to compare risk across residents or over time.",
    problem_es:
      "La captura inconsistente dificulta comparar riesgo entre residentes o en el tiempo.",
    workflow_en:
      "Standardize TUG, chair stand, and balance with consistent scoring guidance.",
    workflow_es:
      "Estandariza TUG, chair stand y balance con guia de puntuacion consistente.",
    workflow_bullets_en: [
      "Record video or enter results from standardized tests",
      "Auto-calc risk tiers and flag changes",
      "Generate PDF summaries for charts and families",
    ],
    workflow_bullets_es: [
      "Graba video o ingresa resultados de pruebas",
      "Auto-calcula riesgo y cambios",
      "Genera resumenes PDF para expedientes",
    ],
    proof_en: "Improve consistency across staff and shifts.",
    proof_es: "Mejora la consistencia entre personal y turnos.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    faq: [
      {
        q_en: "Which tests are supported?",
        a_en: "StrideSafe supports TUG, chair stand, and balance screening workflows.",
        q_es: "Que pruebas se soportan?",
        a_es: "StrideSafe soporta TUG, chair stand y balance.",
      },
    ],
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/risk-stratification-care-pathways",
      "/resident-fall-risk-profiles",
      "/pdf-reports-family-stakeholders",
    ],
  },
  {
    slug: "/fall-reduction-outcomes-qapi-dashboard",
    navLabel_en: "QAPI Dashboard",
    navLabel_es: "Dashboard QAPI",
    primaryKeyword: "Outcomes & Quality Reporting for Fall Reduction (QAPI / dashboards)",
    secondaryKeywords: ["Fall reduction dashboard", "QAPI reporting"],
    title_en: "Fall Reduction Outcomes and QAPI Dashboard | StrideSafe",
    description_en:
      "Track fall reduction outcomes, SLA compliance, and unit-level performance with QAPI-ready dashboards.",
    title_es: "Resultados de reduccion de caidas y QAPI | StrideSafe",
    description_es:
      "Sigue resultados de caidas, cumplimiento SLA y desempeño por unidad con dashboards QAPI.",
    h1_en: "Fall Reduction Outcomes and QAPI Dashboard",
    h1_es: "Resultados de reduccion de caidas y dashboard QAPI",
    lead_en:
      "Give leadership a clear view of fall reduction progress with operational and clinical metrics.",
    lead_es:
      "Entrega a liderazgo una vista clara del progreso con metricas operativas y clinicas.",
    problem_en:
      "Leadership needs measurable outcomes to justify program investment and compliance.",
    problem_es:
      "Liderazgo necesita resultados medibles para justificar programas y cumplimiento.",
    workflow_en:
      "Aggregate screening and post-fall data into unit-level performance views.",
    workflow_es:
      "Agrega datos de evaluacion y post-caida en vistas por unidad.",
    workflow_bullets_en: [
      "Track fall rates and follow-up compliance",
      "Compare units, shifts, or campuses",
      "Export summaries for QAPI meetings",
    ],
    workflow_bullets_es: [
      "Sigue tasa de caidas y cumplimiento de seguimiento",
      "Compara unidades, turnos o sedes",
      "Exporta resumenes para reuniones QAPI",
    ],
    proof_en: "Make outcomes visible for leadership and compliance teams.",
    proof_es: "Haz visibles resultados para liderazgo y cumplimiento.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/exports-scheduled-bundles",
      "/workflow-queue-sla",
      "/audit-logs-incident-timeline",
    ],
  },
  {
    slug: "/risk-stratification-care-pathways",
    navLabel_en: "Risk Stratification",
    navLabel_es: "Estratificacion",
    primaryKeyword: "Risk stratification & care pathways",
    secondaryKeywords: ["Care pathways", "Risk tiers"],
    title_en: "Risk Stratification and Care Pathways | StrideSafe",
    description_en:
      "Standardize fall risk tiers and trigger care pathways for residents who need intervention.",
    title_es: "Estratificacion de riesgo y rutas de cuidado | StrideSafe",
    description_es:
      "Estandariza niveles de riesgo y activa rutas de cuidado para residentes con intervencion.",
    h1_en: "Risk Stratification and Care Pathways",
    h1_es: "Estratificacion de riesgo y rutas de cuidado",
    lead_en:
      "Translate screening results into consistent care pathways for nursing, therapy, and wellness teams.",
    lead_es:
      "Convierte resultados en rutas de cuidado consistentes para enfermeria y terapia.",
    problem_en:
      "Without standardized risk tiers, interventions vary by staff and shift.",
    problem_es:
      "Sin niveles estandarizados, las intervenciones varian por personal y turno.",
    workflow_en:
      "Assign low, moderate, or high risk tiers and align interventions to each tier.",
    workflow_es:
      "Asigna niveles de riesgo y alinea intervenciones para cada nivel.",
    workflow_bullets_en: [
      "Auto-calculate risk tiers from screening",
      "Map interventions to risk level",
      "Track follow-up timing",
    ],
    workflow_bullets_es: [
      "Auto-calcula niveles de riesgo",
      "Relaciona intervenciones por nivel",
      "Sigue tiempos de seguimiento",
    ],
    proof_en: "Keep care pathways consistent across teams.",
    proof_es: "Mantiene rutas de cuidado consistentes entre equipos.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/resident-fall-risk-profiles",
      "/gait-mobility-screening-senior-living",
      "/post-fall-assessment-documentation",
    ],
  },
  {
    slug: "/resident-fall-risk-profiles",
    navLabel_en: "Resident Profiles",
    navLabel_es: "Perfiles de residente",
    primaryKeyword: "Resident-level fall risk profile",
    secondaryKeywords: ["Resident profile", "Fall risk history"],
    title_en: "Resident Fall Risk Profiles | StrideSafe",
    description_en:
      "Maintain resident-level risk profiles with assessment history, risk tiers, and documentation.",
    title_es: "Perfiles de riesgo por residente | StrideSafe",
    description_es:
      "Mantiene perfiles por residente con historial, niveles de riesgo y documentacion.",
    h1_en: "Resident Fall Risk Profiles",
    h1_es: "Perfiles de riesgo por residente",
    lead_en:
      "Give staff a single view of resident risk, assessment history, and follow-up actions.",
    lead_es:
      "Entrega al personal una vista unica de riesgo, historial y acciones de seguimiento.",
    problem_en:
      "Resident risk details are often scattered across notes and systems.",
    problem_es:
      "Los detalles de riesgo suelen estar dispersos en notas y sistemas.",
    workflow_en:
      "Centralize assessments, incidents, and care plans in a single resident profile.",
    workflow_es:
      "Centraliza evaluaciones, incidentes y planes en un solo perfil.",
    workflow_bullets_en: [
      "Timeline of assessments and incidents",
      "Risk tier history and changes",
      "Documentation-ready summaries",
    ],
    workflow_bullets_es: [
      "Linea de tiempo de evaluaciones e incidentes",
      "Historial de niveles de riesgo",
      "Resumenes listos para documentacion",
    ],
    proof_en: "Keep clinicians and leadership aligned on resident status.",
    proof_es: "Mantiene alineados a clinicos y liderazgo sobre el estado.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/risk-stratification-care-pathways",
      "/pdf-reports-family-stakeholders",
      "/audit-logs-incident-timeline",
    ],
  },
  {
    slug: "/workflow-queue-sla",
    navLabel_en: "Workflow Queue",
    navLabel_es: "Cola de trabajo",
    primaryKeyword: "Staff workflows (nurse, PT/OT, wellness director)",
    secondaryKeywords: ["Workflow queue", "SLA tracking"],
    title_en: "Workflow Queue and SLA Tracking | StrideSafe",
    description_en:
      "Prioritize due and overdue screenings with a workflow queue designed for senior living teams.",
    title_es: "Cola de trabajo y SLA | StrideSafe",
    description_es:
      "Prioriza evaluaciones pendientes con una cola de trabajo para residencias.",
    h1_en: "Workflow Queue and SLA Tracking",
    h1_es: "Cola de trabajo y seguimiento SLA",
    lead_en:
      "Make it easy for nurses, PT/OT, and wellness directors to see what is due next.",
    lead_es:
      "Facilita a enfermeria y terapia ver lo que sigue.",
    problem_en:
      "Without a queue, screenings and follow-ups can be delayed or missed.",
    problem_es:
      "Sin cola, evaluaciones y seguimientos se retrasan o se pierden.",
    workflow_en:
      "Use due dates, status, and assignment to keep workloads on track.",
    workflow_es:
      "Usa fechas, estado y asignacion para mantener el trabajo al dia.",
    workflow_bullets_en: [
      "Filter by due, overdue, or assigned staff",
      "Claim and complete tasks with audit logging",
      "Surface post-fall follow-ups",
    ],
    workflow_bullets_es: [
      "Filtra por vencido o asignado",
      "Reclama y completa tareas con auditoria",
      "Muestra seguimientos post-caida",
    ],
    proof_en: "Keep SLA performance visible by unit or role.",
    proof_es: "Mantiene visible el cumplimiento SLA por unidad o rol.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/post-fall-assessment-documentation",
      "/audit-logs-incident-timeline",
      "/fall-reduction-outcomes-qapi-dashboard",
    ],
  },
  {
    slug: "/audit-logs-incident-timeline",
    navLabel_en: "Audit Logs",
    navLabel_es: "Auditoria",
    primaryKeyword: "Audit logs + incident timeline",
    secondaryKeywords: ["Incident timeline", "Audit trail"],
    title_en: "Audit Logs and Incident Timeline | StrideSafe",
    description_en:
      "Track incidents, assessments, and user actions with audit-ready logs.",
    title_es: "Logs de auditoria e incidentes | StrideSafe",
    description_es:
      "Sigue incidentes, evaluaciones y acciones con logs listos para auditoria.",
    h1_en: "Audit Logs and Incident Timeline",
    h1_es: "Logs de auditoria y linea de incidentes",
    lead_en:
      "Maintain a defensible record of who did what and when across fall prevention workflows.",
    lead_es:
      "Mantiene un registro defendible de acciones y tiempos en flujos de caidas.",
    problem_en:
      "Audit readiness requires a clear timeline of incidents, assessments, and follow-ups.",
    problem_es:
      "La auditoria requiere una linea clara de incidentes, evaluaciones y seguimientos.",
    workflow_en:
      "Log critical actions automatically as teams complete screenings and reports.",
    workflow_es:
      "Registra acciones criticas automaticamente mientras el equipo completa evaluaciones.",
    workflow_bullets_en: [
      "Incident creation and updates",
      "Checklist completion timestamps",
      "Report generation and export tracking",
    ],
    workflow_bullets_es: [
      "Creacion y actualizacion de incidentes",
      "Timestamps de checklist",
      "Generacion de reportes y exportaciones",
    ],
    proof_en: "Provide a clear incident timeline for compliance reviews.",
    proof_es: "Proporciona una linea clara para revisiones de cumplimiento.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/post-fall-assessment-documentation",
      "/workflow-queue-sla",
      "/resident-fall-risk-profiles",
    ],
  },
  {
    slug: "/pdf-reports-family-stakeholders",
    navLabel_en: "PDF Reports",
    navLabel_es: "Reportes PDF",
    primaryKeyword: "Family/stakeholder reporting PDFs",
    secondaryKeywords: ["PDF reports", "Family updates"],
    title_en: "PDF Reports for Families and Stakeholders | StrideSafe",
    description_en:
      "Generate clear PDF summaries for care teams, families, and leadership.",
    title_es: "Reportes PDF para familias | StrideSafe",
    description_es:
      "Genera resumenes PDF claros para equipos, familias y liderazgo.",
    h1_en: "PDF Reports for Families and Stakeholders",
    h1_es: "Reportes PDF para familias y partes interesadas",
    lead_en:
      "Deliver documentation-ready summaries that are easy to share and understand.",
    lead_es:
      "Entrega resumenes listos para compartir y faciles de entender.",
    problem_en:
      "Teams need a standardized format to communicate risk and next steps.",
    problem_es:
      "Los equipos necesitan un formato estandar para comunicar riesgo y pasos.",
    workflow_en:
      "Generate PDF summaries after every assessment or post-fall workflow.",
    workflow_es:
      "Genera resumenes PDF despues de cada evaluacion o post-caida.",
    workflow_bullets_en: [
      "Risk tier, scores, and observations",
      "Care plan recommendations",
      "Shareable format for families",
    ],
    workflow_bullets_es: [
      "Nivel de riesgo, puntajes y observaciones",
      "Recomendaciones de plan de cuidado",
      "Formato compartible para familias",
    ],
    proof_en: "Keep stakeholders aligned with a single source of truth.",
    proof_es: "Mantiene alineados a todos con una sola fuente.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/resident-fall-risk-profiles",
      "/gait-mobility-screening-senior-living",
      "/exports-scheduled-bundles",
    ],
  },
  {
    slug: "/exports-scheduled-bundles",
    navLabel_en: "Exports",
    navLabel_es: "Exportaciones",
    primaryKeyword: "Exports scheduled bundles",
    secondaryKeywords: ["CSV exports", "Scheduled reports"],
    title_en: "Scheduled Exports and Bundles | StrideSafe",
    description_en:
      "Deliver scheduled PDF and CSV exports for leadership, compliance, and analytics.",
    title_es: "Exportaciones programadas | StrideSafe",
    description_es:
      "Entrega exportaciones programadas en PDF y CSV para liderazgo y cumplimiento.",
    h1_en: "Scheduled Exports and Bundles",
    h1_es: "Exportaciones y paquetes programados",
    lead_en:
      "Export consistent datasets and documentation bundles for leadership reviews.",
    lead_es:
      "Exporta conjuntos de datos y paquetes de documentacion consistentes.",
    problem_en:
      "Manual reporting slows down QAPI and leadership reviews.",
    problem_es:
      "Los reportes manuales retrasan revisiones QAPI y liderazgo.",
    workflow_en:
      "Schedule exports to deliver the right data on time.",
    workflow_es:
      "Programa exportaciones para entregar datos a tiempo.",
    workflow_bullets_en: [
      "Token-secured export links",
      "CSV summaries for analytics",
      "PDF bundles for documentation",
    ],
    workflow_bullets_es: [
      "Links de exportacion con token",
      "Resumenes CSV para analitica",
      "Paquetes PDF para documentacion",
    ],
    proof_en: "Reduce manual reporting workload for admin teams.",
    proof_es: "Reduce carga manual de reportes para administracion.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/fall-reduction-outcomes-qapi-dashboard",
      "/integrations-ehr-incident-management",
      "/pdf-reports-family-stakeholders",
    ],
  },
  {
    slug: "/integrations-ehr-incident-management",
    navLabel_en: "Integrations",
    navLabel_es: "Integraciones",
    primaryKeyword: "Integrations (EHR/EMR, incident management)",
    secondaryKeywords: ["Integration ready", "EHR export"],
    title_en: "Integrations for EHR and Incident Management | StrideSafe",
    description_en:
      "Export data to support EHR and incident management workflows with integration-ready bundles.",
    title_es: "Integraciones con EHR e incidentes | StrideSafe",
    description_es:
      "Exporta datos para flujos EHR e incidentes con paquetes listos para integrar.",
    h1_en: "Integrations for EHR and Incident Management",
    h1_es: "Integraciones con EHR y gestion de incidentes",
    lead_en:
      "StrideSafe provides export and integration-ready workflows for connecting with existing systems.",
    lead_es:
      "StrideSafe ofrece exportaciones y flujos listos para integrar con sistemas existentes.",
    problem_en:
      "Care teams need data to flow into EHR and incident systems without extra work.",
    problem_es:
      "Los equipos necesitan que los datos fluyan a EHR y sistemas de incidentes sin trabajo extra.",
    workflow_en:
      "Use secure exports and standardized bundles to connect to downstream systems.",
    workflow_es:
      "Usa exportaciones seguras y paquetes estandarizados para conectar sistemas.",
    workflow_bullets_en: [
      "PDF and CSV export bundles",
      "Integration-ready schemas",
      "Audit logs to confirm delivery",
    ],
    workflow_bullets_es: [
      "Paquetes PDF y CSV",
      "Esquemas listos para integrar",
      "Logs para confirmar entrega",
    ],
    proof_en: "Reduce manual transcription and keep systems aligned.",
    proof_es: "Reduce transcripcion manual y mantiene sistemas alineados.",
    proof_points: baseProofPoints,
    compliance: defaultCompliance,
    cta: defaultCta,
    related: [
      "/fall-risk-assessment-software-senior-living",
      "/exports-scheduled-bundles",
      "/audit-logs-incident-timeline",
      "/fall-reduction-outcomes-qapi-dashboard",
    ],
  },
];

export const seoPagesBySlug = Object.fromEntries(seoPages.map((page) => [page.slug, page]));

export const seoPageSlugs = seoPages.map((page) => page.slug);

export const hubSlug = "/fall-risk-assessment-software-senior-living";
