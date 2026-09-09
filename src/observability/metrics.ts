import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from './logger';

const logger = getLogger('metrics');

interface Metrics {
  totalIssuesProcessed: number;
  successfulSessions: number;
  failedSessions: number;
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
  status: 'started' | 'completed' | 'failed';
  duration?: number;
  sessionId?: string;
}

const METRICS_FILE = path.join(process.cwd(), 'logs', 'metrics.json');

class MetricsTracker {
  private metrics: Metrics;

  constructor() {
    this.metrics = this.loadMetrics();
  }

  private loadMetrics(): Metrics {
    try {
      if (fs.existsSync(METRICS_FILE)) {
        const data = fs.readFileSync(METRICS_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error('Failed to load metrics file', { error });
    }
    
    return this.getInitialMetrics();
  }

  private getInitialMetrics(): Metrics {
    return {
      totalIssuesProcessed: 0,
      successfulSessions: 0,
      failedSessions: 0,
      activeSessions: 0,
      averageSessionDuration: 0,
      lastUpdateTime: new Date().toISOString(),
      issuesByType: {},
      recentActivity: [],
    };
  }

  private saveMetrics(): void {
    try {
      const logsDir = path.dirname(METRICS_FILE);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      this.metrics.lastUpdateTime = new Date().toISOString();
      fs.writeFileSync(METRICS_FILE, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      logger.error('Failed to save metrics file', { error });
    }
  }

  incrementTotalIssues(): void {
    this.metrics.totalIssuesProcessed++;
    this.saveMetrics();
  }

  incrementSuccessfulSessions(duration?: number): void {
    this.metrics.successfulSessions++;
    this.metrics.activeSessions--;
    
    if (duration) {
      const totalDuration = this.metrics.averageSessionDuration * (this.metrics.successfulSessions - 1);
      this.metrics.averageSessionDuration = (totalDuration + duration) / this.metrics.successfulSessions;
    }
    
    this.saveMetrics();
  }

  incrementFailedSessions(): void {
    this.metrics.failedSessions++;
    this.metrics.activeSessions--;
    this.saveMetrics();
  }

  incrementActiveSessions(): void {
    this.metrics.activeSessions++;
    this.saveMetrics();
  }

  recordIssueType(type: string): void {
    this.metrics.issuesByType[type] = (this.metrics.issuesByType[type] || 0) + 1;
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
