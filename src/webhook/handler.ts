import { Request, Response } from "express";
import { automationService } from "../automation/service";
import { config } from "../config";

export class WebhookHandler {
  // Bounded process-local replay protection; restart recovery is future work.
  private deliveries = new Map<string, number>();

  constructor(private automation = automationService) {}

  private pruneDeliveries(now: number): void {
    for (const [id, timestamp] of this.deliveries) {
      if (now - timestamp > 24 * 60 * 60 * 1000) this.deliveries.delete(id);
    }
  }

  private rememberDelivery(delivery: string, now: number): void {
    if (this.deliveries.size >= 10000) {
      this.deliveries.delete(this.deliveries.keys().next().value!);
    }
    this.deliveries.set(delivery, now);
  }

  async handleIssueEvent(req: Request, res: Response): Promise<void> {
    const event = req.body;
    const delivery = req.get("x-github-delivery");
    if (
      !delivery ||
      !event ||
      typeof event !== "object" ||
      !Number.isSafeInteger(event.issue?.number) ||
      event.issue.number < 1 ||
      !Array.isArray(event.issue?.labels)
    ) {
      res
        .status(400)
        .json({ error: "Invalid issue event or missing delivery ID" });
      return;
    }

    const eligible =
      typeof event.repository?.name === "string" &&
      typeof event.repository?.owner?.login === "string" &&
      event.repository?.name?.toLowerCase() ===
        config.github.repoName.toLowerCase() &&
      event.repository?.owner?.login?.toLowerCase() ===
        config.github.repoOwner.toLowerCase() &&
      event.issue.state === "open" &&
      event.issue.labels.some(
        (label: { name?: string } | null) =>
          label?.name === config.automation.autoLabel,
      ) &&
      (event.action === "opened" ||
        (event.action === "labeled" &&
          event.label?.name === config.automation.autoLabel));
    if (!eligible) {
      res.status(200).json({ message: "Event ignored" });
      return;
    }

    const now = Date.now();
    this.pruneDeliveries(now);
    if (this.deliveries.has(delivery)) {
      res.status(200).json({ message: "Duplicate delivery ignored" });
      return;
    }
    const outcome = this.automation.scheduleIssue(event.issue.number);
    if (outcome === "busy") {
      res.set("Retry-After", "30").status(503).json({
        error:
          "Session capacity reached; redeliver this webhook after an active task finishes",
      });
      return;
    }
    this.rememberDelivery(delivery, now);
    res.status(outcome === "accepted" ? 202 : 200).json({
      message:
        outcome === "accepted" ? "Issue accepted" : "Issue already active",
      issueNumber: event.issue.number,
    });
  }

  async handlePullRequestEvent(req: Request, res: Response): Promise<void> {
    const event = req.body;
    const delivery = req.get("x-github-delivery");
    if (
      !delivery ||
      !event ||
      typeof event !== "object" ||
      !Number.isSafeInteger(event.pull_request?.number) ||
      event.pull_request.number < 1 ||
      typeof event.pull_request?.html_url !== "string" ||
      typeof event.repository?.name !== "string" ||
      typeof event.repository?.owner?.login !== "string"
    ) {
      res
        .status(400)
        .json({ error: "Invalid pull request event or missing delivery ID" });
      return;
    }

    const eligible =
      event.repository?.name?.toLowerCase() ===
        config.github.repoName.toLowerCase() &&
      event.repository?.owner?.login?.toLowerCase() ===
        config.github.repoOwner.toLowerCase() &&
      event.action === "closed" &&
      event.pull_request.merged === true;
    if (!eligible) {
      res.status(200).json({ message: "Event ignored" });
      return;
    }

    const now = Date.now();
    this.pruneDeliveries(now);
    if (this.deliveries.has(delivery)) {
      res.status(200).json({ message: "Duplicate delivery ignored" });
      return;
    }

    const outcome = this.automation.recordPullRequestMerged(
      event.pull_request.html_url,
      typeof event.pull_request.merged_at === "string"
        ? event.pull_request.merged_at
        : undefined,
    );
    this.rememberDelivery(delivery, now);
    res.status(200).json({
      message:
        outcome === "recorded"
          ? "Merged remediation recorded"
          : outcome === "duplicate"
            ? "Merged remediation already recorded"
            : "Pull request is not a tracked remediation",
    });
  }

  async handlePingEvent(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ message: "Pong" });
  }
}

export const webhookHandler = new WebhookHandler();
