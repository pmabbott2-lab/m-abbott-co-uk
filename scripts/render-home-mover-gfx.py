#!/usr/bin/env python3
"""Home-mover end card + title stills — same high-end navy treatment as remortgage/protect."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ASSETS = Path(
    "/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
)
GFX = ASSETS / "home-mover-gfx"
HOLD = Path(
    "/Users/petermabbott/Projects/m-abbott-co-uk-main/marketing/mortgageeasy-film-hold/protect-gfx"
)
W, H = 1280, 720
NAVY = (13, 27, 42, 255)
GREEN = (34, 197, 94, 255)
GREEN_SOFT = (34, 197, 94, 42)
WHITE = (255, 255, 255, 255)
MINT = (232, 245, 238, 255)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"


def font(size, index=1):
    return ImageFont.truetype(FONT, size, index=index)


def navy_canvas():
    img = Image.new("RGBA", (W, H), NAVY)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((220, 80, 1060, 760), fill=GREEN_SOFT)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    vignette = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    v = ImageDraw.Draw(vignette)
    v.rectangle((0, 0, W, 70), fill=(0, 0, 0, 40))
    v.rectangle((0, H - 80, W, H), fill=(0, 0, 0, 50))
    img.alpha_composite(vignette.filter(ImageFilter.GaussianBlur(24)))
    return img


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def draw_end_card():
    """Match remortgage s7-end / protect end: headline, green accent, short sub."""
    img = navy_canvas()
    d = ImageDraw.Draw(img)
    line1, line2 = "LIFE MOVES ON.", "YOUR MORTGAGE MOVES WITH IT."
    f1, f2 = font(54), font(42)
    w1, _ = text_size(d, line1, f1)
    w2, _ = text_size(d, line2, f2)
    y = 240
    d.text(((W - w1) // 2, y), line1, font=f1, fill=WHITE)
    d.text(((W - w2) // 2, y + 78), line2, font=f2, fill=GREEN)
    rw = 220
    d.rounded_rectangle(((W - rw) // 2, y + 148, (W + rw) // 2, y + 154), 3, fill=GREEN)
    sub = "Your next home. Your next chapter."
    sw, _ = text_size(d, sub, font(24, 0))
    d.text(((W - sw) // 2, 520), sub, font=font(24, 0), fill=MINT)
    return img.convert("RGB")


def main():
    GFX.mkdir(parents=True, exist_ok=True)

    open_src = HOLD / "open-logo.png"
    if open_src.exists():
        (GFX / "open-logo.png").write_bytes(open_src.read_bytes())
    badge = HOLD / "badge-protect.png"
    if badge.exists():
        (GFX / "badge.png").write_bytes(badge.read_bytes())

    draw_end_card().save(GFX / "end.png", quality=95)
    print("wrote", GFX / "end.png")


if __name__ == "__main__":
    main()
