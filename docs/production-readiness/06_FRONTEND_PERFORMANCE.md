# 06 — Frontend Performance

What was measured: the **requests the web and tablet front ends generate** (the static audit in
`05a_FRONTEND_STATIC_AUDIT.md`, verified against the running app's behaviour in the load tests) and the
**size of what they download** at production volume. What was **not** measured: render time, memory or
frame rate in a real browser/tablet with those payloads (no Lighthouse/Playwright timing runs were done
— see §4). Bundle numbers are from `vite build` on 2026-10-17.

## 1. Bundle (05a §5)

| Item | Raw | Gzip |
|---|---|---|
| Initial JS (entry + vendor + swr) | ≈ 1.0 MB | ≈ 250 KB |
| Entry chunk alone | 929 KB | 227 KB |
| All JS (86 files) | 4.19 MB | 1.14 MB |
| CSS | 173 KB | 22 KB |
| Service-worker precache (124 files) | 5.52 MB | — |
| Fonts (self-hosted IBM Plex) | 600 KB | — |

The largest optional chunks are the exporters (`exceljs` 915 KB, `jspdf`+autotable 414 KB,
`html2canvas` 196 KB). `exceljs` is loaded on demand; `jspdf` is statically imported by 13 route files, so
it is downloaded for pages that never export. Acceptable on a LAN; the precache means a tablet fetches
5.5 MB once per release. No external runtime URLs (fonts self-hosted) — confirmed, the app works offline
from the internet.

## 2. What a page downloads at production volume (one year of data, 3,000 filters)

Single, uncontended calls, production build:

| Request | Who | Size | Time | Note |
|---|---|---|---|---|
| `GET /api/filters/batch-states` | tablet `/m`, every 30 s + every sync | **11.2 MB** | 0.9–1.4 s after fix 6 (5–7 s before) | 92 % is 5 distinct pipeline graphs repeated 3,038× — the tablet then writes 3,038 IndexedDB rows from it |
| `GET /api/filters/cycles?limit=1000000&includeEvents=true` | tablet Cycles view, every 30 s | ~2 MB (go-live) / **never completes** (one year, > 120 s) | the view downloads every cycle ever recorded |
| `GET /api/assets/instances` | tablet + web filter ops, every 30 s | 2.2 MB | 0.9 s after fix 4 | all 3,232 instances |
| `GET /api/hierarchy/tree` | web filter list, every 30 s | 2.0 MB | 0.7 s after fix 4 | whole tree |
| `GET /api/hierarchy/filters` | web, every 30 s | 1.9 MB | 0.5 s after fix 4 | all filters |
| `GET /api/assets/identifiers` | tablet, every 30 s | 1.1 MB | 0.1 s | all RFID tags |
| `GET /api/pm-schedules/due` | My Tasks, every 30 s | 841 KB | 1.6 s after fix 3 | 185 tasks with per-filter rows |
| `GET /api/filters/cleaning-record?page=1&limit=25` | Cleaning Record | 266 KB | 0.3 s after fix 5 | 25 rows with events |

A tablet sitting on the operations view therefore downloads about **14 MB every 30 s** (batch-states +
instances + identifiers + the smaller polls) ≈ 0.5 MB/s per tablet, 20 MB/s for 40 tablets, before any
operator does anything. On a wired LAN that is bandwidth; on the plant Wi-Fi it is the first thing to
check (not measurable here).

## 3. Polling design (05a §1, confirmed under load)

- About 30 timer-driven SWR polls at 15–60 s; `revalidateOnFocus` refetches on every window focus.
- The tablet's `batch-states` refresh is a side effect of the 30 s `instances` poll
  (`mobile-operations.tsx`: `useEffect` on `instancesData`), not a decision to refresh the offline cache.
- `/api/health` every 15 s per client is never stopped once started.
- The Dry In panel polls `current-state` every 15 s **per drying filter** on screen; the PM Schedules
  page re-fetches every selected year's entries every 15 s.

Under load these are what the server spends its time on (04): read polls, not operator actions.

## 4. Not measured

- Browser render/memory with the 11 MB batch and the 2 MB lists (05a §4 estimates "tens of MB of JS
  heap" for 10k cycle rows on a tablet — an estimate, not a measurement).
- Real tablet (Capacitor WebView) behaviour, RFID scan-to-state latency, IndexedDB write time for 3,038
  cached states per sync.
- Core Web Vitals / Lighthouse on the production build.

These need a real tablet and the client's Wi-Fi; they are listed as NOT TESTED in 12.
