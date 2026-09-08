#!/bin/bash
set -euo pipefail

FFMPEG="/Users/petermabbott/Projects/m-abbott-co-uk-main/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"
ASSETS="/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
GFX="$ASSETS/remortgage-gfx"
WORK="$(mktemp -d)"
OUT="$ASSETS/mortgageeasy-remortgage-draft-v1.mp4"
SITE="/Users/petermabbott/Projects/m-abbott-co-uk-main/marketing/mortgage-hub-website/assets/video/remortgage-draft-v1.mp4"
trap 'rm -rf "$WORK"' EXIT

cp "$GFX/badge.png" "$WORK/badge.png"

ENCODE_V="-an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 -keyint_min 24 -sc_threshold 0 -bf 0 -vsync cfr"

seconds() {
  "$FFMPEG" -i "$1" 2>&1 | python3 -c "import sys,re; m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', sys.stdin.read()); h,mi,s=m.groups(); print(float(h)*3600+float(mi)*60+float(s))" || true
}

encode() {
  local input="$1" output="$2" duration="$3"
  echo "Encode $(basename "$input") ${duration}s"
  "$FFMPEG" -y -i "$input" \
    -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" \
    -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
}

still() {
  local input="$1" output="$2" duration="$3"
  echo "Still $(basename "$input") ${duration}s"
  "$FFMPEG" -y -loop 1 -i "$input" \
    -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" \
    -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
}

badge() {
  local input="$1" output="$2" duration="$3"
  echo "Badge $(basename "$input") ${duration}s"
  "$FFMPEG" -y -i "$input" -loop 1 -i "$WORK/badge.png" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS[v];[1:v]scale=250:-1[mark];[v][mark]overlay=32:24" \
    -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
}

overlay_png() {
  local input="$1" png="$2" output="$3" duration="$4"
  echo "Overlay $(basename "$png") on $(basename "$input")"
  "$FFMPEG" -y -i "$input" -i "$png" -loop 1 -i "$WORK/badge.png" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS[v];[v][1:v]overlay=0:0[o];[2:v]scale=250:-1[mark];[o][mark]overlay=32:24" \
    -t "$duration" $ENCODE_V "$output" >/dev/null 2>&1
}

dissolve() {
  local a="$1" b="$2" overlap="$3" out="$4"
  local da head tail mid
  da="$(seconds "$a")"
  echo "Dissolving $(basename "$a") -> $(basename "$b") over ${overlap}s"
  head="$(python3 -c "print(max(0.2, $da-$overlap))")"
  tail="$(python3 -c "print(max(0.2, $(seconds "$b")-$overlap))")"
  mid="$WORK/diss-mid-$$.mp4"
  "$FFMPEG" -y -i "$a" -i "$b" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,trim=start=${head},setpts=PTS-STARTPTS,format=rgba[a];[1:v]fps=24,scale=1280:720,setsar=1,trim=end=${overlap},setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:st=0:d=${overlap}:alpha=1[b];[a][b]overlay,format=yuv420p" \
    -t "$overlap" $ENCODE_V "$mid" >/dev/null 2>&1
  "$FFMPEG" -y -i "$a" -t "$head" $ENCODE_V "$WORK/diss-a-$$.mp4" >/dev/null 2>&1
  "$FFMPEG" -y -ss "$overlap" -i "$b" -t "$tail" $ENCODE_V "$WORK/diss-b-$$.mp4" >/dev/null 2>&1
  printf "file '%s'\n" "$WORK/diss-a-$$.mp4" "$mid" "$WORK/diss-b-$$.mp4" > "$WORK/diss-$$.txt"
  "$FFMPEG" -y -f concat -safe 0 -i "$WORK/diss-$$.txt" $ENCODE_V "$out" >/dev/null 2>&1
}

join() {
  local list="$1" out="$2"
  "$FFMPEG" -y -f concat -safe 0 -i "$list" $ENCODE_V "$out" >/dev/null 2>&1
}

echo "Padding voice: silent logo, keep through knowing, new close..."
"$FFMPEG" -y -i "$ASSETS/mortgageeasy-remortgage-voiceover.mp3" -t 52.50 -ar 48000 -c:a libmp3lame -b:a 192k "$WORK/vo-head.mp3" >/dev/null 2>&1
"$FFMPEG" -y -f lavfi -t 3.20 -i anullsrc=channel_layout=mono:sample_rate=48000 \
  -i "$WORK/vo-head.mp3" \
  -i "$ASSETS/mortgageeasy-remortgage-vo-close.mp3" \
  -f lavfi -t 1.50 -i anullsrc=channel_layout=mono:sample_rate=48000 \
  -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[a]" -map "[a]" -ar 48000 -c:a libmp3lame -b:a 192k "$WORK/voice.mp3" >/dev/null 2>&1

echo "Photo drop sequence..."
"$FFMPEG" -y -framerate 24 -i "$GFX/photo-drop/f%04d.png" \
  -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" \
  $ENCODE_V "$WORK/07-drop-raw.mp4" >/dev/null 2>&1
badge "$WORK/07-drop-raw.mp4" "$WORK/07-photos.mp4" 6.00

echo "Live over-shoulder adviser..."
badge "$ASSETS/mortgageeasy-remortgage-runway-s5-ots-a.mp4" "$WORK/ots-a.mp4" 10.00
badge "$ASSETS/mortgageeasy-remortgage-runway-s5-ots-b.mp4" "$WORK/ots-b.mp4" 9.67
printf "file '%s'\n" "$WORK/ots-a.mp4" "$WORK/ots-b.mp4" > "$WORK/ots.txt"
join "$WORK/ots.txt" "$WORK/ots-brand.mp4"

echo "Rendering remortgage timeline..."

still "$GFX/open-logo.png" "$WORK/00-open.mp4" 3.75

badge "$ASSETS/mortgageeasy-remortgage-runway-s1-partner.mp4" "$WORK/01-first.mp4" 10.00
dissolve "$WORK/00-open.mp4" "$WORK/01-first.mp4" 0.55 "$WORK/d1.mp4"

badge "$ASSETS/mortgageeasy-runway-family-two-children.mp4" "$WORK/02-door.mp4" 4.56
badge "$ASSETS/mortgageeasy-remortgage-runway-s2-kitchen-serve.mp4" "$WORK/02-dinner.mp4" 5.04
printf "file '%s'\n" "$WORK/02-door.mp4" "$WORK/02-dinner.mp4" > "$WORK/02.txt"
join "$WORK/02.txt" "$WORK/02-life.mp4"

still "$GFX/s3-title.png" "$WORK/03-raw.mp4" 3.39
badge "$WORK/03-raw.mp4" "$WORK/03-easy.mp4" 3.39

encode "$WORK/ots-brand.mp4" "$WORK/04-market.mp4" 9.49
"$FFMPEG" -y -ss 9.49 -i "$WORK/ots-brand.mp4" \
  -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" \
  -t 10.18 $ENCODE_V "$WORK/05-base.mp4" >/dev/null 2>&1
encode "$WORK/05-base.mp4" "$WORK/05a.mp4" 2.00
"$FFMPEG" -y -ss 2.00 -i "$WORK/05-base.mp4" -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" -t 2.00 $ENCODE_V "$WORK/05b-raw.mp4" >/dev/null 2>&1
"$FFMPEG" -y -ss 4.00 -i "$WORK/05-base.mp4" -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" -t 2.00 $ENCODE_V "$WORK/05c-raw.mp4" >/dev/null 2>&1
"$FFMPEG" -y -ss 6.00 -i "$WORK/05-base.mp4" -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" -t 2.04 $ENCODE_V "$WORK/05d-raw.mp4" >/dev/null 2>&1
"$FFMPEG" -y -ss 8.04 -i "$WORK/05-base.mp4" -vf "fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS" -t 2.14 $ENCODE_V "$WORK/05e-raw.mp4" >/dev/null 2>&1
overlay_png "$WORK/05b-raw.mp4" "$GFX/s5-prompts-1.png" "$WORK/05b.mp4" 2.00
overlay_png "$WORK/05c-raw.mp4" "$GFX/s5-prompts-2.png" "$WORK/05c.mp4" 2.00
overlay_png "$WORK/05d-raw.mp4" "$GFX/s5-prompts-3.png" "$WORK/05d.mp4" 2.04
overlay_png "$WORK/05e-raw.mp4" "$GFX/s5-prompts-4.png" "$WORK/05e.mp4" 2.14
printf "file '%s'\n" "$WORK/05a.mp4" "$WORK/05b.mp4" "$WORK/05c.mp4" "$WORK/05d.mp4" "$WORK/05e.mp4" > "$WORK/05.txt"
join "$WORK/05.txt" "$WORK/05-life.mp4"

still "$GFX/s6-stay.png" "$WORK/06-stay-raw.mp4" 4.40
still "$GFX/s6-both.png" "$WORK/06-both-raw.mp4" 2.40
still "$GFX/s6-know.png" "$WORK/06-know-raw.mp4" 3.07
badge "$WORK/06-stay-raw.mp4" "$WORK/06-stay.mp4" 4.40
badge "$WORK/06-both-raw.mp4" "$WORK/06-both.mp4" 2.40
badge "$WORK/06-know-raw.mp4" "$WORK/06-know.mp4" 3.07
printf "file '%s'\n" "$WORK/06-stay.mp4" "$WORK/06-both.mp4" "$WORK/06-know.mp4" > "$WORK/06.txt"
join "$WORK/06.txt" "$WORK/06-choice.mp4"

still "$GFX/s7-timeline-6.png" "$WORK/07-timeline-raw.mp4" 9.43
badge "$WORK/07-timeline-raw.mp4" "$WORK/07-timeline.mp4" 9.43
still "$GFX/s7-end.png" "$WORK/08-end-raw.mp4" 4.72
badge "$WORK/08-end-raw.mp4" "$WORK/08-end.mp4" 4.72

echo "Joining scenes..."
printf "file '%s'\n" \
  "$WORK/d1.mp4" \
  "$WORK/02-life.mp4" \
  "$WORK/03-easy.mp4" \
  "$WORK/04-market.mp4" \
  "$WORK/05-life.mp4" \
  "$WORK/06-choice.mp4" \
  "$WORK/07-photos.mp4" \
  "$WORK/07-timeline.mp4" \
  "$WORK/08-end.mp4" > "$WORK/concat.txt"

"$FFMPEG" -y -f concat -safe 0 -i "$WORK/concat.txt" -i "$WORK/voice.mp3" \
  -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=N/24/TB[v];[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=N/SR/TB[a]" \
  -map "[v]" -map "[a]" -r 24 \
  -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -preset fast -crf 20 \
  -x264opts keyint=24:min-keyint=24:scenecut=0:bframes=0:ref=1 \
  -c:a aac -ar 48000 -ac 2 -b:a 192k \
  -movflags +faststart -video_track_timescale 24000 "$OUT"

mkdir -p "$(dirname "$SITE")"
cp "$OUT" "$SITE"
cp "$OUT" "$HOME/Desktop/MortgageEasy-remortgage-draft-v1.mp4"
echo "$OUT"
"$FFMPEG" -i "$OUT" 2>&1 | python3 -c "import sys,re; t=sys.stdin.read(); m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', t); print('DURATION', m.group(0) if m else 'missing')" || true
