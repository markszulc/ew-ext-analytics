import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { dateWindow, dateLabel } from '../src/data.js';

if (existsSync('.env')) loadEnvFile('.env');

const required = ['ANALYTICS_CLIENT_ID', 'ANALYTICS_CLIENT_SECRET', 'ANALYTICS_COMPANY_ID', 'ANALYTICS_REPORT_SUITE_ID', 'ANALYTICS_TIME_ZONE'];
let cachedToken;
let tokenExpires = 0;

export function connection() {
  return {
    configured: required.every((key) => Boolean(process.env[key])),
    suite: process.env.ANALYTICS_REPORT_SUITE_NAME || process.env.ANALYTICS_REPORT_SUITE_ID || '',
  };
}

export function reportBody(path, days, previous = false, dimension) {
  const dimensionId = process.env.ANALYTICS_PAGE_DIMENSION || 'variables/page';
  return {
    rsid: process.env.ANALYTICS_REPORT_SUITE_ID,
    globalFilters: [
      { type: 'dateRange', dateRange: previous ? `td-${days * 2}d/td-${days}d` : `td-${days}d/td` },
      {
        type: 'segment',
        segmentDefinition: {
          func: 'segment',
          version: [1, 0, 0],
          container: {
            func: 'container',
            context: 'hits',
            pred: { func: 'streq', str: `${process.env.ANALYTICS_PAGE_PREFIX || ''}${path}`, val: { func: 'attr', name: dimensionId } },
          },
        },
      },
    ],
    metricContainer: {
      metrics: (dimension ? ['pageviews'] : ['pageviews', 'visitors', 'visits', 'bouncerate'])
        .map((metric, i) => ({ columnId: String(i), id: `metrics/${metric}` })),
    },
    ...(dimension ? { dimension } : {}),
    settings: { limit: 1000, page: 0, ...(dimension === 'variables/daterangeday' ? { dimensionSort: 'asc' } : {}) },
  };
}

async function adobeJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
  if (!response.ok) {
    const error = new Error(`Adobe returned HTTP ${response.status}. Check the server's Analytics credentials, product profile, report suite and dimension permissions.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function accessToken() {
  if (cachedToken && Date.now() < tokenExpires) return cachedToken;
  const result = await adobeJson('https://ims-na1.adobelogin.com/ims/token/v3', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ANALYTICS_CLIENT_ID,
      client_secret: process.env.ANALYTICS_CLIENT_SECRET,
      scope: process.env.ANALYTICS_SCOPES || 'openid,AdobeID,read_organizations,additional_info.projectedProductContext',
    }),
  });
  if (!result.access_token) throw new Error('Adobe IMS did not return an access token.');
  cachedToken = result.access_token;
  tokenExpires = Date.now() + (Number(result.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

function totals(result) {
  const data = result.summaryData?.totals;
  if (!Array.isArray(data) || data.length !== 4 || data.some((value) => !Number.isFinite(value))) {
    throw new Error('Analytics returned incomplete metric totals.');
  }
  return { pageviews: data[0], visitors: data[1], visits: data[2], bounceRate: data[3] };
}

function rows(result) {
  if (!Array.isArray(result.rows)) throw new Error('Analytics returned an invalid dimension report.');
  return result.rows.map((row) => {
    if (typeof row.value !== 'string' || !Number.isFinite(row.data?.[0])) throw new Error('Analytics returned an invalid dimension row.');
    return { name: row.value, value: row.data[0] };
  });
}

export function alignDaily(current, previous, days, period) {
  const valuesByDay = (result) => {
    rows(result);
    return new Map(result.rows.map((row) => {
      const id = String(row.itemId);
      if (!/^\d{6,7}$/.test(id)) throw new Error('Analytics returned an invalid daily date identifier.');
      const year = Number(id.slice(0, -4)) + 1900;
      const month = Number(id.slice(-4, -2));
      const day = Number(id.slice(-2));
      const date = new Date(Date.UTC(year, month, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
        throw new Error('Analytics returned an invalid calendar date.');
      }
      return [date.toISOString().slice(0, 10), row.data[0]];
    }));
  };
  const currentDays = valuesByDay(current);
  const previousDays = valuesByDay(previous);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(period.start);
    const priorDate = new Date(period.previous);
    date.setUTCDate(date.getUTCDate() + i);
    priorDate.setUTCDate(priorDate.getUTCDate() + i);
    return {
      label: dateLabel(date),
      value: currentDays.get(date.toISOString().slice(0, 10)) ?? 0,
      previous: previousDays.get(priorDate.toISOString().slice(0, 10)) ?? 0,
    };
  });
}

export async function handleApi(req, res) {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
  if (url.pathname === '/api/connection') return send(200, connection());
  if (url.pathname !== '/api/analytics') return send(404, { error: 'API route not found.' });
  if (!connection().configured) return send(503, { error: 'Live Analytics is not configured. Configure the server environment or use demo data.' });
  const path = url.searchParams.get('path');
  const days = Number(url.searchParams.get('days'));
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.length > 2048 || ![7, 30, 90].includes(days)) {
    return send(400, { error: 'A valid page path and a 7, 30 or 90 day range are required.' });
  }
  try {
    const now = new Date();
    const period = { ...dateWindow(days, now, process.env.ANALYTICS_TIME_ZONE), timeZone: process.env.ANALYTICS_TIME_ZONE };
    const token = await accessToken();
    const report = async (previous, dimension) => {
      const result = await adobeJson(
        `https://analytics.adobe.io/api/${encodeURIComponent(process.env.ANALYTICS_COMPANY_ID)}/reports`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'x-api-key': process.env.ANALYTICS_CLIENT_ID, 'x-proxy-global-company-id': process.env.ANALYTICS_COMPANY_ID, 'Content-Type': 'application/json' },
          body: JSON.stringify(reportBody(path, days, previous, dimension)),
        },
      );
      if (result.columns?.columnErrors?.length) throw new Error('Analytics could not return a requested metric. Check metric permissions and report suite configuration.');
      if (result.lastPage === false) throw new Error('Analytics returned a truncated report. Narrow the configured dimension before using this report.');
      return result;
    };
    const [current, previous, series, previousSeries, channels, devices] = await Promise.all([
      report(false), report(true), report(false, 'variables/daterangeday'),
      report(true, 'variables/daterangeday'), report(false, 'variables/lasttouchchannel'), report(false, 'variables/mobiledevicetype'),
    ]);
    send(200, {
      source: 'live', suite: connection().suite, fetchedAt: new Date().toISOString(),
      period,
      current: totals(current), previous: totals(previous),
      series: alignDaily(series, previousSeries, days, period),
      channels: rows(channels).sort((a, b) => b.value - a.value),
      devices: rows(devices).sort((a, b) => b.value - a.value),
    });
  } catch (error) {
    if (error.status === 401) { cachedToken = undefined; tokenExpires = 0; }
    console.error('Analytics report failed:', error.message);
    send(502, { error: error.message });
  }
}
