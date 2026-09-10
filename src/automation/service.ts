import { randomUUID } from "crypto";
import {
  devinClient,
  sessionOutcome,
  SessionTimeoutError,
} from "../devin/client";
import { githubClient, GitHubIssue } from "../github/client";
import { metricsTracker } from "../observability/metrics";
import { getLogger } from "../observability/logger";
import { config } from "../config";

const logger = getLogger("automation-service");

export class AutomationService {
  private activeIssues = new Set<number>();

  constructor(
    private devin = devinClient,
    private github = githubClient,
    private metrics = metricsTracker,
  ) {}

  scheduleIssue(issueNumber: number): "accepted" | "duplicate" | "busy" {
    if (this.activeIssues.has(issueNumber)) return "duplicate";
    if (this.activeIssues.size >= config.automation.maxConcurrentSessions)
      return "busy";
    this.activeIssues.add(issueNumber);
    void this.runIssue(issueNumber).finally(() =>
      this.activeIssues.delete(issueNumber),
    );
    return "accepted";
  }

  recordPullRequestMerged(
    prUrl: string,
    mergedAt?: string,
  ): "recorded" | "duplicate" | "ignored" {
    const activity = this.metrics.getMetrics().recentActivity;
    const existing = activity.find((entry) => entry.prUrl === prUrl);
    if (!existing) return "ignored";
    if (existing.status === "merged") return "duplicate";

    this.metrics.addActivity({
      ...existing,
      timestamp:
        mergedAt && !Number.isNaN(Date.parse(mergedAt))
          ? new Date(mergedAt).toISOString()
          : new Date().toISOString(),
      status: "merged",
      reason: "Pull request merged on GitHub",
    });
    logger.info("Recorded merged remediation pull request", {
      issueNumber: existing.issueNumber,
      prUrl,
    });
    return "recorded";
  }

  private async notify(issueNumber: number, message: string): Promise<void> {
    try {
      await this.github.addIssueComment(issueNumber, message);
    } catch (error) {
      // Notification failures must not change the task outcome or abandon polling.
      logger.warn("Issue notification failed", { issueNumber, error });
    }
  }

  private async runIssue(issueNumber: number): Promise<void> {
    let started = false;
    let issueTitle = "Unknown";
    let sessionId: string | undefined;
    let sessionUrl: string | undefined;
    const startTime = Date.now();
    try {
      const issue = await this.github.getIssue(issueNumber);
      issueTitle = issue.title;
      if (
        issue.state !== "open" ||
        !issue.labels.some(
          (label) => label.name === config.automation.autoLabel,
        )
      )
        return;

      started = true;
      this.metrics.incrementTotalIssues();
      this.metrics.recordIssueType(this.determineIssueType(issue));
      this.metrics.incrementActiveSessions();
      const branch = `devin-issue-${issueNumber}-${randomUUID()}`;
      const base = await this.github.getDefaultBranch();
      const session = await this.devin.createSession({
        prompt: this.generatePrompt(issue, branch, base),
        title: `Issue #${issueNumber}: ${issue.title}`,
        repos: [
          `https://github.com/${config.github.repoOwner}/${config.github.repoName}`,
        ],
        tags: ["devin-automation", `issue-${issueNumber}`],
      });
      sessionId = session.session_id;
      sessionUrl = session.url;
      this.metrics.addActivity({
        timestamp: new Date().toISOString(),
        issueNumber,
        issueTitle,
        status: "started",
        sessionId,
        sessionUrl,
      });
      await this.notify(issueNumber, `Devin session started: ${sessionUrl}`);
      const result = await this.devin.waitForSessionCompletion(
        sessionId,
        config.automation.sessionTimeoutMinutes * 60 * 1000,
      );
      if (sessionOutcome(result) === "blocked") {
        this.metrics.incrementBlockedSessions();
        this.metrics.addActivity({
          timestamp: new Date().toISOString(),
          issueNumber,
          issueTitle,
          status: "blocked",
          sessionId,
          sessionUrl,
          reason: result.status_detail || result.status,
          duration: Date.now() - startTime,
        });
        await this.notify(
          issueNumber,
          `Devin needs attention (${result.status_detail || result.status}): ${sessionUrl}. Monitoring has stopped; inspect the session before resuming it.`,
        );
        return;
      }
      if (sessionOutcome(result) !== "completed") {
        throw new Error(`Session ended with status: ${result.status}`);
      }

      const pr = await this.github.findRemediationPullRequest(branch, base);
      const duration = Date.now() - startTime;
      this.metrics.incrementSuccessfulSessions(duration);
      this.metrics.addActivity({
        timestamp: new Date().toISOString(),
        issueNumber,
        issueTitle,
        status: "pr_ready",
        duration,
        sessionId,
        sessionUrl,
        prUrl: pr.html_url,
        validation: "unverified",
      });
      await this.notify(
        issueNumber,
        `PR ready for review: ${pr.html_url}\n\nValidation: unverified by this service. Review the test evidence in the PR. This issue remains open pending review and merge.`,
      );
    } catch (error) {
      logger.error("Issue processing failed", { issueNumber, error });
      // Fetch failures occur before any session/task is counted.
      if (started) this.metrics.incrementFailedSessions();
      this.metrics.addActivity({
        timestamp: new Date().toISOString(),
        issueNumber,
        issueTitle,
        status: "failed",
        sessionId,
        sessionUrl,
        reason:
          error instanceof SessionTimeoutError
            ? error.message
            : sessionId
              ? "Monitoring or PR verification failed; remote session state may be unknown."
              : "Task preparation or session creation failed.",
        duration: Date.now() - startTime,
      });
      await this.notify(
        issueNumber,
        `Automation could not produce a verified reviewable PR. The issue remains open. ${error instanceof SessionTimeoutError ? error.message : "Inspect the service logs and remote session before retrying."}${sessionUrl ? `\nSession: ${sessionUrl}` : ""}`,
      );
    } finally {
      if (started) this.metrics.decrementActiveSessions();
    }
  }

  private determineIssueType(issue: GitHubIssue): string {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    return (
      ["security", "code-quality", "dependency", "bug", "enhancement"].find(
        (type) => labels.includes(type),
      ) || "other"
    );
  }

  private generatePrompt(
    issue: GitHubIssue,
    branch: string,
    base: string,
  ): string {
    return `Remediate issue #${issue.number} in https://github.com/${config.github.repoOwner}/${config.github.repoName}.
Issue URL: ${issue.html_url}
Title: ${issue.title}
Description:
${issue.body || "No description provided"}

Clone or locate this exact fork. Follow its AGENTS.md and coding conventions.
Start from base branch "${base}" and use the unique branch "${branch}".
Investigate the issue, implement a bounded fix, and run relevant tests and checks.
Push your changes to this fork and open a non-draft PR targeting "${base}".
Include the issue URL, changes, exact validation commands/results, and checks not run in the PR body.
Do not merge the PR or close the issue. Do not modify the upstream Apache repository.
If blocked or unable to validate, report the limitation honestly rather than claiming success.`;
  }
}

export const automationService = new AutomationService();
