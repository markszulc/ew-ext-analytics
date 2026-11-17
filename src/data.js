export const METRICS = [
  { key: 'pageviews', label: 'Page views', description: 'Total views of this page, including repeat views.' },
  { key: 'visitors', label: 'Unique visitors', description: 'Distinct visitors who viewed this page in the selected period.' },
  { key: 'visits', label: 'Visits', description: 'Sessions that included this page.' },
  { key: 'bounceRate', label: 'Bounce rate', description: 'Single-hit visits divided by entries to this page.', percent: true, lowerIsBetter: true },
];

export function change(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function formatMetric(value, percent = false) {
  return percent
    ? new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat('en-US').format(value);
}

export function dateWindow(days, now = new Date(), timeZone) {
  const parts = timeZone
    ? Object.fromEntries(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(now).map(({ type, value }) => [type, value]))
    : { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const end = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const previous = new Date(start);
  previous.setUTCDate(previous.getUTCDate() - days);
  return { start, end, previous };
}

export function dateLabel(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

export function resolvePage(context) {
  if (!context || typeof context.path !== 'string' || !context.path.startsWith('/') || context.path.startsWith('//')) {
    throw new Error('Workspace did not provide a valid document path. Reopen this panel from a document.');
  }
  const path = context.path;
  return { path, title: pageTitle(path), org: context.org, repo: context.repo };
}

export function pageTitle(path) {
  const slug = path.split('/').filter(Boolean).at(-1) || 'Home';
  return decodeURIComponent(slug).replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function demoReport(days, now = new Date()) {
  const { start } = dateWindow(days, now);
  const values = Array.from({ length: days }, (_, i) => {
    const weekday = (start.getUTCDay() + i) % 7;
    return Math.round(460 + 75 * Math.sin(i * 1.8) + i * (100 / days) - ([0, 6].includes(weekday) ? 140 : 0));
  });
  const previousValues = values.map((value, i) => Math.round(value * (0.77 + 0.12 * Math.sin(i * 0.9))));
  const pageviews = values.reduce((sum, value) => sum + value, 0);
  const previousViews = previousValues.reduce((sum, value) => sum + value, 0);
  return {
    source: 'demo',
    suite: 'Frescopa · Web',
    period: { ...dateWindow(days, now), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    fetchedAt: now.toISOString(),
    current: { pageviews, visitors: Math.round(pageviews * 0.647), visits: Math.round(pageviews * 0.792), bounceRate: 0.324 },
    previous: { pageviews: previousViews, visitors: Math.round(previousViews * 0.68), visits: Math.round(previousViews * 0.81), bounceRate: 0.361 },
    series: values.map((value, i) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + i);
      return { label: dateLabel(date), value, previous: previousValues[i] };
    }),
    channels: [
      { name: 'Organic search', value: Math.round(pageviews * 0.46) },
      { name: 'Direct', value: Math.round(pageviews * 0.28) },
      { name: 'Social', value: Math.round(pageviews * 0.16) },
      { name: 'Referral & other', value: pageviews - Math.round(pageviews * 0.46) - Math.round(pageviews * 0.28) - Math.round(pageviews * 0.16) },
    ],
    devices: [
      { name: 'Desktop', value: Math.round(pageviews * 0.58) },
      { name: 'Mobile', value: Math.round(pageviews * 0.37) },
      { name: 'Other', value: pageviews - Math.round(pageviews * 0.58) - Math.round(pageviews * 0.37) },
    ],
  };
}
