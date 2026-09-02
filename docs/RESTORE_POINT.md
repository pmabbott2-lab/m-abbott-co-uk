# Restore point — customer data safety

Tagged snapshots let you roll back application code safely. Database rows created after enhancements remain until reversed manually or restored from a DB backup.

## Current restore point

```bash
cd ~/Projects/m-abbott-co-uk-main
git checkout restore-point-2026-09-02-post-branch-rebuild
npm run build
bash ~/bin/mortgage-hub-stable.sh rebuild
```

## Tags

| Tag | Purpose |
|-----|---------|
| `restore-point-2026-09-02-post-branch-rebuild` | Staff branch nav rebuild (phases 1–7): Customers/Diary/Management/Finance tabs, team roles, diary grid, view-as audit, commission split, QA script |
| `restore-point-2026-09-02-post-enhancements` | Journey, finance pipeline, case details, relationship tab, commission summaries, ngrok demo proxy, auth stability |
| `restore-point-2026-09-01-pre-enhancements` | Before journey/finance/case/relationship build |

## Demo URLs (MortgageEasy + Hub on ngrok)

| URL | Purpose |
|-----|---------|
| `https://another-selector-ranged.ngrok-free.dev/mortgageeasy/` | MortgageEasy marketing site |
| `https://another-selector-ranged.ngrok-free.dev/auth` | Mortgage Hub sign-in / journeys |

Start stack:

```bash
bash scripts/mortgage-hub-stable.sh start
```

Marketing links on ngrok use the same origin for Hub auth and calculator API calls.
