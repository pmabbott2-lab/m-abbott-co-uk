# Restore point — customer data safety

Tagged snapshots let you roll back application code safely. Database rows created after enhancements remain until reversed manually or restored from a DB backup.

## Current restore point

```bash
cd ~/Projects/m-abbott-co-uk-main
git checkout restore-point-2026-09-15-hub-telephony
npm run build
bash ~/bin/mortgage-hub-stable.sh rebuild
```

Covers MortgageHub telephony control (Manage → Telephony Amend, allocate/reallocate, softphone → Hub Susan voicemail, AMD), plus prior MortgageEasy / Trent Valley stack.

Also includes everything locked at `restore-point-2026-09-11-hub-mortgageeasy-trentvalley`.


## Tags

| Tag | Purpose |
|-----|---------|
| `restore-point-2026-09-15-hub-telephony` | Hub telephony: Manage tab, Amend allocate/reallocate, routing rules, Hub Susan VM (skip carrier VM), AMD |
| `restore-point-2026-09-11-hub-mortgageeasy-trentvalley` | Whole stack lock: MortgageHub, MortgageEasy (live+previous films), Trent Valley marketing |
| `restore-point-2026-09-02-post-branch-rebuild` | Staff branch nav rebuild (phases 1–7): Customers/Diary/Management/Finance tabs, team roles, diary grid, view-as audit, commission split, QA script |
| `restore-point-2026-09-02-post-enhancements` | Journey, finance pipeline, case details, relationship tab, commission summaries, ngrok demo proxy, auth stability |
| `restore-point-2026-09-01-pre-enhancements` | Before journey/finance/case/relationship build |

## Production / demo URLs

| URL | Purpose |
|-----|---------|
| `https://mymortgagehub.uk` | Mortgage Hub production (see `docs/DEPLOY_MYMORTGAGEHUB.md`) |
| `https://another-selector-ranged.ngrok-free.dev/mortgageeasy/` | MortgageEasy marketing (laptop/ngrok demo — retire after cutover) |
| `https://another-selector-ranged.ngrok-free.dev/auth` | Mortgage Hub sign-in via ngrok demo |

Start stack (laptop demo only):

```bash
bash scripts/mortgage-hub-stable.sh start
```

Marketing links on ngrok use the same origin for Hub auth and calculator API calls. After production cutover, brand sites should link to `https://mymortgagehub.uk`.
