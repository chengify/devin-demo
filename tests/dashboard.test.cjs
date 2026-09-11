const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderDashboard, summarizeTasks } = require('../dist/observability/dashboard');

const activity = [
  { timestamp: '2026-09-10T00:01:00Z', issueNumber: 1,
    issueTitle: '<script>alert(1)</script>', status: 'merged',
    sessionUrl: 'https://app.devin.ai/sessions/test',
    prUrl: 'https://github.com/test/repo/pull/1', validation: 'unverified' },
  { timestamp: '2026-09-10T00:00:30Z', issueNumber: 1,
    issueTitle: 'Ready task', status: 'pr_ready',
    sessionUrl: 'https://app.devin.ai/sessions/test',
    prUrl: 'https://github.com/test/repo/pull/1', validation: 'unverified' },
  { timestamp: '2026-09-10T00:00:00Z', issueNumber: 1,
    issueTitle: 'Old failure', status: 'failed' },
  { timestamp: '2026-09-10T00:02:00Z', issueNumber: 2,
    issueTitle: 'Active task', status: 'started' },
];

test('task summaries retain only the latest state for each issue', () => {
  const tasks = summarizeTasks(activity);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].issueTitle, '<script>alert(1)</script>');
  assert.equal(tasks[0].displayState, 'merged');
  assert.equal(tasks[1].displayState, 'active');
});

test('dashboard renders metrics and evidence links without injecting issue HTML', () => {
  const html = renderDashboard({
    totalIssuesProcessed: 2, successfulSessions: 1, failedSessions: 0,
    blockedSessions: 0, activeSessions: 1, averageSessionDuration: 1000,
    lastUpdateTime: '2026-09-10T00:02:00Z', issuesByType: {}, recentActivity: activity,
  }, 'test', 'repo');
  assert.match(html, /Current and completed tasks/);
  assert.match(html, /Merged/);
  assert.match(html, /Open session/);
  assert.match(html, /View merged PR/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /http-equiv="refresh" content="10"/);
  assert.doesNotMatch(html, /<th>Validation<\/th>|unverified/);
  assert.match(html, /PR ready means a reviewable pull request was produced\. Review its changes and test evidence before merging\./);
});
