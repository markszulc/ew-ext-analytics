import { LitElement, html, svg, nothing } from 'lit';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/theme-light.js';
import '@spectrum-web-components/theme/scale-medium.js';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/switch/sp-switch.js';
import { METRICS, change, formatMetric, dateWindow, dateLabel, resolvePage, demoReport } from './data.js';
import './styles.css';
import coffeeUrl from './assets/coffee.svg';

const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

const icons = {
  chart: svg`<path d="M4 20h16M7 16v-5m5 5V5m5 11V8"/>`,
  close: svg`<path d="m6 6 12 12M6 18 18 6"/>`,
  chevron: svg`<path d="m9 5 7 7-7 7"/>`,
  down: svg`<path d="m6 9 6 6 6-6"/>`,
  refresh: svg`<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/>`,
  settings: svg`<path d="M9 4h6l1 3 3 1 1 6-3 2-1 3h-6l-1-3-3-1-1-6 3-2z"/><circle cx="12" cy="12" r="3"/>`,
  arrow: svg`<path d="m7 16 10-10M7 6h10v10"/>`,
  document: svg`<path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h6"/>`,
  calendar: svg`<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>`,
  info: svg`<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>`,
  download: svg`<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>`,
  globe: svg`<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>`,
  check: svg`<path d="m5 12 4 4L19 6"/>`,
  desktop: svg`<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>`,
  mobile: svg`<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>`,
  folder: svg`<path d="M3 7V5h7l2 3h9v12H3z"/>`,
  edit: svg`<path d="m4 16 12-12 4 4L8 20H4zm10-10 4 4"/>`,
  search: svg`<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>`,
};
const icon = (name, className = '') => html`<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chart}</svg>`;

class AnalyticsApp extends LitElement {
  static properties = {
    embedded: { type: Boolean, reflect: true },
    days: { state: true }, compare: { state: true }, report: { state: true },
    loading: { state: true }, error: { state: true }, mode: { state: true },
    page: { state: true }, connection: { state: true }, contextError: { state: true },
    selectedPoint: { state: true }, preview: { state: true }, exported: { state: true },
  };

  constructor() {
    super();
    this.days = 30;
    this.compare = true;
    this.mode = 'demo';
    this.page = { path: '/en/journal/the-art-of-slow-mornings', title: 'The Art of Slow Mornings' };
    this.connection = { configured: false };
    this.loading = false;
    this.preview = false;
    this.selectedPoint = null;
    this.requestId = 0;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this.initialize();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.controller?.abort();
    clearTimeout(this.contextTimer);
    clearTimeout(this.exportTimer);
  }

  async initialize() {
    if (this.embedded && window.parent !== window) {
      this.loading = true;
      this.page = { path: '', title: 'Waiting for document…' };
      this.contextTimer = setTimeout(() => {
        this.contextError = 'Workspace has not supplied a document. Reopen Page insights from the document tools panel.';
        this.loading = false;
      }, 12000);
      try {
        const { default: sdk } = await import(/* @vite-ignore */ 'https://da.live/nx/utils/sdk.js');
        const { context } = await sdk;
        clearTimeout(this.contextTimer);
        this.page = resolvePage(context);
        this.contextError = '';
      } catch (error) {
        clearTimeout(this.contextTimer);
        this.contextError = error.message;
        this.loading = false;
        return;
      }
    }
    try {
      if (STATIC_DEMO) throw new Error('This is a static GitHub Pages build, so only demo data is available. Run the Node server to connect Adobe Analytics.');
      const response = await fetch('/api/connection');
      if (!response.ok) throw new Error('Unable to check the Analytics connection.');
      this.connection = await response.json();
    } catch (error) {
      this.connection = { configured: false, error: STATIC_DEMO ? error.message : `${error.message} Demo data remains available.` };
    }
    this.loadReport();
  }

  async loadReport() {
    const requestId = ++this.requestId;
    this.controller?.abort();
    this.controller = new AbortController();
    this.loading = true;
    this.error = '';
    this.selectedPoint = null;
    try {
      let report;
      if (this.mode === 'demo') {
        report = demoReport(this.days);
      } else {
        const query = new URLSearchParams({ path: this.page.path, days: String(this.days) });
        const response = await fetch(`/api/analytics?${query}`, { signal: this.controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Analytics request failed (${response.status}).`);
        report = result;
      }
      if (requestId === this.requestId) this.report = report;
    } catch (error) {
      if (error.name !== 'AbortError' && requestId === this.requestId) {
        this.report = undefined;
        this.error = error.message;
      }
    } finally {
      if (requestId === this.requestId) this.loading = false;
    }
  }

  setRange(event) {
    this.days = Number(event.target.value);
    this.loadReport();
  }

  setMode(mode) {
    this.mode = mode;
    this.querySelector('dialog').close();
    this.report = undefined;
    this.loadReport();
  }

  exportReport() {
    if (!this.report) return;
    const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const { start, end, timeZone } = this.report.period;
    const rows = [
      ['Page insights', this.mode === 'demo' ? 'DEMO DATA - not actual page performance' : 'Adobe Analytics'],
      ['Page', this.page.path], ['Period (calendar dates, exclusive end)', `${new Date(start).toISOString().slice(0, 10)}/${new Date(end).toISOString().slice(0, 10)}`], ['Time zone', timeZone],
      ['Metric', 'Current', 'Previous'],
      ...METRICS.map((metric) => [metric.label, formatMetric(this.report.current[metric.key], metric.percent), formatMetric(this.report.previous[metric.key], metric.percent)]),
      [], ['Traffic channel', 'Page views'], ...this.report.channels.map((row) => [row.name, row.value]),
      [], ['Device', 'Page views'], ...this.report.devices.map((row) => [row.name, row.value]),
    ];
    const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `page-insights-${this.mode}-${this.days}d.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.exported = true;
    clearTimeout(this.exportTimer);
    this.exportTimer = setTimeout(() => { this.exported = false; }, 2500);
  }

  renderShell() {
    return html`
      <header class="workspace-header">
        <div class="workspace-brand"><span class="adobe-mark">A</span><strong>Experience Workspace</strong><span class="preview-badge">Extension preview</span></div>
        <span class="workspace-site">${icon('globe')} Frescopa <span class="avatar">JD</span></span>
      </header>
      <div class="workspace-breadcrumb"><span>Frescopa</span>${icon('chevron')}<span>en</span>${icon('chevron')}<span>journal</span>${icon('chevron')}<strong>the-art-of-slow-mornings</strong><span class="saved">${icon('check')} Preview document</span></div>
      <div class="editor-toolbar"><div class="view-toggle"><button class=${!this.preview ? 'active' : ''} @click=${() => { this.preview = false; }}>${icon('edit')} Content</button><button class=${this.preview ? 'active' : ''} @click=${() => { this.preview = true; }}>${icon('globe')} Preview</button></div><span class="editor-hint">Your content, with a little more context.</span></div>
      <div class="editor-body ${this.preview ? 'is-preview' : ''}">
        <nav class="document-outline" aria-label="Document outline"><span class="eyebrow">ON THIS PAGE</span><span class="outline-item selected">The art of slow mornings</span><span class="outline-item">A moment for yourself</span><span class="outline-item">Make it a ritual</span><div class="outline-note">${icon('info')}A sample document to show the extension in context.</div></nav>
        <div class="document-stage">
          <article class="sample-document">
            <div class="sample-site-header"><span class="frescopa-logo">frescopa<span>®</span></span><span>Our coffee &nbsp;&nbsp; Our story &nbsp;&nbsp; Journal</span></div>
            <div class="article-copy"><span class="article-eyebrow">THE EVERYDAY, A LITTLE BETTER</span><h1>The art of<br>slow mornings.</h1><p>Less rush. More ritual. Discover the simple pleasure of starting your day with intention.</p><span class="article-byline">THE FRESCOPA JOURNAL <span>·</span> 4 MIN READ</span></div>
            <img class="coffee-illustration" src=${coffeeUrl} alt="Illustration of a warm cup of coffee, an open journal and morning sunlight">
            <div class="article-body"><span class="article-eyebrow">A MOMENT FOR YOURSELF</span><h2>Good things take a little time.</h2><p>Before the notifications, the meetings, and the to-do lists, there is a small pocket of possibility. A quiet kitchen. A favourite cup. The unmistakable aroma of freshly brewed coffee.</p><p>It is not about doing more. It is about enjoying what is already here.</p><h2>Make it a ritual.</h2><p>Grind the beans. Warm the cup. Take a breath. Sometimes the smallest moments make the biggest difference.</p></div>
          </article>
          <div class="preview-caption"><span class="tiny-dot"></span> A working extension, right beside your content.</div>
        </div>
      </div>`;
  }

  renderDelta(metric) {
    const current = this.report.current[metric.key];
    const previous = this.report.previous[metric.key];
    const delta = change(current, previous);
    const difference = metric.percent ? (current - previous) * 100 : delta;
    if (delta === null && !metric.percent) return html`<span class="delta neutral">No prior data</span>`;
    const positive = metric.lowerIsBetter ? difference < 0 : difference > 0;
    return html`<span class="delta ${difference === 0 ? 'neutral' : positive ? 'positive' : 'negative'}">${difference > 0 ? '↗' : difference < 0 ? '↘' : '—'} ${Math.abs(difference).toFixed(1)}${metric.percent ? ' pp' : '%'}</span>`;
  }

  renderMetrics() {
    return html`<div class="metrics-grid">${METRICS.map((metric) => html`
      <div class="metric-card">
        <div class="metric-label">${metric.label}<button class="info-button" aria-label=${metric.description} data-tooltip=${metric.description}>${icon('info')}</button></div>
        <div class="metric-value">${formatMetric(this.report.current[metric.key], metric.percent)}</div>
        <div class="metric-comparison">${this.compare ? this.renderDelta(metric) : html`<span class="neutral">Selected period</span>`}</div>
      </div>`)}</div>`;
  }

  renderChart() {
    const series = this.report.series;
    if (!series.length) return html`<div class="empty-chart">No daily page views for this period.</div>`;
    const max = Math.max(1, ...series.map((row) => row.value), ...(this.compare ? series.map((row) => row.previous) : []));
    const ceiling = Math.ceil(max / 300) * 300;
    const x = (index) => 38 + (index / Math.max(1, series.length - 1)) * 312;
    const y = (value) => 154 - (value / ceiling) * 136;
    const line = (key) => series.map((row, i) => `${i ? 'L' : 'M'}${x(i)},${y(row[key])}`).join(' ');
    const selected = this.selectedPoint === null ? null : series[this.selectedPoint];
    return html`<div class="chart-container">
      <svg class="trend-chart" viewBox="0 0 360 190" role="img" aria-label="Daily page views. The solid blue line is the selected period; the dashed line is the previous period.">
        <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#4b75ed" stop-opacity=".16"/><stop offset="100%" stop-color="#4b75ed" stop-opacity="0"/></linearGradient></defs>
        ${[0, 1, 2, 3].map((step) => svg`<line x1="38" y1="${18 + step * 136 / 3}" x2="350" y2="${18 + step * 136 / 3}" stroke="#e9e9ee" stroke-dasharray="3 4"/><text x="28" y="${22 + step * 136 / 3}" text-anchor="end">${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(ceiling * (1 - step / 3))}</text>`)}
        ${svg`<path d="${line('value')} L350,154 L38,154 Z" fill="url(#chart-fill)"/>`}
        ${this.compare ? svg`<path d="${line('previous')}" fill="none" stroke="#a9b5cf" stroke-width="1.8" stroke-dasharray="4 5" stroke-linejoin="round"/>` : nothing}
        ${svg`<path d="${line('value')}" fill="none" stroke="#4775e8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`}
        ${[0, Math.floor((series.length - 1) / 2), series.length - 1].map((i) => svg`<text x="${x(i)}" y="179" text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}">${series[i].label}</text>`)}
        ${selected ? svg`<line x1="${x(this.selectedPoint)}" x2="${x(this.selectedPoint)}" y1="15" y2="154" stroke="#b3c5f8"/><circle cx="${x(this.selectedPoint)}" cy="${y(selected.value)}" r="4.5" fill="#4775e8" stroke="white" stroke-width="2"/>` : nothing}
      </svg>
      <div class="chart-interaction" tabindex="0" role="slider" aria-label="Explore daily page views" aria-valuemin="1" aria-valuemax=${series.length} aria-valuenow=${(this.selectedPoint ?? 0) + 1} aria-valuetext=${selected ? `${selected.label}: ${selected.value} page views` : 'Use arrow keys to explore daily values'}
        @pointermove=${(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          this.selectedPoint = Math.max(0, Math.min(series.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width) * (series.length - 1))));
        }}
        @pointerleave=${() => { this.selectedPoint = null; }}
        @focus=${() => { this.selectedPoint = 0; }}
        @blur=${() => { this.selectedPoint = null; }}
        @keydown=${(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          this.selectedPoint = event.key === 'Home' ? 0 : event.key === 'End' ? series.length - 1 : Math.max(0, Math.min(series.length - 1, (this.selectedPoint ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)));
        }}></div>
      ${selected ? html`<div class="chart-tooltip" role="status"><strong>${selected.label}</strong><span><i></i>${formatMetric(selected.value)} page views</span>${this.compare ? html`<span class="tooltip-previous">Previous: ${formatMetric(selected.previous)}</span>` : nothing}</div>` : nothing}
    </div>`;
  }

  renderChannels() {
    const total = this.report.channels.reduce((sum, row) => sum + row.value, 0);
    if (!total) return html`<p class="empty-note">No traffic channel data for this page.</p>`;
    const top = this.report.channels.slice(0, 4);
    const rest = this.report.channels.slice(4).reduce((sum, row) => sum + row.value, 0);
    const rows = rest ? [...top, { name: 'Other channels', value: rest }] : top;
    return html`<div class="channels">${rows.map((row, i) => html`<div class="channel-row"><div class="channel-heading"><span><span class="channel-dot color-${i % 5}"></span>${row.name}</span><strong>${Math.round(row.value / total * 100)}<span>%</span></strong></div><div class="channel-track"><div class="color-${i % 5}" style=${`width:${row.value / total * 100}%`}></div></div></div>`)}</div>`;
  }

  renderDevices() {
    const total = this.report.devices.reduce((sum, row) => sum + row.value, 0);
    return html`<section class="device-section"><div class="section-heading"><h3>By device</h3><span>Page views</span></div>${total ? html`<div class="device-bar" role="img" aria-label=${this.report.devices.map((row) => `${row.name}: ${Math.round(row.value / total * 100)}%`).join(', ')}>${this.report.devices.map((row, i) => html`<div class="device-color-${i % 4}" style=${`width:${row.value / total * 100}%`}></div>`)}</div><div class="device-legend">${this.report.devices.map((row, i) => html`<span><i class="device-color-${i % 4}"></i>${row.name}<strong>${Math.round(row.value / total * 100)}%</strong></span>`)}</div>` : html`<p class="empty-note">No device data for this page.</p>`}</section>`;
  }

  renderDialog() {
    return html`<dialog class="connection-dialog" @click=${(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div class="dialog-heading"><span class="product-icon">${icon('chart')}</span><sp-action-button quiet aria-label="Close connection settings" @click=${() => this.querySelector('dialog').close()}>${icon('close')}</sp-action-button></div>
      <h2>Your data, in context.</h2><p>Connect Adobe Analytics to see how the page you are editing performs. Credentials stay on your server.</p>
      <div class="connection-option"><span class="status-dot ${this.connection.configured ? 'connected' : ''}"></span><div><strong>${this.connection.configured ? 'Adobe Analytics is configured' : 'Live connection not configured'}</strong><span>${this.connection.configured ? this.connection.suite : 'Set up the server environment to get started.'}</span></div></div>
      ${this.connection.error ? html`<p role="alert" class="dialog-error">${this.connection.error}</p>` : nothing}
      ${!this.connection.configured ? html`<div class="setup-note"><strong>To connect a report suite</strong><ol><li>Create an OAuth Server-to-Server credential in Adobe Developer Console with the Adobe Analytics API.</li><li>Copy <code>.env.example</code> to <code>.env</code> and enter your credentials, company ID and report suite ID.</li><li>Configure the page dimension to match Workspace paths and restart the server.</li></ol><p>For deployment, protect this service with your organization's authentication. See the project README.</p></div>` : nothing}
      <div class="dialog-actions"><sp-button variant="secondary" @click=${() => this.setMode('demo')}>Use demo data</sp-button><sp-button variant="accent" ?disabled=${!this.connection.configured || Boolean(this.contextError) || !this.page.path} @click=${() => this.setMode('live')}>Use live Analytics</sp-button></div>
    </dialog>`;
  }

  renderPanel() {
    const period = this.report?.period || dateWindow(this.days);
    const start = new Date(period.start);
    const end = new Date(period.end);
    const last = new Date(end);
    last.setUTCDate(last.getUTCDate() - 1);
    const noData = this.report && this.report.current.pageviews === 0;
    return html`<aside class="insights-panel" aria-label="Page insights">
      <div class="panel-top"><div class="panel-name">${icon('chart')}<h1>Page insights</h1></div><sp-action-button quiet aria-label="Data connection settings" title="Data connection settings" @click=${() => this.querySelector('dialog').showModal()}>${icon('settings')}</sp-action-button></div>
      <div class="panel-scroll">
        <div class="page-context"><span class="page-document-icon">${icon('document')}</span><div><span class="context-label">${this.embedded && window.parent !== window ? 'CURRENT PAGE' : 'EXAMPLE PAGE'}</span><strong>${this.page.title}</strong><span class="page-path" title=${this.page.path}>${this.page.path}</span></div><span class="context-indicator" title="Page-level report"></span></div>
        ${this.contextError ? html`<div class="error-banner" role="alert">${icon('info')}<span>${this.contextError}</span></div>` : nothing}
        <div class="period-controls"><sp-picker label="Date range" value=${String(this.days)} @change=${this.setRange} ?disabled=${this.loading || Boolean(this.contextError)}>${icon('calendar')}<sp-menu-item value="7">Last 7 days</sp-menu-item><sp-menu-item value="30">Last 30 days</sp-menu-item><sp-menu-item value="90">Last 90 days</sp-menu-item></sp-picker><span class="period-dates">${dateLabel(start)} – ${dateLabel(last)}</span><sp-action-button quiet aria-label="Refresh insights" title="Refresh insights" ?disabled=${this.loading || Boolean(this.contextError)} @click=${this.loadReport}>${icon('refresh', this.loading ? 'spinning' : '')}</sp-action-button></div>
        <div class="compare-control"><sp-switch size="s" ?checked=${this.compare} @change=${(event) => { this.compare = event.target.checked; }}>Compare to previous period</sp-switch><button class="info-button" aria-label="Compares the selected period with the immediately preceding period of the same length." data-tooltip="The immediately preceding period of the same length.">${icon('info')}</button></div>
        <div class="report-content" aria-busy=${this.loading ? 'true' : 'false'}>
          ${this.error ? html`<div class="error-state" role="alert">${icon('info')}<h3>Couldn't load your insights</h3><p>${this.error}</p><sp-button variant="secondary" @click=${this.loadReport}>Try again</sp-button></div>` : nothing}
          ${this.loading && !this.report ? html`<div class="loading-state" role="status"><div class="skeleton"></div><div class="skeleton"></div><span>Gathering your page insights…</span></div>` : nothing}
          ${this.report && !this.error ? html`
            ${noData ? html`<div class="zero-note" role="status">No recorded page views. Check the page-dimension mapping and date range if this is unexpected.</div>` : nothing}
            ${this.renderMetrics()}
            <div class="comparison-note">${this.compare ? `vs. previous ${this.days} days` : 'Comparison hidden'}<span title=${this.report.period?.timeZone || ''}>Completed days only</span></div>
            <section class="trend-section"><div class="section-heading"><h3>Page views over time</h3><span class="daily-badge">Daily</span></div>${this.renderChart()}<div class="chart-legend"><span><i></i>Last ${this.days} days</span>${this.compare ? html`<span><i class="previous-line"></i>Previous ${this.days} days</span>` : nothing}</div></section>
            <section class="traffic-section"><div class="section-heading"><h3 title="Page views attributed to last-touch marketing channels">Where visitors come from</h3><span>Page views</span></div>${this.renderChannels()}</section>
            ${this.renderDevices()}
            <div class="insight-note">${icon('info')}<p>${this.mode === 'demo' ? html`<strong>A glimpse of what's possible.</strong> These are sample metrics, not actual page performance. Connect your report suite to make them yours.` : html`<strong>Insights for the published page.</strong> Unpublished edits aren't reflected in Analytics. Data is subject to your report suite's processing latency.`}</p></div>
          ` : nothing}
        </div>
      </div>
      <footer class="panel-footer"><button class="source-button" @click=${() => this.querySelector('dialog').showModal()}><span class="status-dot ${this.mode === 'live' ? 'connected' : ''}"></span><span>${this.mode === 'demo' ? 'Demo data' : 'Adobe Analytics'}<small>${this.mode === 'demo' ? 'Connect your report suite' : this.report?.suite || this.connection.suite}</small></span>${icon('chevron')}</button><sp-action-button quiet aria-label="Export report as CSV" title="Export report as CSV" ?disabled=${!this.report || this.loading || Boolean(this.error)} @click=${this.exportReport}>${icon(this.exported ? 'check' : 'download')}</sp-action-button></footer>
      <span class="sr-only" role="status">${this.exported ? 'Report exported as CSV.' : ''}</span>
    </aside>`;
  }

  render() {
    return html`<div class=${this.embedded ? 'app embedded-app' : 'app preview-app'}>${!this.embedded ? html`<div class="workspace-shell">${this.renderShell()}</div>` : nothing}${this.renderPanel()}${this.renderDialog()}</div>`;
  }
}

customElements.define('analytics-app', AnalyticsApp);
