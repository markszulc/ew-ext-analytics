import { test } from 'node:test';
import assert from 'node:assert/strict';
import { change, demoReport, dateWindow, resolvePage } from '../src/data.js';
import { reportBody, handleApi, alignDaily } from '../server/api.js';

test('period comparisons handle zero baselines and declining bounce rates', () => {
  assert.equal(change(120, 100), 20);
  assert.equal(change(0, 100), -100);
  assert.equal(change(1, 0), null);
  assert.equal(change(0, 0), 0);
  assert.ok(change(0.324, 0.361) < 0);
});

test('date windows use completed calendar days, including month and year boundaries', () => {
  const { start, end, previous } = dateWindow(7, new Date(2026, 0, 3, 14));
  assert.equal(start.toISOString(), '2025-12-27T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-01-03T00:00:00.000Z');
  assert.equal(previous.toISOString(), '2025-12-20T00:00:00.000Z');
  const sydney = dateWindow(7, new Date('2026-01-02T18:00:00Z'), 'Australia/Sydney');
  const losAngeles = dateWindow(7, new Date('2026-01-02T18:00:00Z'), 'America/Los_Angeles');
  assert.equal(sydney.end.toISOString(), '2026-01-03T00:00:00.000Z');
  assert.equal(losAngeles.end.toISOString(), '2026-01-02T00:00:00.000Z');
});

test('demo reports reconcile daily and breakdown totals for all supported ranges', () => {
  for (const days of [7, 30, 90]) {
    const report = demoReport(days, new Date(2026, 10, 17));
    assert.equal(report.source, 'demo');
    assert.equal(report.series.length, days);
    for (const dimension of ['channels', 'devices']) {
      assert.equal(report[dimension].reduce((sum, row) => sum + row.value, 0), report.current.pageviews);
    }
    assert.equal(report.series.reduce((sum, row) => sum + row.value, 0), report.current.pageviews);
    assert.equal(report.series.reduce((sum, row) => sum + row.previous, 0), report.previous.pageviews);
  }
});

test('Workspace context preserves the exact site-relative document path', () => {
  const result = resolvePage({ org: 'acme', repo: 'web', path: '/journal/slow-mornings' });
  assert.equal(result.path, '/journal/slow-mornings');
  assert.equal(result.title, 'Slow Mornings');
  assert.equal(resolvePage({ path: '/index' }).path, '/index');
  assert.equal(resolvePage({ path: '/acme/web/article.html', org: 'acme', repo: 'web' }).path, '/acme/web/article.html');
  for (const context of [undefined, {}, { path: '//example.com' }, { path: 'relative/path' }]) {
    assert.throws(() => resolvePage(context), /valid document path/);
  }
});

test('Analytics requests use exact page matching and equal-length adjacent date windows', () => {
  const current = reportBody('/journal/slow-mornings', 30);
  const previous = reportBody('/journal/slow-mornings', 30, true);
  assert.equal(current.globalFilters[0].dateRange, 'td-30d/td');
  assert.equal(previous.globalFilters[0].dateRange, 'td-60d/td-30d');
  const segment = current.globalFilters[1].segmentDefinition;
  assert.equal(segment.func, 'segment');
  assert.equal(segment.container.func, 'container');
  assert.equal(segment.container.context, 'hits');
  assert.equal(segment.container.pred.func, 'streq');
  assert.equal(segment.container.pred.str, `${process.env.ANALYTICS_PAGE_PREFIX || ''}/journal/slow-mornings`);
  assert.equal(current.dimension, undefined);
  const daily = reportBody('/journal/slow-mornings', 30, false, 'variables/daterangeday');
  assert.equal(daily.metricContainer.metrics.length, 1);
  assert.equal(daily.settings.dimensionSort, 'asc');
});

test('connection metadata never exposes Analytics credentials', async () => {
  let body;
  await handleApi({ url: '/api/connection', method: 'GET' }, {
    writeHead(status) { assert.equal(status, 200); },
    end(value) { body = JSON.parse(value); },
  });
  assert.deepEqual(Object.keys(body).sort(), ['configured', 'suite']);
});

test('daily series align by encoded calendar dates, not row order or localized display labels', () => {
  const row = (itemId, value) => ({ itemId, value: 'Fiscal calendar display label', data: [value] });
  const period = dateWindow(7, new Date(2026, 0, 8));
  const series = alignDaily(
    { rows: [row('1260007', 70), row('1260001', 10)] },
    { rows: [row('1251131', 50), row('1251125', 5)] },
    7,
    period,
  );
  assert.deepEqual(series[0], { label: 'Jan 1', value: 10, previous: 5 });
  assert.deepEqual(series[1], { label: 'Jan 2', value: 0, previous: 0 });
  assert.deepEqual(series[6], { label: 'Jan 7', value: 70, previous: 50 });
  assert.throws(() => alignDaily({ rows: [row('1261132', 10)] }, { rows: [] }, 7, period), /invalid calendar date/);
});

test('live API exchanges server credentials and returns page-filtered, aligned reports', async (t) => {
  const keys = ['ANALYTICS_CLIENT_ID', 'ANALYTICS_CLIENT_SECRET', 'ANALYTICS_COMPANY_ID', 'ANALYTICS_REPORT_SUITE_ID', 'ANALYTICS_TIME_ZONE'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = key === 'ANALYTICS_TIME_ZONE' ? 'UTC' : 'test-fixture';
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('adobelogin.com')) {
      assert.equal(options.body.get('grant_type'), 'client_credentials');
      return Response.json({ access_token: 'fixture-only-token', expires_in: 3600 });
    }
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(options.headers.Authorization, 'Bearer fixture-only-token');
    assert.equal(body.globalFilters[1].segmentDefinition.container.pred.str, `${process.env.ANALYTICS_PAGE_PREFIX || ''}/journal/test`);
    if (!body.dimension) return Response.json({ summaryData: { totals: [100, 60, 80, 0.3] } });
    if (body.dimension === 'variables/daterangeday') {
      const period = dateWindow(7, new Date(), 'UTC');
      const date = body.globalFilters[0].dateRange.startsWith('td-14d') ? period.previous : period.start;
      const itemId = `${date.getUTCFullYear() - 1900}${String(date.getUTCMonth()).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
      return Response.json({ rows: [{ itemId, value: 'Localized date', data: [100] }] });
    }
    return Response.json({ rows: [{ value: body.dimension === 'variables/lasttouchchannel' ? 'Direct' : 'Other', data: [100] }] });
  });
  let status;
  let body;
  const response = {
    writeHead(value) { status = value; },
    end(value) { body = JSON.parse(value); },
  };
  await handleApi({ url: '/api/analytics?path=%2Fjournal%2Ftest&days=999', method: 'GET' }, response);
  assert.equal(status, 400);
  assert.equal(requests.length, 0);
  await handleApi({ url: '/api/analytics?path=%2Fjournal%2Ftest&days=7', method: 'GET' }, response);
  assert.equal(status, 200);
  assert.equal(body.source, 'live');
  assert.equal(body.current.visitors, 60);
  assert.equal(body.series.length, 7);
  assert.deepEqual(body.series[0], { label: dateLabelForTest(body.period.start), value: 100, previous: 100 });
  assert.equal(body.channels[0].name, 'Direct');
  assert.equal(requests.length, 6);
  assert.ok(!JSON.stringify(body).includes('fixture-only-token'));
});

function dateLabelForTest(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
