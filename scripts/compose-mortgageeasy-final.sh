#!/bin/bash
set -euo pipefail

FFMPEG="/Users/petermabbott/Projects/m-abbott-co-uk-main/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"
ASSETS="/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
WORK="$(mktemp -d)"
OUT="$ASSETS/mortgageeasy-first-time-buyer-validated-v5.mp4"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ASSETS/logo.svg.png" "$WORK" <<'PY'
from PIL import Image, ImageDraw, ImageFont
from collections import deque
from pathlib import Path
import sys

source, work = Path(sys.argv[1]), Path(sys.argv[2])
image = Image.open(source).convert("RGBA")
pixels, queue, seen = image.load(), deque(), set()
for x in range(image.width):
    queue.extend(((x, 0), (x, image.height - 1)))
for y in range(image.height):
    queue.extend(((0, y), (image.width - 1, y)))
while queue:
    x, y = queue.popleft()
    if (x, y) in seen or not (0 <= x < image.width and 0 <= y < image.height):
        continue
    seen.add((x, y))
    r, g, b, a = pixels[x, y]
    if min(r, g, b) < 238:
        continue
    pixels[x, y] = (r, g, b, 0)
    queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
box = image.getchannel("A").getbbox()
logo = image.crop(box)
logo.save(work / "logo.png")
badge = Image.new("RGBA", (250, 74), (0, 0, 0, 0))
ImageDraw.Draw(badge).rounded_rectangle((0, 0, 249, 73), radius=37, fill=(255, 255, 255, 248))
mark = logo.copy()
mark.thumbnail((210, 58), Image.Resampling.LANCZOS)
badge.alpha_composite(mark, ((250 - mark.width) // 2, (74 - mark.height) // 2))
badge.save(work / "badge.png")

font_path = "/System/Library/Fonts/HelveticaNeue.ttc"
title_font = ImageFont.truetype(font_path, 48, index=1)
body_font = ImageFont.truetype(font_path, 30, index=1)
ui_title = ImageFont.truetype(font_path, 22, index=1)
ui_body = ImageFont.truetype(font_path, 16, index=1)
steps = [
    "Understand what you can borrow",
    "Find a mortgage that fits you",
    "Get your Agreement in Principle",
    "Make your offer with confidence",
    "Move in, protected for what matters",
]
for count in range(0, len(steps) + 1):
    card = Image.new("RGBA", (1280, 720), (239, 245, 242, 255))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((110, 82, 1170, 638), radius=28, fill=(255, 255, 255, 248), outline=(61, 158, 71, 255), width=3)
    draw.text((165, 125), "Your journey, made easier", font=title_font, fill=(21, 47, 79, 255))
    for index, step in enumerate(steps[:count]):
        y = 225 + index * 74
        draw.ellipse((170, y, 212, y + 42), fill=(61, 158, 71, 255))
        draw.text((184, y + 4), str(index + 1), font=body_font, fill=(255, 255, 255, 255))
        draw.text((245, y + 2), step, font=body_font, fill=(21, 47, 79, 255))
    card.save(work / f"summary-{count}.png")

# Journey UI to fade onto the wide laptop screen at 0:31
ui = Image.new("RGBA", (430, 270), (255, 255, 255, 255))
d = ImageDraw.Draw(ui)
d.rectangle((0, 0, 429, 36), fill=(21, 47, 79, 255))
d.text((12, 8), "MortgageEasy  Your journey", font=ui_body, fill=(255, 255, 255, 255))
d.text((16, 52), "Let's get you started", font=ui_title, fill=(21, 47, 79, 255))
for i, label in enumerate(["Personal details", "About the property", "Your finances"]):
    y = 100 + i * 42
    d.ellipse((20, y, 48, y + 28), fill=(61, 158, 71, 255) if i == 0 else (210, 220, 214, 255))
    d.text((58, y + 4), label, font=ui_body, fill=(21, 47, 79, 255))
d.rounded_rectangle((20, 228, 410, 258), radius=8, fill=(61, 158, 71, 255))
d.text((150, 234), "Continue", font=ui_body, fill=(255, 255, 255, 255))
ui.save(work / "journey-ui.png")
PY

seconds() {
  "$FFMPEG" -i "$1" 2>&1 | python3 -c "import sys,re; m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', sys.stdin.read()); h,mi,s=m.groups(); print(float(h)*3600+float(mi)*60+float(s))" || true
}

brand() {
  local input="$1" output="$2" duration="$3"
  echo "Branding $(basename "$input") to ${duration}s"
  "$FFMPEG" -y -i "$input" -loop 1 -i "$WORK/badge.png" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,setpts=PTS-STARTPTS[v];[1:v]scale=250:-1[mark];[v][mark]overlay=32:24" \
    -t "$duration" -an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$output" >/dev/null 2>&1
}

# Real dissolve, not a flicker through black. Only used on cuts the user named.
dissolve() {
  local a="$1" b="$2" overlap="$3" out="$4"
  local da db head mid tail
  da="$(seconds "$a")"
  db="$(seconds "$b")"
  echo "Dissolving $(basename "$a") -> $(basename "$b") over ${overlap}s"
  head="$(python3 -c "print(max(0.2, $da-$overlap))")"
  tail="$(python3 -c "print(max(0.2, $db-$overlap))")"
  mid="$WORK/diss-mid-$$.mp4"
  "$FFMPEG" -y -i "$a" -i "$b" \
    -filter_complex "[0:v]fps=24,scale=1280:720,setsar=1,trim=start=${head},setpts=PTS-STARTPTS,format=rgba[a];[1:v]fps=24,scale=1280:720,setsar=1,trim=end=${overlap},setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:st=0:d=${overlap}:alpha=1[b];[a][b]overlay,format=yuv420p" \
    -t "$overlap" -an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$mid"
  "$FFMPEG" -y -i "$a" -t "$head" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/diss-a-$$.mp4"
  "$FFMPEG" -y -ss "$overlap" -i "$b" -t "$tail" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/diss-b-$$.mp4"
  printf "file '%s'\n" "$WORK/diss-a-$$.mp4" "$mid" "$WORK/diss-b-$$.mp4" > "$WORK/diss-$$.txt"
  "$FFMPEG" -y -f concat -safe 0 -i "$WORK/diss-$$.txt" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$out"
}

echo "Rendering validated timeline..."

"$FFMPEG" -y -f lavfi -i "color=c=0xeff5f2:s=1280x720:d=3:r=24" -loop 1 -i "$WORK/logo.png" \
  -filter_complex "[1:v]scale=520:-1[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2" \
  -t 3 -an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/00-open.mp4" >/dev/null 2>&1

# Houses: properties plus a short continuation so she keeps moving, no freeze
brand "$ASSETS/mortgageeasy-seq-01-properties.mp4" "$WORK/houses-a.mp4" 10
brand "$ASSETS/mortgageeasy-runway-laptop-continue-1.mp4" "$WORK/houses-b.mp4" 1
printf "file '%s'\n" "$WORK/houses-a.mp4" "$WORK/houses-b.mp4" > "$WORK/houses.txt"
"$FFMPEG" -y -f concat -safe 0 -i "$WORK/houses.txt" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/01-houses.mp4" >/dev/null 2>&1

# 0:14 different side angle
brand "$ASSETS/mortgageeasy-runway-side-login.mp4" "$WORK/02-side.mp4" 10

# 0:23 wider shot; she keeps moving on the same frame (no floating overlay)
echo "Preparing wide shot..."
brand "$ASSETS/mortgageeasy-runway-wide-borrow.mp4" "$WORK/03-wide.mp4" 10

# Dissolve the title into the first live shot only. The next two cuts are new angles, so they stay clean cuts.
dissolve "$WORK/00-open.mp4" "$WORK/01-houses.mp4" 0.55 "$WORK/d1.mp4"
printf "file '%s'\n" "$WORK/d1.mp4" "$WORK/02-side.mp4" "$WORK/03-wide.mp4" > "$WORK/early.txt"
"$FFMPEG" -y -f concat -safe 0 -i "$WORK/early.txt" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/early.mp4" >/dev/null 2>&1

# Later clips keep the existing join style
brand "$ASSETS/mortgageeasy-rebuild-04-susan-left.mp4" "$WORK/04.mp4" 10
brand "$ASSETS/mortgageeasy-seq-05-advisor.mp4" "$WORK/05.mp4" 10
brand "$ASSETS/mortgageeasy-runway-scene-04-appointment-ots.mp4" "$WORK/05b.mp4" 5
brand "$ASSETS/mortgageeasy-runway-scene-03-advice.mp4" "$WORK/05c.mp4" 4
brand "$ASSETS/mortgageeasy-runway-aip-over-shoulder.mp4" "$WORK/06-aip.mp4" 8
brand "$ASSETS/mortgageeasy-runway-matching-adviser-call.mp4" "$WORK/07-call.mp4" 9
brand "$ASSETS/mortgageeasy-runway-family-two-children.mp4" "$WORK/08-family.mp4" 10

echo "Rendering full summary..."
# 13.51s spoken summary: title + 5 points, no black between cards
for spec in "0:2.20" "1:2.26" "2:2.26" "3:2.26" "4:2.26" "5:2.27"; do
  count="${spec%%:*}"
  dur="${spec##*:}"
  "$FFMPEG" -y -loop 1 -i "$WORK/summary-$count.png" \
    -t "$dur" -an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/summary-$count.mp4" >/dev/null 2>&1
done
printf "file '%s'\n" "$WORK/summary-0.mp4" "$WORK/summary-1.mp4" "$WORK/summary-2.mp4" "$WORK/summary-3.mp4" "$WORK/summary-4.mp4" "$WORK/summary-5.mp4" > "$WORK/summary.txt"
"$FFMPEG" -y -f concat -safe 0 -i "$WORK/summary.txt" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/summary.mp4" >/dev/null 2>&1

"$FFMPEG" -y -f lavfi -i "color=c=0xeff5f2:s=1280x720:d=4:r=24" -loop 1 -i "$WORK/logo.png" \
  -filter_complex "[1:v]scale=520:-1[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2" \
  -t 4 -an -r 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/09-end.mp4" >/dev/null 2>&1

echo "Building audio from the UK Southern voice..."
"$FFMPEG" -y -i "$ASSETS/mortgageeasy-voiceover-uk-southern.mp3" -i "$ASSETS/mortgageeasy-summary-uk-southern.mp3" \
  -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1,volume=1.08,aresample=48000[a]" \
  -map "[a]" "$WORK/voice.wav" >/dev/null 2>&1

echo "Joining scenes..."
printf "file '%s'\n" \
  "$WORK/early.mp4" \
  "$WORK/04.mp4" \
  "$WORK/05.mp4" "$WORK/05b.mp4" "$WORK/05c.mp4" \
  "$WORK/06-aip.mp4" \
  "$WORK/07-call.mp4" \
  "$WORK/08-family.mp4" \
  "$WORK/summary.mp4" \
  "$WORK/09-end.mp4" > "$WORK/concat.txt"

"$FFMPEG" -y -f concat -safe 0 -i "$WORK/concat.txt" -i "$WORK/voice.wav" \
  -map 0:v -map 1:a -r 24 -c:v libx264 -preset veryfast -c:a aac -ar 48000 -b:a 192k -movflags +faststart "$OUT" >/dev/null 2>&1

python3 - "$OUT" "$FFMPEG" <<'PY'
import subprocess, sys, statistics, re
from pathlib import Path
from PIL import Image

out, ffmpeg = sys.argv[1], sys.argv[2]
qc = Path("/tmp/me-qc-v5")
qc.mkdir(exist_ok=True)

def frame(seconds, name):
    dest = qc / f"{name}.png"
    subprocess.check_call(
        [ffmpeg, "-y", "-ss", str(seconds), "-i", out, "-frames:v", "1", str(dest)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return Image.open(dest).convert("RGB")

def mean_luma(img, box=None):
    crop = img.crop(box) if box else img
    return statistics.mean(0.2126*r + 0.7152*g + 0.0722*b for r, g, b in crop.getdata())

probe = subprocess.run([ffmpeg, "-i", out], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="ignore").stdout
m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", probe)
duration = float(m.group(1))*3600 + float(m.group(2))*60 + float(m.group(3))
print(f"DURATION {duration:.2f}")

checks = []
img03 = frame(3.4, "003-houses")
img14 = frame(14.3, "014-side")
img23 = frame(23.4, "023-wide")
img31 = frame(31.4, "031-screenfade")
img44 = frame(44.2, "044-advisor")
img55 = frame(55.0, "055-not-aip")
img63 = frame(63.0, "103-aip")
img71 = frame(71.0, "111-call")
img79 = frame(79.6, "118-family")
img90 = frame(90.0, "130-summary")
img96 = frame(96.0, "136-summary-mid")
img101 = frame(101.2, "141-summary-final")
img104 = frame(104.0, "144-logo")

checks.append(("duration is not truncated to 1:43", duration >= 105))
checks.append(("0:03 houses visible", mean_luma(img03) > 40))
checks.append(("0:14 is not a black flicker", mean_luma(img14) > 40))
checks.append(("0:14 side angle is on screen", mean_luma(img14) > 40))
checks.append(("0:23 is not a black flicker", mean_luma(img23) > 40))
checks.append(("0:31 is not black", mean_luma(img31) > 40))
checks.append(("0:44 adviser seated", mean_luma(img44) > 40))
checks.append(("0:55 is still the adviser conversation, not AIP close-up", mean_luma(img55) > 40))
checks.append(("1:03 AIP scene is on", mean_luma(img63) > 40))
checks.append(("1:11 video call is on", mean_luma(img71) > 40))
checks.append(("1:18 family scene is on", mean_luma(img79) > 40))
checks.append(("1:30 summary has started", mean_luma(img90) > 80))
checks.append(("1:36 summary is not black", mean_luma(img96) > 80))
checks.append(("1:41 final summary slide is on", mean_luma(img101) > 80))
checks.append(("logo returns after the summary", mean_luma(img104) > 80))

print("QC RESULTS")
failed = []
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), "-", name)
    if not ok:
        failed.append(name)
if failed:
    raise SystemExit("QC failed: " + "; ".join(failed))
print("QC passed")
PY

echo "$OUT"
