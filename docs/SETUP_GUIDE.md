# Devin Automation Setup Guide

This runbook covers both first-time setup and repeating the live issue-to-Devin-to-PR demo. Complete the one-time checklist before triggering an issue: an eligible event creates paid Devin work.

## What you need

- Access to a Devin organization with API and session-creation permissions.
- Admin access to the target GitHub repository for installing the Devin GitHub App and configuring a webhook.
- A GitHub account that can read issues and pull requests and post issue comments in the target repository.
- Docker with Docker Compose.
- An HTTPS endpoint that can reach local port `3000`; this guide uses ngrok.
- Node.js 20+ only if you want to run checks outside Docker.

For this demo, the target is `chengify/superset`, the trigger label is `devin-automation`, and the service repository is `chengify/devin-demo`.

## Configuration map

These are separate credentials and integrations. The GitHub token is used by this coordinator service; Devin accesses the repository through its own GitHub App installation.

| Configuration | Used by | Purpose |
| --- | --- | --- |
| Devin API key | Coordinator service | Create, inspect, poll, and terminate Devin sessions. |
| Devin organization ID | Coordinator service | Select the organization in Devin v3 API paths. |
| Devin GitHub App | Devin sessions | Clone the fork, push a branch, and open a pull request. |
| GitHub fine-grained token | Coordinator service | Read issues and PRs, discover repository metadata, and post issue comments. |
| GitHub webhook secret | GitHub and coordinator | Authenticate webhook payloads with an HMAC signature. |
| GitHub repository webhook | GitHub | Deliver issue triggers and merged-PR lifecycle events. |

Never paste credentials into issues, pull requests, logs, screenshots, Loom, or committed files. Store them only in the Git-ignored `.env` file. If a credential is exposed, revoke and replace it before continuing.

## 1. Prepare the repositories

- Fork or copy Apache Superset into the GitHub account or organization that Devin can access.
- Create the remediation issues in that fork.
- Create the `devin-automation` label in the fork.
- Clone this automation repository.
- Confirm `.env` is ignored before adding credentials:

```bash
git check-ignore .env
```

The current configuration expects:

```text
Automation service: git@github.com:chengify/devin-demo.git
Target repository:  https://github.com/chengify/superset
Trigger label:       devin-automation
```

## 2. Create the Devin API credential

Use a dedicated Devin service user/API credential for automation rather than a personal interactive credential.

- Open the Devin organization settings and locate the API/service-user controls.
- Create or select a service user with permission to create and manage sessions.
- Generate a v3 API key and copy it when it is shown. This project expects a `cog_...` credential.
- Copy the organization identifier used by the API. This project expects an `org-...` value.
- Save both values in `.env`; do not place them in shell in this document.

```dotenv
DEVIN_API_KEY=cog_your_devin_api_key_here
DEVIN_ORG_ID=org-your_organization_id_here
DEVIN_API_BASE_URL=https://api.devin.ai/v3
DEVIN_MAX_ACU_LIMIT=10
```

`DEVIN_MAX_ACU_LIMIT` is sent with every session. It limits that individual session, not total organization spending.

Verify read-only access before creating paid work:

```bash
npm ci
npm run devin:check
```

The check lists at most one session and does not create a session. A successful check proves authentication and read access; the live workflow proves session-creation permission.

References: [Devin API authentication](https://docs.devin.ai/api-reference/authentication) and [Devin Teams API quickstart](https://docs.devin.ai/api-reference/getting-started/teams-quickstart).

## 3. Connect Devin to GitHub

The API key does not give Devin repository access. Install Devin's GitHub integration separately.

- In Devin, open organization settings and select the GitHub integration.
- Install or configure the Devin GitHub App for the GitHub owner containing the fork.
- Choose **Only select repositories** where possible and grant access to `chengify/superset`.
- Confirm the Devin organization/service user used by the API can use that connection.
- If repository access changes later, revisit the GitHub App installation and add the repository.

The expected result is that a Devin session can clone `chengify/superset`, push its assigned branch, and open a PR in that fork. Do not grant access to the upstream `apache/superset` repository for this experiment.

Reference: [Devin GitHub integration](https://docs.devin.ai/integrations/github).

## 4. Create the coordinator's GitHub token

Create a fine-grained personal access token from GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.

- Set the resource owner to the owner of the Superset fork.
- Restrict repository access to **Only select repositories** and choose `superset`.
- Choose a short expiration appropriate for the take-home.
- Grant these repository permissions:

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | Read | Repository metadata and default branch; GitHub normally grants this automatically. |
| Issues | Read and write | Read the selected issue and post session/outcome comments. |
| Pull requests | Read | Discover and verify the PR created by Devin. |

The coordinator does not need repository administration or webhook-administration permission because the webhook is configured manually. Devin pushes code through the GitHub App, not this token.

- Generate the token and copy it when shown.
- Add it to `.env`:

```dotenv
GITHUB_TOKEN=your_github_token_here
GITHUB_REPO_OWNER=chengify
GITHUB_REPO_NAME=superset
```

Reference: [GitHub fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

## 5. Create the webhook secret

Generate a different random secret from all API tokens:

```bash
openssl rand -hex 32
```

- Put the generated value in `.env` as `GITHUB_WEBHOOK_SECRET`.
- Keep it available while configuring the GitHub webhook; both sides must use the identical value.

```dotenv
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
```

## 6. Complete `.env`

Create the local file and fill in every placeholder:

```bash
cp .env.example .env
```

Recommended demo configuration:

```dotenv
DEVIN_API_KEY=cog_your_devin_api_key_here
DEVIN_ORG_ID=org-your_organization_id_here
DEVIN_API_BASE_URL=https://api.devin.ai/v3
DEVIN_MAX_ACU_LIMIT=10

GITHUB_TOKEN=your_github_token_here
GITHUB_REPO_OWNER=chengify
GITHUB_REPO_NAME=superset
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here

PORT=3000
NODE_ENV=development

AUTO_LABEL=devin-automation
SESSION_TIMEOUT_MINUTES=30
MAX_CONCURRENT_SESSIONS=1
```

Keep `MAX_CONCURRENT_SESSIONS=1` for a controlled interview demo. The service validates missing or placeholder Devin credentials before attempting API work.

## 7. Start and verify the service

Run the production-shaped Docker workflow:

```bash
docker compose up --build
```

In another terminal, verify:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/status
```

- `/health` returns `status: healthy`.
- `/status` returns `status: operational`.
- Open `http://localhost:3000/dashboard` and confirm the dashboard loads.

`/health` proves only that the process is available. Run `npm run devin:check` separately to verify Devin authentication.

## 8. Expose the webhook endpoint

Create an ngrok account, install its CLI, and connect the CLI using the authtoken command shown in the ngrok dashboard. Treat that authtoken as a credential and keep it out of commits and recordings.

Then start an HTTPS tunnel in a separate terminal and keep it running:

```bash
ngrok http 3000
```

- Copy the HTTPS forwarding URL, for example `https://example.ngrok-free.dev`.
- Verify the public health endpoint:

```bash
curl https://example.ngrok-free.dev/health
```

If the ngrok hostname changes, update the GitHub webhook payload URL before triggering the experiment. Closing ngrok stops GitHub delivery even while Docker remains healthy.

## 9. Configure the GitHub webhook

In the Superset fork, open **Settings → Webhooks → Add webhook**:

- **Payload URL:** `https://<public-host>/webhook/github`
- **Content type:** `application/json`
- **Secret:** the exact `GITHUB_WEBHOOK_SECRET` value from `.env`
- **SSL verification:** enabled
- Select **Let me select individual events**.
- Enable **Issues**.
- Enable **Pull requests**.
- Leave the webhook active and save it.
- Confirm GitHub's `ping` delivery receives HTTP 200.

Why both events are required:

- `issues/labeled` starts automation when `devin-automation` is added.
- `issues/opened` also starts automation if the issue already contains that label.
- `pull_request/closed` with `merged: true` advances a previously tracked PR to `merged` on the dashboard.

The service rejects missing or invalid signatures, other repositories, unrelated labels, unmerged PR closures, and PR URLs it did not previously record.

References: [Creating GitHub webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks) and [webhook event payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

## 10. Run the experiment

Before adding the label, confirm all four processes/integrations are ready:

- Docker service is running.
- ngrok is running and the webhook URL matches its public hostname.
- Devin access check passes.
- Devin GitHub App can access the Superset fork.

Then:

1. Open an eligible issue in `chengify/superset`.
2. Add the `devin-automation` label. This is the paid-work trigger.
3. Confirm GitHub's webhook delivery returns HTTP 202.
4. Watch `/dashboard`; it refreshes every 10 seconds.
5. Follow the linked Devin session and issue comments.
6. Wait for the service to verify a non-draft PR and show `PR ready`.
7. Review the PR and its validation evidence manually.
8. Merge only after approval. The Pull requests webhook should change the task badge to `Merged` within approximately 10 seconds.

The service intentionally does not merge the PR or close the issue.

## Repeat-demo checklist

Use this shorter list after the one-time account configuration is complete:

- Pull the latest automation code.
- Confirm `.env` exists and has not been committed.
- Run `npm run devin:check`.
- Run `docker compose up --build`.
- Confirm local `/health`, `/status`, and `/dashboard`.
- Start ngrok and confirm the public `/health` endpoint.
- Confirm the GitHub webhook URL matches ngrok and its latest ping/delivery is successful.
- Confirm both **Issues** and **Pull requests** events remain selected.
- Confirm `MAX_CONCURRENT_SESSIONS=1` and the intended ACU limit.
- Select one open issue and add `devin-automation` only when ready.
- Capture the issue, Devin session, PR, dashboard, and validation links for the demo.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| GitHub delivery fails | Docker and ngrok are running; payload URL ends in `/webhook/github`; secret and JSON content type match. |
| Webhook returns 401 | GitHub and `.env` webhook secrets differ, or the request was not signed by GitHub. |
| Issue event returns 200 `ignored` | Repository, issue state, action, or label does not meet the trigger rules. |
| Issue event returns 503 | Session capacity is full. Wait for the active task to finish, then redeliver the GitHub event manually. |
| Devin check returns 401/403 | API key, organization ID, service-user membership, or API permission is wrong. |
| Devin cannot clone or push | Check the separate Devin GitHub App installation and repository selection. |
| PR stays `PR ready` after merge | Ensure **Pull requests** is selected on the webhook and inspect the `pull_request/closed` delivery response. |
| Dashboard does not change immediately | It auto-refreshes every 10 seconds; refresh manually, then inspect `/status` and service logs. |

## Shut down and rotate

After the demonstration:

```bash
docker compose down
```

Stop ngrok separately. Revoke temporary GitHub/Devin credentials if they are no longer needed, and never commit `.env` or log files containing sensitive operational data.
