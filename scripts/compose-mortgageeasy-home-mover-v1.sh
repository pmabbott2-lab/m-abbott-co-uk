#!/bin/bash
set -euo pipefail

# Home Mover V1 — Sonia VO + same locked family characters.
FFMPEG="/Users/petermabbott/Projects/m-abbott-co-uk-main/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"
ASSETS="/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
GFX="$ASSETS/home-mover-gfx"
BRAND="/Users/petermabbott/Projects/m-abbott-co-uk-main/marketing/mortgageeasy-film-hold/protect-gfx"
WORK="$(mktemp -d)"
OUT="$ASSETS/mortgageeasy-home-mover-v1.mp4"
SITE="/Users/petermabbott/Projects/m-abbott-co-uk-main/marketing/mortgage-hub-website/assets/video/home-mover-v1.mp4"
trap 'rm -rf "$WORK"' EXIT

# shellcheck disable=SC1091
source "$ASSETS/home-mover-vo-timing.sh"
OPEN_DISSOLVE=0.55
CLOSE_FADE="${CLOSE_FADE:-0.70}"
CLOSE_LOGO="${CLOSE_LOGO:-$(python3 -c "print('{:.2f}'.format($END_HOLD + $CLOSE_FADE))")}"

cp "$BRAND/badge-protect.png" "$WORK/badge.png"
OPEN_LOGO="$BRAND/open-logo.png"
END_CARD="$GFX/end.png"

ENCODE_V="-an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 -keyint_min 24 -sc_threshold 0 -bf 0 -vsync cfr"

seconds() {
  "$FFMPEG" -i "$1" 2>&1 | python3 -c "import sys,re; m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', sys.stdin.read()); h,mi,s=m.groups(); print(float(h)*3600+float(mi)*60+float(s))" || true
}

brand() {
  local input="$1" output="$2" duration="$3" start="${4:-0}" rate="${5:-1}"
  echo "Branding $(basename "$input") to ${duration}s ss=${start} rate=${rate}"
  "$FFMPEG" -y -ss "$start" -i "$input" -loop 1 -i "$WORK/badge.png" \
    -filter_complex "[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,setpts=(PTS-STARTPTS)/${rate}[v];[1:v]format=rgba[mark];[v][mark]overlay=20:16" \
    -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
}

still() {
  local input="$1" output="$2" duration="$3" brand="${4:-1}"
  echo "Still $(basename "$input") ${duration}s brand=${brand}"
  if [[ "$brand" == "1" ]]; then
    "$FFMPEG" -y -loop 1 -i "$input" -loop 1 -i "$WORK/badge.png" \
      -filter_complex "[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,setpts=PTS-STARTPTS[v];[1:v]format=rgba[mark];[v][mark]overlay=20:16" \
      -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
  else
    "$FFMPEG" -y -loop 1 -i "$input" \
      -vf "fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,setpts=PTS-STARTPTS" \
      -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
  fi
}

dissolve() {
  local a="$1" b="$2" overlap="$3" out="$4"
  local da head mid
  da="$(seconds "$a")"
  echo "Dissolving $(basename "$a") -> $(basename "$b") over ${overlap}s"
  head="$(python3 -c "print('{:.2f}'.format(max(0.2, $da - $overlap)))")"
  mid="$WORK/diss-mid.mp4"
  "$FFMPEG" -y -i "$a" -i "$b" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,trim=start=${head},setpts=PTS-STARTPTS,format=rgba[a];[1:v]fps=24,scale=1280:720,setsar=1,trim=end=${overlap},setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:st=0:d=${overlap}:alpha=1[b];[a][b]overlay,format=yuv420p" \
    -t "$overlap" $ENCODE_V "$mid" >/dev/null 2>&1
  "$FFMPEG" -y -i "$a" -t "$head" $ENCODE_V "$WORK/diss-a.mp4" >/dev/null 2>&1
  "$FFMPEG" -y -ss "$overlap" -i "$b" $ENCODE_V "$WORK/diss-b.mp4" >/dev/null 2>&1
  printf "file '%s'\n" "$WORK/diss-a.mp4" "$mid" "$WORK/diss-b.mp4" > "$WORK/diss.txt"
  "$FFMPEG" -y -f concat -safe 0 -i "$WORK/diss.txt" $ENCODE_V "$out" >/dev/null 2>&1
}

join() {
  "$FFMPEG" -y -f concat -safe 0 -i "$1" $ENCODE_V "$2" >/dev/null 2>&1
}

echo "Voice: silent navy open, Sonia read, logo lockout..."
"$FFMPEG" -y \
  -f lavfi -t "$OPEN_DUR" -i anullsrc=channel_layout=mono:sample_rate=48000 \
  -i "$ASSETS/home-mover-vo-full-sonia.mp3" \
  -f lavfi -t "$END_HOLD" -i anullsrc=channel_layout=mono:sample_rate=48000 \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]" \
  -map "[a]" -ar 48000 -c:a libmp3lame -b:a 192k "$WORK/voice.mp3" >/dev/null 2>&1

echo "Rendering home-mover timeline locked to Sonia..."

still "$OPEN_LOGO" "$WORK/00-open.mp4" "$OPEN_DUR" 0

# HOME: established family + kitchen life
HOME_A="$(python3 -c "print('{:.2f}'.format(min(10.0, max(5.0, $HOME * 0.62))))")"
HOME_B="$(python3 -c "print('{:.2f}'.format(max(2.0, $HOME - $HOME_A)))")"
# Prefer character-locked v2 clips; fall back to earlier takes if missing.
S1="$ASSETS/mortgageeasy-home-mover-runway-s1-v2.mp4"
[[ -f "$S1" ]] || S1="$ASSETS/mortgageeasy-home-mover-runway-s1.mp4"
S2="$ASSETS/mortgageeasy-home-mover-runway-s2-v3.mp4"
[[ -f "$S2" ]] || S2="$ASSETS/mortgageeasy-home-mover-runway-s2-v2.mp4"
[[ -f "$S2" ]] || S2="$ASSETS/mortgageeasy-home-mover-runway-s2.mp4"
S3_V2="$ASSETS/mortgageeasy-home-mover-runway-s3-v2.mp4"
[[ -f "$S3_V2" ]] || S3_V2="$ASSETS/mortgageeasy-home-mover-runway-s3-forward.mp4"
[[ -f "$S3_V2" ]] || S3_V2="$ASSETS/mortgageeasy-home-mover-runway-s3.mp4"
FAMILY="$ASSETS/mortgageeasy-runway-family-two-children.mp4"
S5="$ASSETS/mortgageeasy-home-mover-runway-s5-estate.mp4"
SMALLPRINT="$ASSETS/smallprint-on-dark.png"

brand "$S1" "$WORK/01-open-live.mp4" "$(python3 -c "print('{:.2f}'.format(min(10.0, $HOME_A + $OPEN_DISSOLVE)))")"
dissolve "$WORK/00-open.mp4" "$WORK/01-open-live.mp4" "$OPEN_DISSOLVE" "$WORK/d1.mp4"
# Expand pre-laptop lifestyle beats to match VO mention of space/garden.
HOME_BA="$(python3 -c "print('{:.2f}'.format(min(5.04, max(2.0, $HOME_B * 0.58))))")"
HOME_BB="$(python3 -c "print('{:.2f}'.format(max(1.2, $HOME_B - $HOME_BA)))")"
brand "$ASSETS/mortgageeasy-remortgage-runway-s2-kitchen-serve.mp4" "$WORK/01-rest-a.mp4" "$HOME_BA"
brand "$ASSETS/protect-runway-garden.mp4" "$WORK/01-rest-b.mp4" "$HOME_BB"
printf "file '%s'\n" "$WORK/d1.mp4" "$WORK/01-rest-a.mp4" "$WORK/01-rest-b.mp4" > "$WORK/home.txt"
join "$WORK/home.txt" "$WORK/home-block.mp4"

# NEXT: family doorway/stairs earlier (house approach belongs only at the close).
# Play from the start a touch slow so the generative morph/skip reads smoother,
# and stop before the worst end morphs.
FAMILY_SRC="$(seconds "$FAMILY")"
FAMILY_USE="$(python3 -c "print('{:.2f}'.format(min($FAMILY_SRC * 0.88, $NEXT * 0.92)))")"
FAMILY_RATE="$(python3 -c "print('{:.3f}'.format(max(0.82, $FAMILY_USE / max($NEXT, 0.1))))")"
brand "$FAMILY" "$WORK/02-next.mp4" "$NEXT" 0 "$FAMILY_RATE"

# REVIEW: single laptop usage + estate window. Never use broken estate-door clip.
if [[ ! -f "$S5" ]]; then
  echo "Missing estate agent clip" >&2
  exit 1
fi
REVIEW_A="$(python3 -c "print('{:.2f}'.format(min(10.0, $REVIEW)))")"
REVIEW_B="$(python3 -c "print('{:.2f}'.format(max(0.0, $REVIEW - $REVIEW_A)))")"
brand "$S5" "$WORK/03a.mp4" "$REVIEW_A"
if python3 -c "import sys; sys.exit(0 if $REVIEW_B > 0.15 else 1)"; then
  brand "$S2" "$WORK/03b.mp4" "$REVIEW_B"
  printf "file '%s'\n" "$WORK/03a.mp4" "$WORK/03b.mp4" > "$WORK/03.txt"
  join "$WORK/03.txt" "$WORK/03-review.mp4"
else
  cp "$WORK/03a.mp4" "$WORK/03-review.mp4"
fi

# CALL locked to VO duration — do not borrow time from review
brand "$ASSETS/mortgageeasy-runway-matching-adviser-call.mp4" "$WORK/04-call.mp4" "$CALL"

# CLOSE: one longer forward house approach only (no stairs / no second scene).
# s3-v2 starts walking toward camera, then turns toward the house ~2.8s in.
HOUSE_SS=2.80
S3_SRC="$(seconds "$S3_V2")"
HOUSE_AVAIL="$(python3 -c "print('{:.2f}'.format(max(1.0, $S3_SRC - $HOUSE_SS)))")"
HOUSE_RATE="$(python3 -c "print('{:.3f}'.format(min(1.0, max(0.68, $HOUSE_AVAIL / max($CLOSE, 0.1)))))")"
brand "$S3_V2" "$WORK/05-close.mp4" "$CLOSE" "$HOUSE_SS" "$HOUSE_RATE"
echo "Beats HOME=$HOME NEXT=$NEXT REVIEW=$REVIEW CALL=$CALL CLOSE=$CLOSE family_rate=$FAMILY_RATE house_ss=$HOUSE_SS house_rate=$HOUSE_RATE"
SP_START="$(python3 -c "print('{:.2f}'.format($OPEN_DUR + $HOME + $NEXT + $REVIEW + $CALL + $CLOSE))")"

still "$END_CARD" "$WORK/06-end-card.mp4" "$END_TITLE" 0
still "$OPEN_LOGO" "$WORK/07-logo.mp4" "$CLOSE_LOGO" 0
dissolve "$WORK/06-end-card.mp4" "$WORK/07-logo.mp4" "$CLOSE_FADE" "$WORK/06-end.mp4"

echo "Joining scenes..."
printf "file '%s'\n" \
  "$WORK/home-block.mp4" \
  "$WORK/02-next.mp4" \
  "$WORK/03-review.mp4" \
  "$WORK/04-call.mp4" \
  "$WORK/05-close.mp4" \
  "$WORK/06-end.mp4" > "$WORK/concat.txt"

"$FFMPEG" -y -f concat -safe 0 -i "$WORK/concat.txt" -i "$WORK/voice.mp3" \
  -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=N/24/TB[v];[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -r 24 -g 24 -keyint_min 24 -sc_threshold 0 -bf 0 \
  -c:a aac -b:a 192k -movflags +faststart -shortest \
  "$WORK/no-smallprint.mp4" >/dev/null 2>&1

# Add repossession disclaimer at the end to match other films.
"$FFMPEG" -y -i "$WORK/no-smallprint.mp4" -loop 1 -i "$SMALLPRINT" \
  -filter_complex "[0:v][1:v]overlay=0:0:enable='gte(t,${SP_START})'[v]" \
  -map "[v]" -map 0:a \
  -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -r 24 -g 24 -keyint_min 24 -sc_threshold 0 -bf 0 \
  -c:a copy -movflags +faststart -shortest \
  "$OUT" >/dev/null 2>&1

mkdir -p "$(dirname "$SITE")"
cp "$OUT" "$SITE"
echo "Wrote $OUT"
echo "Copied $SITE"
"$FFMPEG" -i "$SITE" 2>&1 | python3 -c "import sys,re; t=sys.stdin.read(); print(re.search(r'Duration: .*', t).group(0)); print(re.search(r'Video: .*', t).group(0)[:140]); print(re.search(r'Audio: .*', t).group(0)[:120])" || true
exit 0
