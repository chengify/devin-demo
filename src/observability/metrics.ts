import * as fs from "fs";
import * as path from "path";
import { getLogger } from "./logger";

const logger = getLogger("metrics");

interface Metrics {
  totalIssuesProcessed: number;
  successfulSessions: number;
  failedSessions: number;
  blockedSessions: number;
  activeSessions: number;
  averageSessionDuration: number;
  lastUpdateTime: string;
  issuesByType: Record<string, number>;
  recentActivity: ActivityEntry[];
}

interface ActivityEntry {
  timestamp: string;
  issueNumber: number;
  issueTitle: string;
  status: "started" | "completed" | "pr_ready" | "failed" | "blocked";
  sessionUrl?: string;
  reason?: string;
  prUrl?: string;
  validation?: "unverified";
  duration?: number;
  sessionId?: string;
}

const METRICS_FILE = path.join(process.cwd(), "logs", "metrics.json");

export class MetricsTracker {
  private metrics: Metrics;

  constructor(private metricsFile = METRICS_FILE) {
    this.metrics = this.loadMetrics();
  }

  private loadMetrics(): Metrics {
    try {
      if (fs.existsSync(this.metricsFile)) {
        const data = fs.readFileSync(this.metricsFile, "utf-8");
        return { ...this.getInitialMetrics(), ...JSON.parse(data) };
      }
    } catch (error) {
      logger.error("Failed to load metrics file", { error });
    }

    return this.getInitialMetrics();
  }

  private getInitialMetrics(): Metrics {
    return {
      totalIssuesProcessed: 0,
      successfulSessions: 0,
      failedSessions: 0,
      blockedSessions: 0,
      activeSessions: 0,
      averageSessionDuration: 0,
      lastUpdateTime: new Date().toISOString(),
      issuesByType: {},
      recentActivity: [],
    };
  }

  private saveMetrics(): void {
    try {
      const logsDir = path.dirname(this.metricsFile);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      this.metrics.lastUpdateTime = new Date().toISOString();
      fs.writeFileSync(this.metricsFile, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      logger.error("Failed to save metrics file", { error });
    }
  }

  incrementTotalIssues(): void {
    this.metrics.totalIssuesProcessed++;
    this.saveMetrics();
  }

  incrementSuccessfulSessions(duration?: number): void {
    this.metrics.successfulSessions++;

    if (duration) {
      const totalDuration =
        this.metrics.averageSessionDuration *
        (this.metrics.successfulSessions - 1);
      this.metrics.averageSessionDuration =
        (totalDuration + duration) / this.metrics.successfulSessions;
    }

    this.saveMetrics();
  }

  incrementFailedSessions(): void {
    this.metrics.failedSessions++;
    this.saveMetrics();
  }

  reclassifyFailedAsSuccessful(duration?: number): void {
    if (this.metrics.failedSessions < 1) {
      throw new Error("No failed session is available to reclassify");
    }
    this.metrics.failedSessions--;
    this.metrics.successfulSessions++;
    if (duration) {
      const previousTotal =
        this.metrics.averageSessionDuration *
        (this.metrics.successfulSessions - 1);
      this.metrics.averageSessionDuration =
        (previousTotal + duration) / this.metrics.successfulSessions;
    }
    this.saveMetrics();
  }

  incrementBlockedSessions(): void {
    this.metrics.blockedSessions++;
    this.saveMetrics();
  }

  incrementActiveSessions(): void {
    this.metrics.activeSessions++;
    this.saveMetrics();
  }

  decrementActiveSessions(): void {
    this.metrics.activeSessions = Math.max(0, this.metrics.activeSessions - 1);
    this.saveMetrics();
  }

  recordIssueType(type: string): void {
    this.metrics.issuesByType[type] =
      (this.metrics.issuesByType[type] || 0) + 1;
    this.saveMetrics();
  }

  addActivity(entry: ActivityEntry): void {
    this.metrics.recentActivity.unshift(entry);
    // Keep only last 50 activities
    if (this.metrics.recentActivity.length > 50) {
      this.metrics.recentActivity = this.metrics.recentActivity.slice(0, 50);
    }
    this.saveMetrics();
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = this.getInitialMetrics();
    this.saveMetrics();
  }
}

export const metricsTracker = new MetricsTracker();
