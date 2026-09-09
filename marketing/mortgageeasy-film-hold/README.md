# MortgageEasy film hold

Amendable components and previous draft cuts for the three customer-journey films.

## Live site films

See `marketing/mortgage-hub-website/assets/video/`:

- `first-time-buyer-draft-v2.mp4`
- `remortgage-draft-v2.mp4`
- `protect-draft-v1.mp4`

## Previous drafts

`previous-drafts/` keeps earlier signed cuts (FTB V1, remortgage V1, remortgage V2 spine) so later amendments can restore them without regenerating.

## Components

- `remortgage-gfx/` — title, stay/switch, timeline, prompt cards (photo-drop frames omitted; regenerate from `scripts/render-remortgage-gfx.py` if needed)
- `protect-gfx/` — navy open/close logo and protect title cards
- `timing/` — VO word timings and picture duration locks
- Compose scripts live in `scripts/compose-mortgageeasy-*.sh`

Do not overwrite live site films in place. Duplicate to a new version when amending.
