# Restore point — customer data safety

Tagged snapshots let you roll back application code safely. Database rows created after enhancements remain until reversed manually or restored from a DB backup.

## Current restore point

```bash
cd ~/Projects/m-abbott-co-uk-main
git checkout restore-point-2026-09-17-mmh-pre-twilio
npm run build
# Production is Azure (MMH). Do not rebuild Hub onto ngrok.
```

**MMH pre–Twilio cutover** (`restore-point-2026-09-17-mmh-pre-twilio` → commit `0005cd5`):

- Hub live on `https://mymortgagehub.uk` (Azure)
- Advisor booking pool + “I don’t mind”, introducer link fixes, Admin/network commission
- Taken **before** Twilio voice/SMS webhooks moved from ngrok → MMH
- Ngrok kept only for MortgageEasy / Trent Valley marketing until their own domains

### Supabase

| Record | Detail |
|--------|--------|
| Marker row | `public.platform_restore_points` name `restore-point-2026-09-17-mmh-pre-twilio` |
| Counts at tag | 22 auth users, 22 profiles, 9 appointments, 39 sessions |
| Full DB restore | Use **Supabase Dashboard → Database → Backups** (daily physical backup / PITR if enabled). Note the timestamp **2026-09-17 ~08:47 UTC** as the cutover moment. |

> A git tag does **not** restore customer data. Always pair code tags with a Supabase backup/PITR window.

## Tags

| Tag | Purpose |
|-----|---------|
| `restore-point-2026-09-17-mmh-pre-twilio` | MMH live; before Twilio cutover off ngrok |
| `restore-point-2026-09-15-hub-telephony` | Hub telephony: Manage tab, Amend allocate/reallocate, routing rules, Hub Susan VM, AMD |
| `restore-point-2026-09-11-hub-mortgageeasy-trentvalley` | Whole stack lock: MortgageHub, MortgageEasy, Trent Valley marketing |
| `restore-point-2026-09-02-post-branch-rebuild` | Staff branch nav rebuild |
| `restore-point-2026-09-02-post-enhancements` | Journey, finance, cases, relationship, commission |
| `restore-point-2026-09-01-pre-enhancements` | Before journey/finance/case/relationship build |

## Production / demo URLs

| URL | Purpose |
|-----|---------|
| `https://mymortgagehub.uk` | **MMH** — Mortgage Hub production (Azure). Twilio targets this. |
| `https://another-selector-ranged.ngrok-free.dev/mortgageeasy/` | MortgageEasy marketing (laptop/ngrok — until own domain) |
| Trent Valley via ngrok marketing path | Until own domain |

Deploy Hub: push `targeted-features` → GitHub Actions → Azure. Do **not** run `mortgage-hub-stable.sh ensure` for Hub after this cutover (that refreshes ngrok Hub).
