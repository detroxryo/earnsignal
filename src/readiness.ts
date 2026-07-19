import type { AppBindings } from "./env";

export type ReadinessState =
  | "ACTIVE"
  | "READY_TO_ENABLE"
  | "HUMAN_ACTION_REQUIRED"
  | "DEGRADED"
  | "MISCONFIGURED";

export interface ReadinessCheck {
  id: string;
  ready: boolean;
  owner: "SYSTEM" | "OPERATOR" | "HUMAN";
  action: string;
  observedAt?: string;
  maxAgeMinutes?: number;
  latestAttemptAt?: string;
  latestAttemptStartedAt?: string;
  latestAttemptFinishedAt?: string;
  latestAttemptStatus?: CronRunStatus;
}

export type CronRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface ReadinessTrack {
  state: ReadinessState;
  ready: boolean;
  checks: ReadinessCheck[];
}

export interface ReadinessEvidence {
  databaseReady: boolean;
  grantStatus?: string;
  txoddsStatus?: string;
  txlineCapturedEvents: number;
  latestHourlyCronSucceededAt?: string;
  latestHourlyCronAttemptAt?: string;
  latestHourlyCronAttemptStartedAt?: string;
  latestHourlyCronAttemptFinishedAt?: string;
  latestHourlyCronAttemptStatus?: CronRunStatus;
  latestDailyCronSucceededAt?: string;
  latestDailyCronAttemptAt?: string;
  latestDailyCronAttemptStartedAt?: string;
  latestDailyCronAttemptFinishedAt?: string;
  latestDailyCronAttemptStatus?: CronRunStatus;
  latestReportSnapshotCreatedAt?: string;
  now?: Date;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const MINUTE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 5 * MINUTE_MS;
const HOURLY_CRON_MAX_AGE_MINUTES = 120;
const DAILY_AUTOMATION_MAX_AGE_MINUTES = 26 * 60;
const CRON_RUNNING_MAX_AGE_MINUTES = 15;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function trackState(enabled: boolean, checks: ReadinessCheck[]): ReadinessState {
  const prerequisitesReady = checks
    .filter((check) => check.id !== "enabled")
    .every((check) => check.ready);
  if (enabled && prerequisitesReady) return "ACTIVE";
  if (enabled && !prerequisitesReady) return "MISCONFIGURED";
  return prerequisitesReady ? "READY_TO_ENABLE" : "HUMAN_ACTION_REQUIRED";
}

function submitted(status: string | undefined): boolean {
  return status === "SUBMITTED" || status === "WON" || status === "PAID";
}

function isFresh(
  observedAt: string | undefined,
  now: Date,
  maxAgeMinutes: number,
): boolean {
  if (!observedAt) return false;
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) return false;
  const ageMs = now.getTime() - observedTime;
  return ageMs >= -MAX_FUTURE_SKEW_MS && ageMs <= maxAgeMinutes * MINUTE_MS;
}

function cronAutomationCheck(
  id: string,
  observedAt: string | undefined,
  latestAttemptAt: string | undefined,
  latestAttemptStartedAt: string | undefined,
  latestAttemptFinishedAt: string | undefined,
  latestAttemptStatus: CronRunStatus | undefined,
  now: Date,
  maxAgeMinutes: number,
  action: string,
): ReadinessCheck {
  const latestAttemptTime = latestAttemptAt ? Date.parse(latestAttemptAt) : Number.NaN;
  const latestAttemptStartedTime = latestAttemptStartedAt
    ? Date.parse(latestAttemptStartedAt)
    : latestAttemptTime;
  const latestAttemptAgeMs = now.getTime() - latestAttemptStartedTime;
  const latestAttemptValid = Number.isFinite(latestAttemptTime)
    && Number.isFinite(latestAttemptStartedTime)
    && now.getTime() - latestAttemptTime >= -MAX_FUTURE_SKEW_MS
    && latestAttemptAgeMs >= -MAX_FUTURE_SKEW_MS;
  const latestAttemptHealthy = latestAttemptValid
    && (latestAttemptStatus === "SUCCEEDED"
      || (latestAttemptStatus === "RUNNING"
        && latestAttemptAgeMs <= CRON_RUNNING_MAX_AGE_MINUTES * MINUTE_MS));
  const resolvedAction = latestAttemptStatus === "FAILED"
    ? "Inspect the latest failed Cron Event and its structured Worker logs before retrying."
    : latestAttemptStatus === "RUNNING" && !latestAttemptHealthy
      ? "Inspect the long-running Cron Event and diagnose the task before retrying."
      : action;
  return {
    id,
    ready: isFresh(observedAt, now, maxAgeMinutes) && latestAttemptHealthy,
    owner: "OPERATOR",
    action: resolvedAction,
    observedAt,
    maxAgeMinutes,
    latestAttemptAt,
    latestAttemptStartedAt,
    latestAttemptFinishedAt,
    latestAttemptStatus,
  };
}

function freshnessCheck(
  id: string,
  observedAt: string | undefined,
  now: Date,
  maxAgeMinutes: number,
  action: string,
): ReadinessCheck {
  return {
    id,
    ready: isFresh(observedAt, now, maxAgeMinutes),
    owner: "OPERATOR",
    action,
    observedAt,
    maxAgeMinutes,
  };
}

export function buildReadiness(env: AppBindings, evidence: ReadinessEvidence): {
  generatedAt: string;
  environment: string;
  secretsExposed: false;
  core: ReadinessTrack;
  automation: ReadinessTrack;
  x402: ReadinessTrack;
  txline: ReadinessTrack;
  submissions: ReadinessTrack;
  nextHumanActions: string[];
  nextOperatorActions: string[];
} {
  const now = evidence.now ?? new Date();
  const production = env.APP_ENV === "production";
  const receiverValid = SOLANA_ADDRESS.test(env.X402_RECEIVER_ADDRESS?.trim() ?? "");
  const cdpRequired = env.FACILITATOR_URL.includes("api.cdp.coinbase.com");
  const facilitatorReady = !cdpRequired
    || (present(env.CDP_API_KEY_ID) && present(env.CDP_API_KEY_SECRET));
  const paymentsEnabled = env.PAYMENTS_ENABLED === "true";
  const txlineEnabled = env.TXLINE_LIVE_ENABLED === "true";

  const coreChecks: ReadinessCheck[] = [
    {
      id: "database",
      ready: evidence.databaseReady,
      owner: "SYSTEM",
      action: "Restore the D1 binding or apply pending migrations.",
    },
    {
      id: "admin_auth",
      ready: present(env.ADMIN_TOKEN),
      owner: "OPERATOR",
      action: "Store ADMIN_TOKEN as a Worker secret.",
    },
    {
      id: "superteam_agent",
      ready: present(env.SUPERTEAM_AGENT_API_KEY),
      owner: "OPERATOR",
      action: "Store the registered Superteam Agent API key as a Worker secret.",
    },
  ];

  const automationChecks: ReadinessCheck[] = [
    cronAutomationCheck(
      "hourly_discovery_cron",
      evidence.latestHourlyCronSucceededAt,
      evidence.latestHourlyCronAttemptAt,
      evidence.latestHourlyCronAttemptStartedAt,
      evidence.latestHourlyCronAttemptFinishedAt,
      evidence.latestHourlyCronAttemptStatus,
      now,
      HOURLY_CRON_MAX_AGE_MINUTES,
      "Redeploy the configured Cron Triggers and inspect recent hourly Cron Events.",
    ),
    cronAutomationCheck(
      "daily_report_cron",
      evidence.latestDailyCronSucceededAt,
      evidence.latestDailyCronAttemptAt,
      evidence.latestDailyCronAttemptStartedAt,
      evidence.latestDailyCronAttemptFinishedAt,
      evidence.latestDailyCronAttemptStatus,
      now,
      DAILY_AUTOMATION_MAX_AGE_MINUTES,
      "Inspect the 0 16 * * * Cron Event and redeploy the configured triggers if no successful run appears.",
    ),
    freshnessCheck(
      "daily_report_snapshot",
      evidence.latestReportSnapshotCreatedAt,
      now,
      DAILY_AUTOMATION_MAX_AGE_MINUTES,
      "Generate the missing daily report after the Cron delivery issue is diagnosed.",
    ),
  ];

  const x402Checks: ReadinessCheck[] = [
    {
      id: "receiver_public_address",
      ready: receiverValid,
      owner: "HUMAN",
      action: "Provide a dedicated Solana receiving public address only; never provide a private key or recovery phrase.",
    },
    {
      id: "facilitator_credentials",
      ready: facilitatorReady,
      owner: "HUMAN",
      action: cdpRequired
        ? "Create CDP facilitator credentials and store both values directly as Worker secrets."
        : "Use the configured public facilitator for this non-production environment.",
    },
    {
      id: "controlled_payers",
      ready: present(env.CONTROLLED_PAYER_ADDRESSES),
      owner: "HUMAN",
      action: "List every user-controlled payer public address so self-tests cannot be counted as revenue.",
    },
    {
      id: "mainnet_network",
      ready: !production || env.PAYMENT_NETWORK === SOLANA_MAINNET,
      owner: "SYSTEM",
      action: "Keep production payments pinned to Solana mainnet.",
    },
    {
      id: "enabled",
      ready: paymentsEnabled,
      owner: "OPERATOR",
      action: "Enable only after all prerequisites pass and a human authorizes the real payment test.",
    },
  ];

  const txlineChecks: ReadinessCheck[] = [
    {
      id: "guest_jwt",
      ready: present(env.TXLINE_GUEST_JWT),
      owner: "HUMAN",
      action: "Complete the official TxLINE wallet subscription flow and store the guest JWT as a Worker secret.",
    },
    {
      id: "api_token",
      ready: present(env.TXLINE_API_TOKEN),
      owner: "HUMAN",
      action: "Sign the official activation message and store the resulting TxLINE API token as a Worker secret.",
    },
    {
      id: "enabled",
      ready: txlineEnabled,
      owner: "OPERATOR",
      action: "Enable live capture only after an official fixture request succeeds.",
    },
  ];

  const submissionChecks: ReadinessCheck[] = [
    {
      id: "public_repository",
      ready: true,
      owner: "SYSTEM",
      action: "Keep the public repository and test evidence available.",
    },
    {
      id: "production_demo",
      ready: production,
      owner: "SYSTEM",
      action: "Use the production deployment for reviewer verification.",
    },
    {
      id: "grant_drive_link",
      ready: present(env.GRANT_RESPONSE_DRIVE_URL),
      owner: "HUMAN",
      action: "Upload the finished Grant response PDF to Google Drive and create a public read-only link.",
    },
    {
      id: "grant_portal_submission",
      ready: submitted(evidence.grantStatus),
      owner: "HUMAN",
      action: "Finish Superteam login/KYC review and approve the final Grant submission in the official portal.",
    },
    {
      id: "txodds_live_evidence",
      ready: txlineEnabled
        && present(env.TXLINE_GUEST_JWT)
        && present(env.TXLINE_API_TOKEN)
        && evidence.txlineCapturedEvents > 0,
      owner: "HUMAN",
      action: "Activate TxLINE and capture at least one verified fixture with replay events.",
    },
    {
      id: "txodds_demo_video",
      ready: present(env.TXODDS_DEMO_URL),
      owner: "HUMAN",
      action: "Record and publish the required TxODDS demo video under five minutes.",
    },
    {
      id: "txodds_portal_submission",
      ready: submitted(evidence.txoddsStatus),
      owner: "HUMAN",
      action: "Approve the final TxODDS submission in the official Superteam portal.",
    },
  ];

  const coreReady = coreChecks.every((check) => check.ready);
  const automationReady = automationChecks.every((check) => check.ready);
  const x402State = trackState(paymentsEnabled, x402Checks);
  const txlineState = trackState(txlineEnabled, txlineChecks);
  const submissionsReady = submissionChecks.every((check) => check.ready);
  const nextHumanActions = [...x402Checks, ...txlineChecks, ...submissionChecks]
    .filter((check) => check.owner === "HUMAN" && !check.ready)
    .map((check) => check.action)
    .filter((action, index, actions) => actions.indexOf(action) === index);
  const nextOperatorActions = [
    ...coreChecks,
    ...automationChecks,
    ...x402Checks,
    ...txlineChecks,
    ...submissionChecks,
  ]
    .filter((check) => check.owner === "OPERATOR" && !check.ready)
    .map((check) => check.action)
    .filter((action, index, actions) => actions.indexOf(action) === index);

  return {
    generatedAt: now.toISOString(),
    environment: env.APP_ENV,
    secretsExposed: false,
    core: {
      state: coreReady ? "ACTIVE" : "MISCONFIGURED",
      ready: coreReady,
      checks: coreChecks,
    },
    automation: {
      state: automationReady ? "ACTIVE" : "DEGRADED",
      ready: automationReady,
      checks: automationChecks,
    },
    x402: {
      state: x402State,
      ready: x402State === "ACTIVE",
      checks: x402Checks,
    },
    txline: {
      state: txlineState,
      ready: txlineState === "ACTIVE",
      checks: txlineChecks,
    },
    submissions: {
      state: submissionsReady ? "ACTIVE" : "HUMAN_ACTION_REQUIRED",
      ready: submissionsReady,
      checks: submissionChecks,
    },
    nextHumanActions,
    nextOperatorActions,
  };
}
