import dotenv from "dotenv";

dotenv.config();

export const config = {
  devin: {
    apiKey: process.env.DEVIN_API_KEY || "",
    orgId: process.env.DEVIN_ORG_ID || "",
    apiBaseUrl: process.env.DEVIN_API_BASE_URL || "https://api.devin.ai/v3",
    maxAcuLimit: Number(process.env.DEVIN_MAX_ACU_LIMIT || "10"),
  },
  github: {
    token: process.env.GITHUB_TOKEN || "",
    repoOwner: process.env.GITHUB_REPO_OWNER || "chengify",
    repoName: process.env.GITHUB_REPO_NAME || "superset",
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
  },
  automation: {
    autoLabel: process.env.AUTO_LABEL || "devin-automation",
    sessionTimeoutMinutes: parseInt(
      process.env.SESSION_TIMEOUT_MINUTES || "30",
      10,
    ),
    maxConcurrentSessions: parseInt(
      process.env.MAX_CONCURRENT_SESSIONS || "3",
      10,
    ),
  },
};

// Validate required configuration
const requiredConfig = [
  "devin.apiKey",
  "devin.orgId",
  "github.token",
  "github.webhookSecret",
];

const missingConfig = requiredConfig.filter((key) => {
  const keys = key.split(".");
  let value: any = config;
  for (const k of keys) {
    value = value?.[k];
  }
  return !value;
});

if (missingConfig.length > 0) {
  console.warn(
    `Warning: Missing required configuration: ${missingConfig.join(", ")}`,
  );
  console.warn("Please set these environment variables in .env file");
}
