# Auto IP recovery (Option B) — plan, 2026-10-10 (revised after review)

**Problem.** Every time the server PC's DHCP address changes, two things break:
1. the TLS cert has no SAN for the new IP → tablet refuses the connection;
2. the tablet's saved Server Address points at the old IP.

Name-based access (`DESKTOP-MRE6FRC.bbrouter`) failed on site: the tablet's DNS
(extender `CAI5G_EXT`) answers NXDOMAIN. Operator declined a static IP / reservation.

## Part 1 — one certificate for the whole network (no code)

The tablet can only rediscover the server inside the same /24 (Part 2), so the cert only
needs to cover that /24. Issue it ONCE with all 254 addresses (`192.168.1.1`–`.254`)
plus everything already in `certs/san-list.txt`. Any DHCP address on that network is then
already valid — nothing runs at IP-change time.

- Dev: add the range to `san-list.txt`, run `scripts/refresh-lan-cert.ps1` once.
- Customer: `scripts/install.ps1` writes `IP.1`…`IP.254` for the LAN /24 into the ext
  file it already generates (fresh install). Existing installs reuse their old single-IP
  cert on upgrade → add a one-time re-issue step (signed by the SAME install CA, so the
  tablet keeps trusting it).
- Cost: ~1.5 KB more per TLS handshake.
- Rejected alternative: API re-issues its own cert at runtime (node-forge + 60 s poll +
  hot reload). It would also cover a subnet change, but discovery can't follow a subnet
  change anyway, and it needs the API process to read the **CA private key** — anyone who
  took over the API could then mint certs every tablet trusts.

## Part 2 — tablet finds the server (APK)

- `/api/health` gains `serverId` = the served cert's `authorityKeyIdentifier` (same across
  re-issues by one CA, different per install; no CA file needed).
- Native Capacitor plugin `ServerScanPlugin.java` (pattern: `RfidPlugin.java`): plain TCP
  connect to port 3000 across the /24, 300 ms timeout, 32 threads → list of hosts with
  the port open (~3 s). No WebView sockets — 254 failed HTTPS fetches in the WebView is
  the same pile-up that OOM-crashed it on 2026-07-03.
- New `apps/web/src/lib/server-discovery.ts`: for each open host, ONE HTTPS
  `/api/health`; accept only if TLS is trusted (WebView refuses anything else, so an
  impostor fails) **and** `serverId` matches the one remembered from the last good contact.
  On a match: `setApiBase(new)`, toast "Server moved to https://…".
- Trigger (tablet only): saved address is an IP, Android says network connected, health
  failed 3 polls in a row. **Backoff 2 → 5 → 15 min, then every 15 min**, reset on any
  successful contact — so a switched-off PC doesn't cause constant scanning.
- Server Address screen: **Find server** button (same scan, on demand).
- Hook: `lib/connectivity.ts` probe-failure path only; offline queue / sync engine untouched.

**Limits:** same network (/24) only — if the network changes (e.g. 192.168.1.x → 10.0.0.x)
the operator types the address once; the server must be running.

## Touch points
API: `app.ts` (health `serverId`) + test. Certs: `certs/san-list.txt`, `server.crt`.
Installer: `scripts/install.ps1` (+ upgrade re-issue). APK: new `ServerScanPlugin.java`,
`MainActivity.java` (register). Web: new `lib/server-discovery.ts` + tests,
`lib/connectivity.ts`, `routes/mobile/server-config.tsx`. Docs: CHANGELOG, CLAUDE.md,
DEPLOY-WINDOWS.md, OFFLINE_SYNC_ARCHITECTURE.md, network runbook memory.

## Verification
- [x] Cert: verifies against the APK root (`res/raw/rootca.pem`) with `-verify_ip` on
      .58, .2 and .250.
- [x] Health returns `serverId`; unit test.
- [x] Unit: discovery — match, wrong serverId rejected, TLS failure skipped, backoff.
- [ ] Live tablet: Server Address set to a wrong IP (.59) → app finds .58 on its own;
      Find server button does the same; watch tablet memory during the scan.
- [x] Full API + web suites; installer + upgrade dry-run; APK built, zip-verified.
- [x] Customer apply-addresses end-to-end in a scratch install (create, re-run, name + port change, bad line).
- [ ] Real installer build + install/upgrade on a clean VM (not done).

## Part 3 — one address file, applied everywhere (operator request, 2026-10-10)

`digilog-addresses.ini` — dev: repo root; customer: `C:\ProgramData\DigiLog\config\`.
Sections: `[server]` (address = name/IP, repeatable; URLs accepted), `[ports]` (api, web — web is
dev-only), `[tablet]` + `[in-app settings]` (reference only; DB settings stay in the audited UI).

- [x] `scripts/address-config.ps1` — shared parser/validator + origins builder + env-key writer.
- [x] Dev: `refresh-lan-cert.ps1` reads the ini (replaces `certs/server-addresses.txt`), writes
      `PORT` + `ALLOWED_ORIGINS` into `apps/api/.env`, checks firewall, reloads API + Vite;
      `vite.config.ts` takes both ports from the ini; `apply-addresses.bat` (replaces
      `update-certificate.bat`).
- [x] Customer: `issue-lan-cert.ps1 -ExtraNames` (DNS names too); new `apply-addresses.ps1`
      (cert + digilog.env + firewall + DigiLog.url + restart + health) and self-elevating
      `apply-addresses.cmd`; install creates the ini on a fresh install; upgrade creates it if missing
      and applies it; Start-menu "Edit server addresses" / "Apply server addresses".
- [x] Fix: upgrade health check used http:// against the HTTPS-only API → every upgrade reported
      "not healthy" and exit 1.
- [x] Note: dev `.env` `API_PORT` is read by nothing (app.ts reads `PORT`).
