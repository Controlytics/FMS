# Deployment Methods — Side-by-Side Comparison & Final Verdict

---

## Feature Comparison

| Factor | A: Native Windows | B: Docker Compose | C: WSL2 Linux | D: Hybrid | E: IIS | F: Cloud |
|---|---|---|---|---|---|---|
| **Setup difficulty** | Medium | Medium | Hard | Hard | Hard | Hard |
| **Ongoing maintenance** | Medium | Low | Medium | High | Medium | Low |
| **Client IT skill needed** | **Low** | High | High | High | Medium | High |
| **Reliability** | Good | Good | **Fragile** | Good | Good | Good* |
| **Internet required** | **No** | **No** | **No** | **No** | **No** | **YES** |
| **Data on-premises** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **No** |
| **21 CFR compliance** | **Easy** | Easy | Easy | Easy | Easy | **Hard** |
| **Cost** | **$0** | License | $0 | License | $0 | **$200+/mo** |
| **Scripts already built** | **Yes** | Partial | Partial | No | No | No |
| **Rollback ease** | Hard | **Easy** | Medium | Medium | Hard | **Easy** |
| **RAM overhead** | **~770 MB** | ~3 GB | ~1.5 GB | ~2 GB | ~800 MB | N/A |
| **Redis quality** | Memurai (clone) | **Real Redis 7** | **Real Redis 7** | **Real Redis 7** | Memurai (clone) | **Managed Redis** |
| **Auto-start on boot** | Manual setup | **Automatic** | Manual | Mixed | **Automatic** | **Managed** |
| **Remote debugging** | Medium | Hard | Medium | Hard | Medium | Hard |
| **Static file performance** | Fast (Nginx) | Fast (Nginx) | Fast (Nginx) | Fast (Nginx) | **Slower (IIS)** | Fast |
| **WebSocket reliability** | **Stable** | **Stable** | Fragile | **Stable** | **Fragile** | **Stable** |

*Cloud reliability depends on internet connectivity

---

## Con Severity Matrix

### Critical Cons (can block deployment)

| Con | Methods Affected |
|---|---|
| Internet required for operation | F (Cloud) |
| Data off-premises (21 CFR compliance) | F (Cloud) |
| Docker Desktop license for enterprise | B (Docker), D (Hybrid) |
| Windows Server version incompatibility | C (WSL2) |
| Port forwarding breaks on reboot | C (WSL2) |

### High-Severity Cons (significant ongoing pain)

| Con | Methods Affected |
|---|---|
| Client IT needs Docker knowledge | B (Docker), D (Hybrid) |
| Client IT needs Linux knowledge | C (WSL2) |
| Two management paradigms | D (Hybrid) |
| IIS reverse proxy complexity | E (IIS) |
| IIS WebSocket fragility | E (IIS) |
| WSL2 networking resets | C (WSL2) |
| Monthly cloud costs | F (Cloud) |
| EMQX not managed in cloud | F (Cloud) |

### Medium-Severity Cons (manageable)

| Con | Methods Affected |
|---|---|
| No isolation (Windows Update risk) | A (Native), E (IIS) |
| Manual version upgrades | A (Native), E (IIS) |
| No easy rollback | A (Native), E (IIS) |
| PM2 auto-start flaky on Windows | A (Native), D (Hybrid) |
| RAM overhead | B (Docker), C (WSL2), D (Hybrid) |
| File I/O slower | B (Docker), C (WSL2) |
| Debugging inside containers | B (Docker) |
| Cross-filesystem speed | C (WSL2) |
| Backup complexity with Docker | B (Docker), D (Hybrid) |

### Low-Severity Cons (minor inconvenience)

| Con | Methods Affected |
|---|---|
| Memurai vs real Redis | A (Native), E (IIS) |
| EMQX Windows build lag | A (Native), E (IIS) |
| Docker image size / disk growth | B (Docker), D (Hybrid) |
| Docker restart loops hiding problems | B (Docker), D (Hybrid) |
| IIS slower static serving | E (IIS) |
| Cloud latency | F (Cloud) |

---

## Decision Matrix by Client Type

### Factory with Windows Server + Basic IT Team
**Winner: Method A (Native Windows)**
- IT team knows Windows, not Docker or Linux
- Data stays on-premises (21 CFR compliance)
- No ongoing cloud costs
- Deployment scripts already exist

### Factory with Windows Server + Technical IT Team
**Winner: Method A or B**
- If IT knows Docker → Method B for easier maintenance
- If IT prefers native → Method A for simplicity

### Enterprise Client Mandating IIS
**Winner: Method E (IIS)**
- Only option when Nginx is not allowed
- Expect extra work for WebSocket configuration

### Multi-Factory with Cloud Preference
**Winner: Method F (Cloud)**
- Centralized data across locations
- Requires reliable internet at all sites
- Requires 21 CFR Part 11 cloud validation

### Dev/Staging Environment
**Winner: Method B (Docker Compose)**
- Quick setup, easy teardown
- Matches production if production uses Docker

---

## Recommendation

### For DigiLog's typical client (single factory, Windows Server, basic IT):

## Method A: Native Windows Install

**Reasons:**

1. **Client compatibility** — Factory IT teams know Windows Services, not Docker/Linux. The learning curve for Method A is the lowest.

2. **21 CFR Part 11** — Data on-premises with full physical control. No cloud compliance complications.

3. **No internet dependency** — Factory operations continue during internet outages. Everything runs on the LAN.

4. **Zero ongoing cost** — Client already has the server. No Docker licenses, no cloud bills.

5. **Scripts ready** — `package-for-production.ps1`, `install-on-target.ps1`, and `DEPLOY-WINDOWS.md` handle the complete deployment flow today.

6. **Proven** — This is how the application has been running during development and testing.

### The only reasons to deviate:

| Situation | Switch to |
|---|---|
| Client specifically requests Docker | Method B |
| Client mandates IIS | Method E |
| Client has no on-premises server | Method F |
| Multiple factories, centralized data | Method F |

---

## Quick Reference: How to Deploy with Method A

```
DEV MACHINE                          CLIENT SERVER
─────────────                        ─────────────
1. Run package script                3. Install prerequisites
   scripts/package-for-               (Node, PG, Memurai,
   production.ps1                      EMQX, Nginx)

2. Transfer ZIP to client     →     4. Unzip to C:\DigiLog\

                                     5. Create databases
                                        (digilog_db + digilog_tsdb)

                                     6. Edit .env (passwords,
                                        JWT secrets, server IP)

                                     7. Run install script
                                        scripts/install-on-target.ps1

                                     8. Configure Nginx
                                        (cert paths, server name)

                                     9. Install rootCA.pem
                                        on tablets

                                     10. Install APK on tablets

                                     11. Verify (section 6 of
                                         DEPLOY-WINDOWS.md)

                                     12. Set up auto-start
                                         (pm2 save, NSSM for Nginx)

                                     13. Configure daily backups
                                         (Task Scheduler + pg_dump)
```

See [DEPLOY-WINDOWS.md](../../DEPLOY-WINDOWS.md) for the complete step-by-step guide.
