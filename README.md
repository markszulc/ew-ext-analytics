# Page insights for Experience Workspace

A first-pass Adobe Analytics side panel built with Lit and **Adobe Spectrum Web Components**. The standalone preview includes a sample Frescopa document; the plugin entry point contains only the responsive insights panel.

The initial experience uses explicitly labeled, deterministic **demo data**, and a demo build is hosted on GitHub Pages. No Adobe account or credentials are needed to try it. Live Analytics requests are implemented server-side, but have not been verified against a real report suite.

## Try it now (GitHub Pages)

A demo-only build is published automatically from `main`:

| What | URL |
| --- | --- |
| Full preview (sample Workspace editor + panel) | https://markszulc.github.io/ew-ext-analytics/ |
| Plugin entry point (register this in Workspace) | https://markszulc.github.io/ew-ext-analytics/tools/analytics.html |

GitHub Pages only hosts static files, so this build always uses **demo data**. The connection dialog explains this. To use live Adobe Analytics, run the Node server described in [Connect Adobe Analytics](#connect-adobe-analytics).

## How to test

### 1. Test in the browser (no Workspace account needed)

Open the **full preview** URL above and check:

- [ ] The panel shows the sample page title and path (`/en/journal/the-art-of-slow-mornings`) and a **Demo data** label.
- [ ] Four metric cards render: Page views, Unique visitors, Visits, Bounce rate.
- [ ] Switching the range picker between **7 / 30 / 90 days** updates the metrics, date range and chart.
- [ ] Toggling **Compare to previous period** shows/hides change indicators. Bounce-rate change is shown in percentage points (`pts`).
- [ ] Hovering the trend chart shows a daily tooltip. Click/Tab into the chart and use **Arrow keys**, **Home** and **End** to move between days.
- [ ] Traffic channel and device breakdowns render.
- [ ] **Refresh** reloads the report.
- [ ] The footer **Demo data** button opens the connection dialog explaining that the Pages build is demo-only.
- [ ] The download button exports a CSV labelled as demo data.
- [ ] Narrow the window (or open the plugin URL directly) — the layout adapts down to a 320px side panel.

Opening the plugin URL directly outside Workspace shows the standalone panel against the sample page.

### 2. Test inside Experience Workspace

You need edit access to an Experience Workspace (da.live) site.

1. Open your site config: `https://da.live/config#/{ORG}/{SITE}/`.
2. Open (or create) the **library** sheet and add a row. Keep existing rows and columns.

   | title | path |
   | --- | --- |
   | Page insights | `https://markszulc.github.io/ew-ext-analytics/tools/analytics.html` |

3. Save, then open any document: `https://da.live/edit#/{ORG}/{SITE}/{DOCUMENT_PATH}`.
4. Open the Library/tools panel and select **Page insights**.
5. Verify the panel header shows the **path of the document you are editing** (from the Workspace SDK `context.path`). The metrics remain demo values on the Pages build.
6. Open a different document and reopen the plugin; the path should update.

If the panel reports that the Workspace context is unavailable, confirm the plugin was opened from Workspace (not a separate tab) and check the browser console for iframe or SDK errors.

### 3. Run it locally

Requires Node.js 22.12+.

```sh
npm install
npm run dev
```

Open `http://localhost:3000` (preview) or `http://localhost:3000/tools/analytics.html` (plugin). If port 3000 is busy, run `npm run dev -- --port 3001` and adjust URLs.

To test your local copy in Workspace, add a library row with `path` = `http://localhost:3000/tools/analytics.html` and `ref` = `local`, then open `https://da.live/edit?ref=local#/{ORG}/{SITE}/{DOCUMENT_PATH}`.

To reproduce the GitHub Pages build locally:

```sh
npm run preview:pages   # http://127.0.0.1:4173/
```

### 4. Automated tests

```sh
npm test                          # Node unit tests (data, dates, API adapter with mocked Adobe responses)
npx playwright install chromium   # first time only
npm run test:browser              # Playwright UI tests (uses port 3001)
npm run build
```

Browser tests cover date ranges, comparison toggling, chart keyboard access, CSV download, connection and error states, a 320px panel, and the official SDK handshake inside an iframe. Live Analytics responses are mocked.

## Deploy your own copy to GitHub Pages

1. Fork or copy this repository.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` runs the unit tests, builds with `VITE_STATIC_DEMO=true`, and deploys `dist/`.
4. Register `https://{USER}.github.io/{REPO}/tools/analytics.html` in your site's library sheet.

The build uses relative asset URLs (`base: './'`), so it works from any sub-path. When you're ready to move it into your own project, copy `src/`, `tools/analytics.html` and the Spectrum dependencies, or host the full Node service for live data.

## Features

Page views, unique visitors, visits, bounce rate, 7/30/90-day ranges, previous-period comparisons, keyboard-accessible daily trends, traffic channels, device breakdowns, refresh, connection settings, and CSV export. Visitor totals are requested for the whole period, not summed from daily unique visitors.

## How it works in Workspace

This is an external Workspace micro-frontend, not a browser extension or a modification to Workspace itself. The plugin preloads and imports the official `https://da.live/nx/utils/sdk.js`, then waits for its MessageChannel handshake. `context.path` supplies the exact site-relative document path; `context.org` and `context.repo` identify the site. Missing context is surfaced as an error instead of silently reporting on a sample page. The SDK's content-access token is **not** reused as an Analytics token. Reopen the plugin after changing documents if the host preserves the iframe.

For live data, serve the panel and `/api` from the same HTTPS origin using the Node service below; static hosting (GitHub Pages, Edge Delivery Services) cannot run the Analytics API.

## Connect Adobe Analytics

1. In Adobe Developer Console, create an **OAuth Server-to-Server** credential with the Adobe Analytics API. Grant its product profile access to the intended report suite, metrics and dimensions.
2. Copy `.env.example` to `.env`. Enter the client ID, client secret, Analytics global company ID and report suite ID. Use the OAuth scopes shown by Developer Console.
3. Set `ANALYTICS_TIME_ZONE` to the exact IANA time zone of the report suite, for example `America/Los_Angeles`. This keeps displayed dates and day-by-day comparisons consistent with Analytics' suite-relative date formulas.
4. Configure `ANALYTICS_PAGE_DIMENSION` to the dimension that stores your exact Workspace content path. The default is `variables/page`. Set `ANALYTICS_PAGE_PREFIX` if it stores an origin before that path. Restart the server.
5. Open connection settings in the panel and choose **Use live Analytics**.

**Page mapping matters.** A Workspace path of `/en/journal/story` is matched with an exact, hit-scoped segment. If your `pageName` is `Frescopa:Journal:Story`, use an eVar containing the path or adapt the server-side mapping. Paths are not silently rewritten: `/index`, `/`, and `/story.html` remain distinct. The single configured report suite applies to this deployment; use separate deployments or an explicit authorized site-to-suite mapping for multiple sites.

The server exchanges credentials with Adobe IMS and requests Analytics 2.0 reports for current/previous totals, daily page views, last-touch marketing channels (`variables/lasttouchchannel`) and mobile-device type (`variables/mobiledevicetype`). Live device labels are preserved as returned by Adobe; they can differ from the simplified demo categories. Date ranges cover completed days, ending at today's midnight in the report suite's time zone. Daily rows are aligned by Analytics' encoded calendar IDs, including zero-traffic days. Unknown API data, denied metrics and truncated results are reported as errors; live failures do not fall back to demo values.

These are metrics for the tracked, published page, not predictions about unpublished edits. Marketing channels must be configured in the report suite. Analytics processing latency and data collection determine freshness.

### Serving a build

```sh
npm run build
npm start
```

The prototype server binds to loopback (`127.0.0.1`) and reads `PORT` (default 3000). Place it behind an HTTPS reverse proxy for hosted iframe access.

**Before deploying live data:** add your organization's authenticated gateway/session validation and report-suite authorization, request throttling, and an appropriate `Content-Security-Policy` with Workspace frame ancestors. This prototype does not implement end-user authentication. Do not expose its Analytics endpoints publicly, put secrets in `VITE_*` variables, or commit `.env`. A Workspace iframe origin/handshake is not authorization to read Analytics.

## References

- [Developing apps & plugins](https://www.aem.live/docs/ew/developing/apps-plugins)
- [Micro-frontends](https://www.aem.live/docs/ew/developing/micro-frontends)
- [Basic plugin registration](https://www.aem.live/docs/ew/developing/micro-frontends/2-build-your-basic-plugin)
- [Experience Workspace lab](https://adobelabs.dev/events/dev-live26/experience-workspace/)
- [Spectrum Web Components](https://opensource.adobe.com/spectrum-web-components/)
- [Analytics Reporting API](https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/)
