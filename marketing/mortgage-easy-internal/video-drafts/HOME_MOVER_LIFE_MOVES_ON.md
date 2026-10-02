# Home Mover — “Life Moves On”

**Series:** MortgageEasy journey videos  
**Version:** v1 (live)  
**Brand on screen:** MortgageEasy  
**Status:** Signed-off cut · Sonia VO · locked family · repossession disclaimer on end hold  
**Site files:** `home-mover-v1.mp4` / `home-mover-v1.vtt`

---

## Characters / continuity

- Same family lock as FTB / Remortgage / Protect
- Husband: olive-brown skin, short dark curls, olive shirt over white tee
- Wife: cream knit, shoulder-length brown hair
- Adviser: ~50, greying, navy blazer (video-call clip reused)

---

## Picture sources

| Beat | Source |
|------|--------|
| Open | `protect-gfx/open-logo.png` |
| Home | `mortgageeasy-home-mover-runway-s1-v2.mp4` + kitchen + garden |
| Next | `mortgageeasy-runway-family-two-children.mp4` (doorway/stairs) |
| Review | estate window + laptop (`s5-estate`, `s2-v3`) |
| Call | `mortgageeasy-runway-matching-adviser-call.mp4` |
| Close | longer UK house approach from `s3-v2` |
| End | end card → logo + `smallprint-on-dark.png` |

## Rebuild

```bash
python3 scripts/generate-home-mover-sonia-vo.py
python3 scripts/render-home-mover-gfx.py
scripts/compose-mortgageeasy-home-mover-v1.sh
```
