import { devinClient, sessionOutcome } from "./client";
import { githubClient } from "../github/client";
import { metricsTracker } from "../observability/metrics";
import { logger } from "../observability/logger";

async function main(): Promise<void> {
  const [issueArg, sessionId, branch] = process.argv.slice(2);
  const issueNumber = Number(issueArg);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || !sessionId || !branch) {
    throw new Error(
      "Usage: npm run devin:recover -- <issue-number> <session-id> <branch>",
    );
  }

  const session = await devinClient.getSession(sessionId);
  if (sessionOutcome(session) !== "completed") {
    throw new Error(
      `Session is not ready for PR handoff (${session.status}/${session.status_detail || "unknown"})`,
    );
  }
  const issue = await githubClient.getIssue(issueNumber);
  const base = await githubClient.getDefaultBranch();
  const pr = await githubClient.findRemediationPullRequest(branch, base);
  const duration = Math.max(0, Date.now() - session.created_at * 1000);

  metricsTracker.reclassifyFailedAsSuccessful(duration);
  metricsTracker.addActivity({
    timestamp: new Date().toISOString(),
    issueNumber,
    issueTitle: issue.title,
    status: "pr_ready",
    duration,
    sessionId,
    sessionUrl: session.url,
    prUrl: pr.html_url,
    validation: "unverified",
    reason: "Reconciled after accepting the live v3 opaque session ID.",
  });
  await githubClient.addIssueComment(
    issueNumber,
    `Correction: the Devin session was created successfully and produced a PR. The initial failure update was caused by an overly strict local session-ID validator, which has now been corrected.\n\nSession: ${session.url}\nPR ready for review: ${pr.html_url}\n\nValidation: reported by Devin in the PR, but not independently verified by this service. The issue remains open pending human review and merge.`,
  );
  console.log(`Recovered issue #${issueNumber}: ${pr.html_url}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Recovery failed");
    process.exitCode = 1;
  })
  .finally(() => logger.close());
