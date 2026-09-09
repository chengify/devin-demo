const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Explicit fake configuration prevents tests from using local credentials.
process.env.DEVIN_API_KEY = 'test-key';
process.env.DEVIN_ORG_ID = 'test-org';
process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.GITHUB_REPO_OWNER = 'test-owner';
process.env.GITHUB_REPO_NAME = 'test-repo';
process.env.AUTO_LABEL = 'fix-me';
process.env.MAX_CONCURRENT_SESSIONS = '1';
const app = require('../dist/index').default;
const { AutomationService, automationService } = require('../dist/automation/service');
const { GitHubClient } = require('../dist/github/client');
const { MetricsTracker } = require('../dist/observability/metrics');
const { logger } = require('../dist/observability/logger');
logger.silent = true;

let server;
let url;
let originalSchedule;
let scheduled;
const directory = mkdtempSync(path.join(tmpdir(), 'devin-review-tests-'));
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}/webhook/github`;
  originalSchedule = automationService.scheduleIssue;
  scheduled = [];
  automationService.scheduleIssue = number => { scheduled.push(number); return 'accepted'; };
});
after(async () => {
  automationService.scheduleIssue = originalSchedule;
  await new Promise(resolve => server.close(resolve));
  rmSync(directory, { recursive: true });
  logger.close();
});
const event = () => ({
  action: 'labeled', label: { name: 'fix-me' },
  repository: { name: 'test-repo', owner: { login: 'test-owner' } },
  issue: { number: 1, state: 'open', labels: [{ name: 'fix-me' }] },
});
let delivery = 0;
async function send(payload, signature, id = `delivery-${++delivery}`) {
  const headers = {
    'content-type': 'application/json', 'x-github-event': 'issues', 'x-github-delivery': id,
  };
  if (signature !== null) headers['x-hub-signature-256'] = signature ??
    `sha256=${createHmac('sha256', 'test-secret').update(payload).digest('hex')}`;
  return fetch(url, { method: 'POST', headers, body: payload });
}

test('signed original bytes with whitespace and Unicode are accepted once', async () => {
  const payload = JSON.stringify({ ...event(), note: '测试' }, null, 2) + '\n';
  const before = scheduled.length;
  assert.equal((await send(payload, undefined, 'same-id')).status, 202);
  assert.equal((await send(payload, undefined, 'same-id')).status, 200);
  assert.equal(scheduled.length, before + 1);
});
test('missing, malformed, wrong, and tampered signatures are rejected', async () => {
  const payload = JSON.stringify(event());
  for (const signature of [null, 'bad', `sha256=${'0'.repeat(64)}`]) {
    assert.equal((await send(payload, signature)).status, 401);
  }
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(payload).digest('hex')}`;
  assert.equal((await send(payload + ' ', signature)).status, 401);
});
test('unrelated labels, repositories, and closed issues do not schedule work', async () => {
  const before = scheduled.length;
  const variants = [
    { ...event(), label: { name: 'other' } },
    { ...event(), repository: { name: 'other', owner: { login: 'test-owner' } } },
    { ...event(), repository: { name: 12 } },
    { ...event(), issue: { ...event().issue, state: 'closed' } },
  ];
  for (const value of variants) assert.equal((await send(JSON.stringify(value))).status, 200);
  assert.equal(scheduled.length, before);
  assert.equal((await send('{}')).status, 400);
});

const issue = { number: 1, title: 'Fix a bug', body: 'Description', state: 'open',
  labels: [{ name: 'fix-me' }], html_url: 'https://github.com/test-owner/test-repo/issues/1' };
let run = 0;
function harness({ fetchFails = false, createFails = false, prFails = false, notifyFails = false, sessionStatus = 'completed' } = {}) {
  const metrics = new MetricsTracker(path.join(directory, `metrics-${++run}.json`));
  const comments = [];
  const github = {
    getIssue: async () => { if (fetchFails) throw new Error('fetch failed'); return issue; },
    getDefaultBranch: async () => 'master',
    addIssueComment: async (_number, body) => { comments.push(body); if (notifyFails) throw new Error('comment failed'); },
    closeIssue: async () => assert.fail('Must never close an issue'),
    createBranch: async () => assert.fail('Must not manufacture a branch'),
    findRemediationPullRequest: async () => {
      if (prFails) throw new Error('No PR');
      return { html_url: 'https://github.com/test-owner/test-repo/pull/2' };
    },
  };
  let release;
  const completion = new Promise(resolve => { release = resolve; });
  const devin = {
    createSession: async ({ prompt }) => {
      assert.match(prompt, /devin-issue-1-/);
      assert.match(prompt, /test-owner\/test-repo/);
      if (createFails) throw new Error('create failed');
      return { id: 'test-session' };
    },
    waitForSessionCompletion: async () => { await completion; return { status: sessionStatus }; },
  };
  return { service: new AutomationService(devin, github, metrics), metrics, comments, release };
}
async function settle(service) {
  for (let i = 0; i < 100; i++) {
    if (service.activeIssues.size === 0) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Task did not settle');
}
test('overlapping issues are deduplicated and concurrency is enforced', async () => {
  const h = harness();
  assert.equal(h.service.scheduleIssue(1), 'accepted');
  assert.equal(h.service.scheduleIssue(1), 'duplicate');
  assert.equal(h.service.scheduleIssue(2), 'busy');
  h.release();
  await settle(h.service);
  const m = h.metrics.getMetrics();
  assert.equal(m.activeSessions, 0);
  assert.equal(m.successfulSessions, 1);
  assert.equal(m.recentActivity[0].validation, 'unverified');
  assert.equal(m.recentActivity[0].status, 'pr_ready');
});
test('completion without a PR is failure and leaves the issue open', async () => {
  const h = harness({ prFails: true });
  h.service.scheduleIssue(1); h.release(); await settle(h.service);
  const m = h.metrics.getMetrics();
  assert.equal(m.successfulSessions, 0);
  assert.equal(m.failedSessions, 1);
  assert.equal(m.activeSessions, 0);
});
test('notification failures do not double-count outcomes or interrupt polling', async () => {
  for (const sessionStatus of ['completed', 'failed']) {
    const h = harness({ notifyFails: true, sessionStatus });
    h.service.scheduleIssue(1); h.release(); await settle(h.service);
    const m = h.metrics.getMetrics();
    assert.equal(m.successfulSessions + m.failedSessions, 1);
    assert.equal(m.activeSessions, 0);
    assert.equal(m.successfulSessions, sessionStatus === 'completed' ? 1 : 0);
  }
});
test('pre-session failures never produce negative active counts', async () => {
  for (const options of [{ fetchFails: true }, { createFails: true }]) {
    const h = harness(options);
    h.service.scheduleIssue(1); h.release(); await settle(h.service);
    const m = h.metrics.getMetrics();
    assert.equal(m.activeSessions, 0);
    assert.equal(m.successfulSessions, 0);
    assert.equal(m.failedSessions, options.fetchFails ? 0 : 1);
  }
});
test('PR verification rejects empty, draft, closed, or wrong-repository changes', async () => {
  const client = new GitHubClient();
  const repository = { full_name: 'test-owner/test-repo' };
  const valid = { state: 'open', draft: false, changed_files: 1,
    head: { ref: 'run-branch', repo: repository }, base: { ref: 'master', repo: repository } };
  let pr = valid;
  client.octokit = { rest: { pulls: {
    list: async () => ({ data: [{ number: 2 }] }),
    get: async () => ({ data: pr }),
  } } };
  assert.equal(await client.findRemediationPullRequest('run-branch', 'master'), valid);
  for (const invalid of [{ changed_files: 0 }, { draft: true }, { state: 'closed' },
    { base: { ref: 'master', repo: { full_name: 'apache/superset' } } }]) {
    pr = { ...valid, ...invalid };
    await assert.rejects(client.findRemediationPullRequest('run-branch', 'master'));
  }
  client.octokit.rest.pulls.list = async () => ({ data: [] });
  await assert.rejects(client.findRemediationPullRequest('run-branch', 'master'));
});
