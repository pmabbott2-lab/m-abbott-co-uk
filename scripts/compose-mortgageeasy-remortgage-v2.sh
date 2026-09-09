#!/bin/bash
# Remortgage V2 picture lock — no new people, no circumstances graphic.
# Opening is this family's life. Meeting is the front 3-shot already in the
# film, then the locked over-shoulder. Stay stays on the stay line.
set -euo pipefail

FFMPEG="/Users/petermabbott/Projects/m-abbott-co-uk-main/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"
ASSETS="/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
GFX="$ASSETS/remortgage-gfx"
OPEN_LOGO="$ASSETS/protect-gfx/open-logo.png"
BADGE="$ASSETS/protect-gfx/badge-protect.png"
SPINE="$ASSETS/mortgageeasy-remortgage-draft-v2-spine.mp4"
OUT="$ASSETS/mortgageeasy-remortgage-draft-v2.mp4"
SITE="/Users/petermabbott/Projects/m-abbott-co-uk-main/marketing/mortgage-hub-website/assets/video"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ENCODE_V="-an -r 24 -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -preset fast -crf 20 -x264opts keyint=24:min-keyint=24:scenecut=0:bframes=0:ref=1"

brand() {
  local input="$1" output="$2" duration="$3"
  echo "Brand $(basename "$input") ${duration}s"
  "$FFMPEG" -y -i "$input" -loop 1 -i "$BADGE" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS[v];[v][1:v]overlay=20:16" \
    -t "$duration" $ENCODE_V "$output"
}

still() {
  local input="$1" output="$2" duration="$3" branded="${4:-0}"
  echo "Still $(basename "$input") ${duration}s"
  if [[ "$branded" == "1" ]]; then
    "$FFMPEG" -y -loop 1 -i "$input" -loop 1 -i "$BADGE" \
      -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS[v];[v][1:v]overlay=20:16" \
      -t "$duration" $ENCODE_V "$output"
  else
    "$FFMPEG" -y -loop 1 -i "$input" \
      -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" \
      -t "$duration" $ENCODE_V "$output"
  fi
}

# 3.20 + 10.08 + 5.04 + 4.36 + 5.26 + 10.08 = 38.02 locked OTS
still "$OPEN_LOGO" "$WORK/00-open.mp4" 3.20 0
brand "$ASSETS/mortgageeasy-runway-family-two-children.mp4" "$WORK/01-door.mp4" 10.08
brand "$ASSETS/mortgageeasy-remortgage-runway-s2-school.mp4" "$WORK/02-school.mp4" 5.04
brand "$ASSETS/mortgageeasy-remortgage-runway-s2-kitchen-serve.mp4" "$WORK/03-dinner.mp4" 4.36
still "$GFX/s3-title.png" "$WORK/04-title.mp4" 5.26 1
brand "$ASSETS/mortgageeasy-remortgage-runway-s1-partner.mp4" "$WORK/05-front.mp4" 10.08

printf "file '%s'\n" \
  "$WORK/00-open.mp4" \
  "$WORK/01-door.mp4" \
  "$WORK/02-school.mp4" \
  "$WORK/03-dinner.mp4" \
  "$WORK/04-title.mp4" \
  "$WORK/05-front.mp4" > "$WORK/head.txt"
"$FFMPEG" -y -f concat -safe 0 -i "$WORK/head.txt" $ENCODE_V "$WORK/head.mp4"

# Output-seek so stay stays on 46.06
"$FFMPEG" -y -i "$SPINE" -ss 38.02 $ENCODE_V "$WORK/tail.mp4"

printf "file '%s'\n" "$WORK/head.mp4" "$WORK/tail.mp4" > "$WORK/concat.txt"
"$FFMPEG" -y -f concat -safe 0 -i "$WORK/concat.txt" -i "$SPINE" \
  -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=N/24/TB[v];[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=N/SR/TB[a]" \
  -map "[v]" -map "[a]" -r 24 \
  -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -preset fast -crf 20 \
  -x264opts keyint=24:min-keyint=24:scenecut=0:bframes=0:ref=1 \
  -c:a aac -ar 48000 -ac 2 -b:a 192k \
  -movflags +faststart -video_track_timescale 24000 "$OUT"

mkdir -p "$SITE"
cp "$OUT" "$SITE/remortgage-draft-v2.mp4"
cp "$SITE/remortgage-draft-v1.vtt" "$SITE/remortgage-draft-v2.vtt"

echo "$OUT"
"$FFMPEG" -i "$OUT" 2>&1 | python3 -c "import sys,re; t=sys.stdin.read(); m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', t); print('DURATION', m.group(0) if m else 'missing')"
