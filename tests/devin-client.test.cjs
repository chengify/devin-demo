const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
process.env.DEVIN_API_KEY = 'cog_test-secret';
process.env.DEVIN_ORG_ID = 'org-test';
const { DevinClient, sessionOutcome, SessionTimeoutError } = require('../dist/devin/client');
const { logger, sanitizeLogMetadata } = require('../dist/observability/logger');
logger.silent = true;
after(() => logger.close());

const fixture = (status = 'running', detail = 'working') => ({
  session_id: 'devin-test', url: 'https://app.devin.ai/sessions/devin-test',
  status, status_detail: detail, created_at: 1770000000, updated_at: 1770000001,
  acus_consumed: 0.1, pull_requests: [], structured_output: null,
});
function harness(responses, overrides = {}) {
  let time = 0;
  const requests = [];
  const waits = [];
  const http = axios.create({ adapter: async config => {
    requests.push(config);
    const next = responses.shift();
    assert.ok(next, 'Unexpected HTTP request');
    if (next.error) {
      const response = next.status ? {
        status: next.status, headers: next.headers || {},
        data: { detail: 'cog_secret_that_must_not_leak' }, config,
      } : undefined;
      throw new axios.AxiosError('secret request failure', 'ERR_BAD_RESPONSE', config, null, response);
    }
    return { status: 200, data: next, headers: {}, config };
  } });
  const client = new DevinClient({
    apiKey: 'cog_test-secret', orgId: 'org-test', apiBaseUrl: 'https://api.devin.ai/v3',
    maxAcuLimit: 10, ...overrides,
  }, { http, now: () => time, sleep: async ms => { waits.push(ms); time += ms; } });
  return { client, requests, waits };
}
test('create uses the v3 contract and always applies the configured ACU limit', async () => {
  const h = harness([fixture('new', null)]);
  const session = await h.client.createSession({ prompt: 'Fix issue', knowledge_ids: ['k1'], max_acu_limit: 999 });
  assert.equal(session.session_id, 'devin-test');
  assert.equal(session.created_at, 1770000000);
  assert.equal(h.requests[0].url, '/organizations/org-test/sessions');
  assert.equal(h.requests[0].method, 'post');
  assert.deepEqual(JSON.parse(h.requests[0].data), {
    prompt: 'Fix issue', knowledge_ids: ['k1'], max_acu_limit: 10,
  });
});
test('current opaque hexadecimal session IDs are accepted', async () => {
  const id = '0123456789abcdef0123456789abcdef';
  const response = {
    ...fixture('new', null),
    session_id: id,
    url: `https://app.devin.ai/sessions/${id}`,
  };
  const h = harness([response, response]);
  assert.equal((await h.client.createSession({ prompt: 'Fix issue' })).session_id, id);
  assert.equal((await h.client.getSession(id)).session_id, id);
  assert.equal(h.requests[1].url, `/organizations/org-test/sessions/${id}`);
});
test('the actual HTTP client config uses Bearer authentication without redirects', () => {
  const client = new DevinClient({ apiKey: 'cog_test', orgId: 'org-test',
    apiBaseUrl: 'https://api.devin.ai/v3', maxAcuLimit: 10 });
  assert.equal(client.client.defaults.headers.Authorization, 'Bearer cog_test');
  assert.equal(client.client.defaults.maxRedirects, 0);
});
test('all documented lifecycle outcomes are distinguished', () => {
  for (const status of ['new', 'claimed', 'resuming', 'running']) {
    assert.equal(sessionOutcome(fixture(status)), 'active');
  }
  assert.equal(sessionOutcome(fixture('running', 'finished')), 'completed');
  assert.equal(sessionOutcome(fixture('exit', null)), 'completed');
  assert.equal(sessionOutcome(fixture('error', null)), 'failed');
  for (const detail of ['waiting_for_user', 'waiting_for_approval']) {
    assert.equal(sessionOutcome(fixture('running', detail)), 'blocked');
  }
  assert.equal(sessionOutcome({ ...fixture('running', 'waiting_for_user'),
    pull_requests: [{ pr_url: 'https://github.com/test/repo/pull/1', pr_state: 'open' }] }), 'completed');
  for (const detail of ['inactivity', 'usage_limit_exceeded', 'out_of_credits', 'error']) {
    assert.equal(sessionOutcome(fixture('suspended', detail)), 'blocked');
  }
});
test('polling stops on running/finished rather than waiting for an invented completed status', async () => {
  const h = harness([fixture('new'), fixture(), fixture('running', 'finished')]);
  const session = await h.client.waitForSessionCompletion('devin-test', 20000, 5000);
  assert.equal(session.status_detail, 'finished');
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.waits, [5000, 5000]);
});
test('GET retries transient failures with backoff and honors Retry-After', async () => {
  const h = harness([{ error: true, status: 503 },
    { error: true, status: 429, headers: { 'retry-after': '3' } }, fixture()]);
  await h.client.getSession('devin-test');
  assert.deepEqual(h.waits, [1000, 3000]);
});
test('GET retries are bounded and permanent errors fail immediately', async () => {
  for (const status of [401, 403, 404, 422]) {
    const h = harness([{ error: true, status }]);
    await assert.rejects(h.client.waitForSessionCompletion('devin-test'), error => error.status === status);
    assert.equal(h.requests.length, 1);
  }
  const h = harness(Array.from({ length: 3 }, () => ({ error: true, status: 500 })));
  await assert.rejects(h.client.getSession('devin-test'));
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.waits, [1000, 2000]);
});
test('session creation is never retried and sanitized errors cannot leak credentials', async () => {
  const h = harness([{ error: true, status: 503 }]);
  await assert.rejects(h.client.createSession({ prompt: 'private task' }), error => {
    assert.match(error.message, /Creation may have succeeded/);
    assert.doesNotMatch(JSON.stringify(error), /cog_|private task|secret request/);
    assert.equal(error.config, undefined);
    return true;
  });
  assert.equal(h.requests.length, 1);
});
test('nested errors retain safe diagnostics without leaking credentials', () => {
  const error = new (require('../dist/devin/client').DevinApiError)(
    'Request with Bearer secret and cog_private failed', 422, false);
  const safe = sanitizeLogMetadata({ error });
  assert.deepEqual(safe.error, {
    name: 'DevinApiError',
    message: 'Request with Bearer [REDACTED] and [REDACTED_DEVIN_KEY] failed',
    status: 422,
    retryable: false,
  });
  assert.doesNotMatch(JSON.stringify(safe), /secret|cog_private/);
});
test('unexpected v1 fields, unknown statuses, and mismatched IDs fail closed', async () => {
  for (const bad of [{ id: 'old-id', status: 'completed' },
    { ...fixture(), status: 'completed' }, { ...fixture(), session_id: 'devin-other' }]) {
    const h = harness([bad]);
    await assert.rejects(h.client.getSession('devin-test'), /Unexpected Devin session response/);
  }
});
test('timeout terminates via DELETE with archive=true and confirms the returned state', async () => {
  const h = harness([fixture(), fixture('suspended', 'user_request')]);
  await assert.rejects(h.client.waitForSessionCompletion('devin-test', 1000, 1000), error => {
    assert.ok(error instanceof SessionTimeoutError);
    assert.equal(error.terminationConfirmed, true);
    return true;
  });
  assert.equal(h.requests[1].method, 'delete');
  assert.equal(h.requests[1].url, '/organizations/org-test/sessions/devin-test');
  assert.deepEqual(h.requests[1].params, { archive: true });
});
test('timeout with failed or still-running termination reports uncertainty', async () => {
  for (const responses of [[fixture(), { error: true, status: 403 }],
    [fixture(), fixture(), fixture(), fixture()]]) {
    const h = harness(responses);
    await assert.rejects(h.client.waitForSessionCompletion('devin-test', 1000, 1000), error => {
      assert.equal(error.terminationConfirmed, false);
      assert.match(error.message, /could not be confirmed/);
      return true;
    });
  }
});
test('placeholder credentials and invalid limits fail before HTTP calls', async () => {
  for (const options of [{ apiKey: 'your_devin_api_key_here' }, { orgId: '' },
    { maxAcuLimit: 0 }, { maxAcuLimit: NaN }]) {
    const h = harness([], options);
    await assert.rejects(h.client.checkAccess());
    assert.equal(h.requests.length, 0);
  }
});
test('read-only access check lists sessions without creating work', async () => {
  const h = harness([{ items: [], has_next_page: false }]);
  await h.client.checkAccess();
  assert.equal(h.requests[0].method, 'get');
  assert.equal(h.requests[0].url, '/organizations/org-test/sessions');
  assert.deepEqual(h.requests[0].params, { first: 1 });
});
