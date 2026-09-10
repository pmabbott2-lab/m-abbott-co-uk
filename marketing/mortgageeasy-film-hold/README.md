# MortgageEasy film hold

Amendable components and previous draft cuts for the customer-journey films.

## Live site films

See `marketing/mortgage-hub-website/assets/video/`:

- `first-time-buyer-draft-v5.mp4`
- `home-mover-v8.mp4`
- `remortgage-draft-v4.mp4`
- `protect-draft-v9.mp4`

## Previous drafts

`previous-drafts/` keeps earlier signed cuts so later amendments can restore them without regenerating. Intermediate site drafts (`*-v2` … prior live) stay beside the live files; do not overwrite locked cuts — duplicate to a new version.

## Components

- `remortgage-gfx/` — title, stay/switch, timeline, prompt cards (photo-drop frames omitted; regenerate from `scripts/render-remortgage-gfx.py` if needed)
- `protect-gfx/` — navy open/close logo and protect title cards
- `ftb-gfx/` — first-time buyer overlays when present
- `timing/` — VO word timings and picture duration locks
- Compose / rebuild: `scripts/generate-journey-compliant-sonia-vo.py`, `scripts/rebuild-ftb-end-and-home-mover.py`, `scripts/compose-mortgageeasy-*.sh`

Do not overwrite live site films in place. Duplicate to a new version when amending.
