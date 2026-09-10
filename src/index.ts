import express, { Request, Response } from "express";
import { webhookHandler } from "./webhook/handler";
import { metricsTracker } from "./observability/metrics";
import { renderDashboard } from "./observability/dashboard";
import { getLogger } from "./observability/logger";
import { config } from "./config";
import { githubClient } from "./github/client";

const logger = getLogger("app");

const app = express();

// Middleware
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buffer;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, _res, next) => {
  logger.info("Incoming request", {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Status dashboard endpoint
app.get("/status", (_req: Request, res: Response) => {
  const metrics = metricsTracker.getMetrics();
  res.status(200).json({
    status: "operational",
    metrics,
    config: {
      repoOwner: config.github.repoOwner,
      repoName: config.github.repoName,
      autoLabel: config.automation.autoLabel,
      maxConcurrentSessions: config.automation.maxConcurrentSessions,
    },
  });
});

app.get("/dashboard", (_req: Request, res: Response) => {
  res
    .set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    )
    .set("Cache-Control", "no-store")
    .type("html")
    .status(200)
    .send(
      renderDashboard(
        metricsTracker.getMetrics(),
        config.github.repoOwner,
        config.github.repoName,
      ),
    );
});

// GitHub webhook endpoint
app.post("/webhook/github", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string;

  logger.info("GitHub webhook received", { event });

  try {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (
      !rawBody ||
      !githubClient.verifyWebhookSignature(
        rawBody,
        req.get("x-hub-signature-256"),
      )
    ) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    switch (event) {
      case "issues":
        await webhookHandler.handleIssueEvent(req, res);
        break;
      case "pull_request":
        await webhookHandler.handlePullRequestEvent(req, res);
        break;
      case "ping":
        await webhookHandler.handlePingEvent(req, res);
        break;
      default:
        logger.info("Unhandled GitHub event", { event });
        res.status(200).json({ message: "Event acknowledged but not handled" });
    }
  } catch (error) {
    logger.error("Error handling webhook", { event, error });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Root endpoint
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    name: "Devin Automation Service",
    version: "1.0.0",
    description:
      "Event-driven automation using Devin API to remediate GitHub issues",
    endpoints: {
      health: "GET /health",
      status: "GET /status",
      dashboard: "GET /dashboard",
      webhook: "POST /webhook/github",
    },
  });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: any) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({
    error: "Internal server error",
    message: config.server.nodeEnv === "development" ? err.message : undefined,
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = config.server.port;

if (require.main === module)
  app.listen(PORT, () => {
    logger.info(`Devin Automation Service started`, {
      port: PORT,
      environment: config.server.nodeEnv,
      repo: `${config.github.repoOwner}/${config.github.repoName}`,
    });
  });

export default app;
