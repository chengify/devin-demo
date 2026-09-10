# Devin Automation Service

An event-driven issue remediation service for an Apache Superset fork. A signed GitHub issue event starts and monitors a Devin API session, verifies the resulting pull request, and exposes progress and evidence for engineering reviewers. A later signed pull-request event advances the tracked task to merged.

## Current status

The workflow has been demonstrated end to end against `chengify/superset`: labeling an eligible issue triggered a real Devin session, produced a reviewable pull request, and recorded its later human merge. The service reports the merged lifecycle state while keeping test validation explicitly unverified until independent CI or local confirmation exists.

| Component | Current state |
| --- | --- |
| Express | Verifies signatures from original request bytes, handles issue and merged-PR events, suppresses duplicate/overlapping work, and exposes health, JSON status, and HTML dashboard routes. |
| Devin client | Uses the live v3 contract, opaque session IDs, bounded GET retries, native lifecycle states, per-session ACU limits, and archived timeout termination. |
| GitHub client | Reads issues, posts progress comments, verifies webhook signatures, and validates the resulting PR's repository, branch, base, state, and changed-file count. |
| Remediation handoff | Verified live: labeled issue → Devin session → unique branch → non-draft PR targeting `master` → human merge. |
| Observability | Reports active/successful/blocked/failed counts plus issue, session, PR, timing, reason, and validation fields. Error diagnostics are sanitized. |
| Docker | Live Compose service and public HTTPS webhook endpoint returned healthy responses during the demonstrated run. |
| Validation | Compilation, lint, and 31 regression/contract tests pass. Devin's Superset results are captured separately from independent validation. |

## Workflow and architecture

![Devin issue-remediation architecture and workflow](docs/devin-automation-architecture.png)

The service verifies signed GitHub events, coordinates a bounded Devin session, verifies the resulting PR, and exposes its state through JSON metrics and an HTML dashboard. Devin uses its GitHub App to clone, implement, test, push, and open the PR; human review and merging remain outside the automation boundary.

## Local setup

See the [experiment setup guide](docs/SETUP_GUIDE.md) for Devin credentials, the Devin GitHub App, GitHub token permissions, webhooks, Docker, and ngrok. The short local path is:

```bash
npm ci
cp .env.example .env
# Edit .env with your configuration.
npm run devin:check
npm test
docker compose up --build
```

With the service running, use:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/status
# Open http://localhost:3000/dashboard in a browser
```

`npm run devin:check` is read-only. Adding `devin-automation` to an eligible issue starts paid work; do that only after completing the full setup guide.

## Verified live demo

After completing the [experiment setup guide](docs/SETUP_GUIDE.md), run the end-to-end workflow as follows:

1. Start the service with `docker compose up --build` and expose it through the configured HTTPS tunnel.
2. Confirm `/health` is healthy and GitHub can successfully deliver webhook events.
3. Create or select an open issue in the configured repository, then add the `devin-automation` label. This starts paid Devin work.
4. Open [the dashboard](http://localhost:3000/dashboard). It refreshes automatically and should show the accepted task, active Devin session, and eventual PR handoff. Use [the JSON status endpoint](http://localhost:3000/status) for machine-readable evidence.
5. Follow the session link to inspect Devin's work and review the resulting pull request, including its diff and reported validation.
6. Merge the pull request manually if it meets the review bar. The signed `pull_request/closed` webhook should move the tracked task to **Merged** on the dashboard within about 10 seconds.

A successful demonstration produces a traceable chain of evidence: GitHub webhook delivery, issue progress comments, a Devin session, a reviewable pull request, and lifecycle status in both the dashboard and JSON endpoint. The automation does not merge the pull request or close the issue; those remain deliberate human decisions.

## Known gaps

1. **Independent validation:** PR readiness and Devin-reported test evidence are captured, but CI is not ingested and the service reports validation as `unverified`.
2. **Session controls:** Automate recovery/resumption of monitored sessions. A monitoring failure, blocked state, or unconfirmed termination releases local capacity while the remote session may remain resumable or active. Concurrency controls local tasks; the submitted per-session ACU limit is not a global spending cap.
3. **Durable tasks:** Persist recoverable task records and delivery IDs, resume monitoring after restart, and derive aggregates from records. Current JSON aggregates preserve reporting but are not a task queue.
4. **Simulation:** Provide a user-facing credential-free simulation. Regression tests use fake clients but are not yet a complete demo command.

Logs are written to `logs/combined.log` and `logs/error.log`; aggregate metrics are saved in `logs/metrics.json`. Log rotation is not implemented. Running sessions are not stored as recoverable task records.

For new runs, `successfulSessions` means a completion signal followed by a verified reviewable PR, not passing tests. A subsequent verified GitHub webhook records `merged` as the task's latest lifecycle state without changing the successful-session count.
