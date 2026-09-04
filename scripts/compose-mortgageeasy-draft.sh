#!/bin/bash
set -euo pipefail

FFMPEG="/Users/petermabbott/Projects/m-abbott-co-uk-main/node_modules/@ffmpeg-installer/darwin-x64/ffmpeg"
ASSETS="/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
WORK="$(mktemp -d)"
OUT="$ASSETS/mortgageeasy-first-time-buyer-runway-draft.mp4"
FONT="/System/Library/Fonts/Helvetica.ttc"

trap 'rm -rf "$WORK"' EXIT

LOGO="$ASSETS/logo.svg.png"
python3 - "$LOGO" "$WORK/logo-cropped.png" <<'PY'
from PIL import Image, ImageDraw
from collections import deque
import sys
image = Image.open(sys.argv[1]).convert("RGBA")
pixels = image.load()
queue = deque()
seen = set()
for x in range(image.width):
    queue.extend([(x, 0), (x, image.height - 1)])
for y in range(image.height):
    queue.extend([(0, y), (image.width - 1, y)])
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
logo.save(sys.argv[2])
badge = Image.new("RGBA", (250, 74), (0, 0, 0, 0))
ImageDraw.Draw(badge).rounded_rectangle((0, 0, 249, 73), radius=37, fill=(255, 255, 255, 245))
logo.thumbnail((210, 58), Image.Resampling.LANCZOS)
badge.alpha_composite(logo, ((250 - logo.width) // 2, (74 - logo.height) // 2))
badge.save(sys.argv[2].replace("logo-cropped", "logo-badge"))
pill = Image.new("RGBA", (820, 94), (0, 0, 0, 0))
ImageDraw.Draw(pill).rounded_rectangle((1, 1, 818, 92), radius=46, fill=(255, 255, 255, 248), outline=(61, 158, 71, 255), width=5)
pill.save(sys.argv[2].replace("logo-cropped", "caption-pill"))
PY
"$FFMPEG" -y -f lavfi -i "color=c=0xeff5f2:s=1280x720:d=3:r=24" -loop 1 -i "$WORK/logo-cropped.png" \
  -filter_complex "[1:v]scale=440:-1[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2,fade=t=in:st=0:d=0.7,fade=t=out:st=2.35:d=0.65" \
  -t 3 \
  -an -c:v libx264 -pix_fmt yuv420p "$WORK/00-brand.mp4" >/dev/null 2>&1

cat > "$WORK/caption-01.txt" <<'EOF'
It starts with a feeling.
EOF
cat > "$WORK/caption-02.txt" <<'EOF'
Start by understanding what you could borrow.
EOF
cat > "$WORK/caption-03.txt" <<'EOF'
Technology gives your advisor more time to listen.
EOF
cat > "$WORK/caption-04.txt" <<'EOF'
Your journey, your way.
EOF
cat > "$WORK/caption-05.txt" <<'EOF'
More than a rate. Advice that fits you.
EOF
cat > "$WORK/caption-06.txt" <<'EOF'
Your Agreement in Principle.
EOF
cat > "$WORK/caption-07.txt" <<'EOF'
Ready to make your offer.
EOF
cat > "$WORK/caption-08.txt" <<'EOF'
From application to completion, step by step.
EOF
cat > "$WORK/caption-10.txt" <<'EOF'
Open the door to what comes next.
EOF

python3 - "$WORK" <<'PY'
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys
work = Path(sys.argv[1])
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 30)
for source in work.glob("caption-*.txt"):
    text = source.read_text().strip()
    width = min(980, max(220, ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((0, 0), text, font=font)[2] + 54))
    pill = Image.new("RGBA", (width, 76), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle((2, 2, width - 3, 73), radius=36, fill=(255, 255, 255, 248), outline=(61, 158, 71, 255), width=5)
    draw = ImageDraw.Draw(pill)
    tw = draw.textbbox((0, 0), text, font=font)[2]
    draw.text(((width - tw) / 2, 20), text, font=font, fill=(26, 47, 79, 255))
    pill.save(work / f"pill-{source.stem.removeprefix('caption-')}.png")
PY

VOICE="$ASSETS/mortgageeasy-voiceover-british.mp3"

"$FFMPEG" -y -loop 1 -i "$ASSETS/mortgageeasy-draft-scene-04-offer.png" -t 8.25 \
  -vf "scale=1280:720" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/04-offer-source.mp4" >/dev/null 2>&1
"$FFMPEG" -y -f lavfi -i "color=c=0xeff5f2:s=1280x720:d=4:r=24" -loop 1 -i "$WORK/logo-cropped.png" \
  -filter_complex "[1:v]scale=520:-1[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2,fade=t=in:st=0:d=0.8,fade=t=out:st=3.1:d=0.9" \
  -t 4 -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$WORK/09-end.mp4" >/dev/null 2>&1

for spec in \
  "seq-01-properties:$WORK/caption-01.txt" \
  "seq-02-login:$WORK/caption-02.txt" \
  "seq-03-borrowing:$WORK/caption-03.txt" \
  "seq-04-guided:$WORK/caption-04.txt" \
  "seq-05-advisor:$WORK/caption-05.txt" \
  "seq-06-aip:$WORK/caption-06.txt" \
  "seq-07-offer:$WORK/caption-07.txt" \
  "seq-08-door:$WORK/caption-10.txt"; do
  name="${spec%%:*}"
  caption="${spec#*:}"
  input="$ASSETS/mortgageeasy-$name.mp4"
  caption_id="${caption##*caption-}"
  caption_id="${caption_id%.txt}"
  echo "Preparing $name..."
  "$FFMPEG" -y -i "$input" -loop 1 -i "$WORK/logo-badge.png" -loop 1 -i "$WORK/pill-$caption_id.png" \
    -filter_complex "[1:v]scale=250:-1[mark];[0:v][mark]overlay=32:24[branded];[branded][2:v]overlay=40:585,fade=t=in:st=0:d=0.2,fade=t=out:st=9.8:d=0.2" \
    -t 10 -an -c:v libx264 -preset ultrafast -threads 0 -pix_fmt yuv420p "$WORK/$name.mp4" >/dev/null 2>&1
done

printf "file '%s'\n" "$WORK/00-brand.mp4" "$WORK/seq-01-properties.mp4" "$WORK/seq-02-login.mp4" "$WORK/seq-03-borrowing.mp4" "$WORK/seq-04-guided.mp4" "$WORK/seq-05-advisor.mp4" "$WORK/seq-06-aip.mp4" "$WORK/seq-07-offer.mp4" "$WORK/seq-08-door.mp4" "$WORK/09-end.mp4" > "$WORK/concat.txt"
echo "Joining scenes..."
"$FFMPEG" -y -f concat -safe 0 -i "$WORK/concat.txt" -i "$VOICE" \
  -filter_complex "[1:a]atempo=0.92,volume=1.15[narr];sine=frequency=220:duration=90,volume=0.025[music];[narr][music]amix=inputs=2:duration=longest:dropout_transition=2[a]" \
  -map 0:v -map "[a]" -c:v libx264 -preset ultrafast -c:a aac -shortest -movflags +faststart "$OUT" >/dev/null 2>&1
echo "$OUT"
