#!/usr/bin/env python3
"""Rebuild remortgage branded stills, reverse logo lockups, and slower photo drops."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ASSETS = Path("/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets")
GFX = ASSETS / "remortgage-gfx"
DROP = GFX / "photo-drop"
W, H = 1280, 720

NAVY = (13, 27, 42, 255)
NAVY_LIFT = (21, 40, 58, 255)
CARD = (23, 46, 66, 240)
GREEN = (34, 197, 94, 255)
GREEN_SOFT = (34, 197, 94, 42)
WHITE = (255, 255, 255, 255)
MINT = (232, 245, 238, 255)
MUTED = (168, 197, 184, 255)
PHOTO_BG = (239, 245, 242, 255)
SHADOW = (8, 16, 24, 90)

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"


def font(size, index=1):
    return ImageFont.truetype(FONT, size, index=index)


def logo_on_dark(src: Image.Image) -> Image.Image:
    src = src.convert("RGBA")
    out = src.copy()
    px, dst = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            if a < 12:
                continue
            if r < 70 and g < 80 and b < 110 and g <= r + 35:
                # Navy wordmark and tagline become reverse white / mint.
                if r + g + b < 90:
                    dst[x, y] = (255, 255, 255, a)
                else:
                    dst[x, y] = (232, 245, 238, a)
    return out


def paste_center(base, layer, xy, alpha=255):
    if alpha < 255:
        layer = layer.copy()
        a = layer.split()[3].point(lambda p: int(p * alpha / 255))
        layer.putalpha(a)
    x, y = int(xy[0]), int(xy[1])
    base.alpha_composite(layer, (x, y))


def scaled_logo(logo, width):
    ratio = width / logo.width
    return logo.resize((width, max(1, int(logo.height * ratio))), Image.Resampling.LANCZOS)


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


def draw_house_icon(draw, x, y, size=36, active=True):
    color = GREEN if active else (140, 168, 156, 255)
    s = size
    draw.line([(x, y + s * 0.45), (x + s * 0.5, y), (x + s, y + s * 0.42)], fill=color, width=3)
    draw.rectangle((x + 6, y + int(s * 0.42), x + s - 6, y + s), outline=color, width=3)
    draw.rectangle((x + s * 0.4, y + s * 0.58, x + s * 0.6, y + s * 0.82), outline=color, width=2)


def draw_switch_icon(draw, x, y, size=36, active=True):
    color = GREEN if active else (140, 168, 156, 255)
    draw.arc((x, y + 6, x + size, y + size - 2), 40, 220, fill=color, width=3)
    draw.polygon(
        [(x + size - 4, y + 8), (x + size - 16, y + 4), (x + size - 12, y + 18)],
        fill=color,
    )
    draw.arc((x, y + 2, x + size, y + size - 6), 220, 40, fill=color, width=3)
    draw.polygon(
        [(x + 4, y + size - 10), (x + 16, y + size - 6), (x + 12, y + size - 20)],
        fill=color,
    )


def choice_card(title, subtitle, active, icon="house"):
    cw, ch = 470, 300
    card = Image.new("RGBA", (cw + 24, ch + 24), (0, 0, 0, 0))
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((8, 12, cw + 20, ch + 20), 28, fill=SHADOW)
    card.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(8)))
    d = ImageDraw.Draw(card)
    fill = CARD if active else (18, 34, 48, 200)
    outline = GREEN if active else (255, 255, 255, 48)
    d.rounded_rectangle((4, 4, cw + 4, ch + 4), 24, fill=fill, outline=outline, width=3)
    if active:
        d.rounded_rectangle((4, 4, cw + 4, 18), 24, fill=GREEN)
        d.rectangle((4, 14, cw + 4, 22), fill=GREEN)
    icon_box = (36, 46)
    if icon == "house":
        draw_house_icon(d, icon_box[0], icon_box[1], 34, active)
    else:
        draw_switch_icon(d, icon_box[0], icon_box[1], 34, active)
    title_c = WHITE if active else (210, 224, 218, 255)
    sub_c = MINT if active else MUTED
    d.text((36, 108), title, font=font(54), fill=title_c)
    d.text((36, 182), subtitle, font=font(22, 0), fill=sub_c)
    if active:
        d.text((36, 236), "A genuine option", font=font(16, 0), fill=GREEN)
    else:
        d.text((36, 236), "Worth reviewing", font=font(16, 0), fill=MUTED)
    return card


def draw_choice(mode):
    img = navy_canvas()
    d = ImageDraw.Draw(img)
    kicker = "STAY OR SWITCH"
    tw, _ = text_size(d, kicker, font(16, 0))
    d.text(((W - tw) // 2, 118), kicker, font=font(16, 0), fill=MUTED)

    stay = choice_card("STAY", "Your existing lender", active=True, icon="house")
    switch = choice_card("SWITCH", "A new lender", active=(mode != "stay"), icon="switch")
    y = 158
    paste_center(img, stay, (130, y))
    paste_center(img, switch, (680, y))
    if mode == "know":
        msg = "The important thing is knowing."
        mw, _ = text_size(d, msg, font(28))
        d.rounded_rectangle(((W - 120) // 2, 608, (W + 120) // 2, 614), 3, fill=GREEN)
        d.text(((W - mw) // 2, 628), msg, font=font(28), fill=WHITE)
    return img.convert("RGB")


def draw_title(end=False):
    img = navy_canvas()
    d = ImageDraw.Draw(img)
    line1, line2 = "DON'T JUST RENEW.", "REVIEW."
    f1, f2 = font(58), font(84)
    w1, _ = text_size(d, line1, f1)
    w2, _ = text_size(d, line2, f2)
    y = 250 if end else 268
    d.text(((W - w1) // 2, y), line1, font=f1, fill=WHITE)
    d.text(((W - w2) // 2, y + 86), line2, font=f2, fill=GREEN)
    rw = 200
    d.rounded_rectangle(((W - rw) // 2, y + 192, (W + rw) // 2, y + 198), 3, fill=GREEN)
    if end:
        sub = "Your mortgage. Your circumstances. Your choice."
        sw, _ = text_size(d, sub, font(24, 0))
        d.text(((W - sw) // 2, 540), sub, font=font(24, 0), fill=MINT)
    return img.convert("RGB")


def draw_timeline():
    img = navy_canvas()
    d = ImageDraw.Draw(img)
    heading = "Your mortgage journey"
    hw, _ = text_size(d, heading, font(28))
    d.text(((W - hw) // 2, 130), heading, font=font(28), fill=WHITE)
    labels = ["FIRST HOME", "REVIEW", "REMORTGAGE", "LIFE CHANGES", "REVIEW", "PAID OFF"]
    x0, x1, y = 90, 1190, 350
    d.line([(x0, y), (x1, y)], fill=(34, 197, 94, 90), width=6)
    d.line([(x0, y), (x1, y)], fill=GREEN, width=3)
    for i, label in enumerate(labels):
        x = x0 + int((x1 - x0) * i / (len(labels) - 1))
        d.ellipse((x - 14, y - 14, x + 14, y + 14), fill=NAVY, outline=GREEN, width=4)
        d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=GREEN)
        tw, _ = text_size(d, label, font(14))
        d.text((x - tw / 2, y + 28), label, font=font(14), fill=WHITE)
    line = "Mortgage Easy is here throughout."
    lw, _ = text_size(d, line, font(32))
    d.text(((W - lw) // 2, 560), line, font=font(32), fill=WHITE)
    return img.convert("RGB")


def shift_prompts(down=96):
    for i in range(1, 5):
        path = GFX / f"s5-prompts-{i}.png"
        im = Image.open(path).convert("RGBA")
        out = Image.new("RGBA", im.size, (0, 0, 0, 0))
        bbox = im.getbbox()
        if bbox and bbox[1] < 80:
            out.alpha_composite(im, (0, down))
            out.save(path)


def cover_crop(im, w, h):
    im = im.convert("RGB")
    scale = max(w / im.width, h / im.height)
    nw, nh = int(im.width * scale), int(im.height * scale)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - w) // 2
    top = max(0, (nh - h) // 2 - int(h * 0.04))
    return im.crop((left, top, left + w, top + h))


def make_polaroid(photo, pw=390, ph=430):
    frame_w, frame_h = pw + 36, ph + 86
    card = Image.new("RGBA", (frame_w + 28, frame_h + 28), (0, 0, 0, 0))
    sh = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((10, 16, frame_w + 18, frame_h + 22), 8, fill=(20, 30, 28, 70))
    card.alpha_composite(sh.filter(ImageFilter.GaussianBlur(7)))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((6, 6, frame_w + 6, frame_h + 6), 6, fill=WHITE)
    photo = cover_crop(photo, pw, ph)
    card.paste(photo, (24, 24))
    return card


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def render_photo_drop(photos):
    DROP.mkdir(exist_ok=True)
    for old in DROP.glob("f*.png"):
        old.unlink()
    polaroids = [make_polaroid(p) for p in photos]
    rests = [
        {"x": 430, "y": 118, "rot": -8},
        {"x": 470, "y": 132, "rot": 4},
        {"x": 448, "y": 148, "rot": -3},
        {"x": 462, "y": 138, "rot": 6},
    ]
    drop_frames = 20
    stagger = 26
    total = 144  # 6.00s at 24fps
    for i in range(total):
        frame = Image.new("RGBA", (W, H), PHOTO_BG)
        for idx, (pol, rest) in enumerate(zip(polaroids, rests)):
            start = idx * stagger
            if i < start:
                continue
            t = ease_out((i - start) / drop_frames) if i < start + drop_frames else 1.0
            y = rest["y"] - int((1 - t) * 520)
            rot = rest["rot"] * t
            bounced = pol.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
            paste_center(frame, bounced, (rest["x"], y))
        frame.convert("RGB").save(DROP / f"f{i:04d}.png")
    print("photo frames", total)


def main():
    GFX.mkdir(exist_ok=True)
    draw_title(end=False).save(GFX / "s3-title.png")
    draw_title(end=True).save(GFX / "s7-end.png")
    draw_choice("stay").save(GFX / "s6-stay.png")
    draw_choice("both").save(GFX / "s6-both.png")
    draw_choice("know").save(GFX / "s6-know.png")
    draw_timeline().save(GFX / "s7-timeline-6.png")
    shift_prompts()
    print("gfx written")


if __name__ == "__main__":
    main()
