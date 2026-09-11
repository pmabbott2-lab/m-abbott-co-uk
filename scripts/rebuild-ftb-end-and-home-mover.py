#!/usr/bin/env python3
"""Rebuild FTB end (stairs freeze + timed points) and home-mover picture lock.

FTB: keep v4 audio/dialogue; replace PowerPoint summary with stairs hold + overlays.
Home-mover: longer garden on garden VO; laptop→adviser as one home conversation;
            estate only earlier (during review), never after adviser.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/Users/petermabbott/Projects/m-abbott-co-uk-main")
ASSETS = Path(
    "/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
)
SITE = ROOT / "marketing/mortgage-hub-website/assets/video"
HOLD = ROOT / "marketing/mortgageeasy-film-hold"
FFMPEG = str(ROOT / "node_modules/@ffmpeg-installer/darwin-x64/ffmpeg")
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
BADGE = HOLD / "protect-gfx" / "badge-protect.png"
OPEN_LOGO = HOLD / "protect-gfx" / "open-logo.png"
SMALLPRINT = HOLD / "smallprint-on-dark.png"
END_CARD = ASSETS / "home-mover-gfx" / "end.png"


def run(cmd: list[str]) -> None:
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path: Path) -> float:
    proc = subprocess.run(
        [FFMPEG, "-i", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="ignore",
    )
    blob = (proc.stdout or "") + (proc.stderr or "")
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", blob)
    if not m:
        raise RuntimeError(f"no duration for {path}")
    h, mi, s = m.groups()
    return float(h) * 3600 + float(mi) * 60 + float(s)


def brand_clip(
    src: Path,
    dst: Path,
    dur: float,
    start: float = 0.0,
    rate: float = 1.0,
    min_rate: float = 0.55,
    allow_freeze_tail: bool = False,
) -> None:
    """Brand a live clip to exact duration (slow/loop via setpts if needed)."""
    # If we need longer than source, slow playback (rate < 1) or freeze-tail.
    src_dur = max(0.2, duration(src) - start)
    need = max(0.2, dur)
    use_rate = rate
    if src_dur / max(use_rate, 0.01) < need - 0.05:
        if allow_freeze_tail or min_rate >= 0.999:
            # Prefer freeze-tail over slow-mo (avoids garden double-football loop)
            use_rate = max(min_rate, 1.0)
            run(
                [
                    FFMPEG,
                    "-y",
                    "-ss",
                    f"{start:.3f}",
                    "-i",
                    str(src),
                    "-loop",
                    "1",
                    "-i",
                    str(BADGE),
                    "-filter_complex",
                    f"[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,"
                    f"setsar=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={max(0.05, need - src_dur):.3f}[v];"
                    f"[1:v]format=rgba[mark];[v][mark]overlay=20:16",
                    "-t",
                    f"{need:.3f}",
                    "-an",
                    "-r",
                    "24",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-pix_fmt",
                    "yuv420p",
                    "-g",
                    "24",
                    "-bf",
                    "0",
                    str(dst),
                ]
            )
            return
        use_rate = max(min_rate, src_dur / need)
    run(
        [
            FFMPEG,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(src),
            "-loop",
            "1",
            "-i",
            str(BADGE),
            "-filter_complex",
            f"[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,"
            f"setsar=1,setpts=(PTS-STARTPTS)/{use_rate:.4f}[v];"
            f"[1:v]format=rgba[mark];[v][mark]overlay=20:16",
            "-t",
            f"{need:.3f}",
            "-an",
            "-r",
            "24",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            "-g",
            "24",
            "-bf",
            "0",
            str(dst),
        ]
    )


def still_image(src: Path, dst: Path, dur: float, brand: bool = False) -> None:
    if brand:
        run(
            [
                FFMPEG,
                "-y",
                "-loop",
                "1",
                "-i",
                str(src),
                "-loop",
                "1",
                "-i",
                str(BADGE),
                "-filter_complex",
                "[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,"
                "setsar=1,setpts=PTS-STARTPTS[v];[1:v]format=rgba[mark];[v][mark]overlay=20:16",
                "-t",
                f"{dur:.3f}",
                "-an",
                "-r",
                "24",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-pix_fmt",
                "yuv420p",
                str(dst),
            ]
        )
    else:
        run(
            [
                FFMPEG,
                "-y",
                "-loop",
                "1",
                "-i",
                str(src),
                "-vf",
                "fps=24,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1",
                "-t",
                f"{dur:.3f}",
                "-an",
                "-r",
                "24",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-pix_fmt",
                "yuv420p",
                str(dst),
            ]
        )


def concat(files: list[Path], dst: Path) -> None:
    lst = dst.with_suffix(".txt")
    lst.write_text("".join(f"file '{p}'\n" for p in files))
    run(
        [
            FFMPEG,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(lst),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "24",
            str(dst),
        ]
    )


def dissolve(a: Path, b: Path, overlap: float, dst: Path, work: Path) -> None:
    da = duration(a)
    head = max(0.2, da - overlap)
    mid = work / "diss-mid.mp4"
    run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(a),
            "-i",
            str(b),
            "-filter_complex",
            f"[0:v]fps=24,scale=1280:720,setsar=1,trim=start={head:.3f},setpts=PTS-STARTPTS,format=rgba[a];"
            f"[1:v]fps=24,scale=1280:720,setsar=1,trim=end={overlap:.3f},setpts=PTS-STARTPTS,"
            f"format=yuva420p,fade=t=in:st=0:d={overlap:.3f}:alpha=1[b];"
            f"[a][b]overlay,format=yuv420p",
            "-t",
            f"{overlap:.3f}",
            "-an",
            "-r",
            "24",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            str(mid),
        ]
    )
    a_head = work / "diss-a.mp4"
    b_tail = work / "diss-b.mp4"
    run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(a),
            "-t",
            f"{head:.3f}",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            str(a_head),
        ]
    )
    run(
        [
            FFMPEG,
            "-y",
            "-ss",
            f"{overlap:.3f}",
            "-i",
            str(b),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            str(b_tail),
        ]
    )
    concat([a_head, mid, b_tail], dst)


def mux(video: Path, audio: Path, out: Path, smallprint_at: float | None = None) -> None:
    work = out.parent
    tmp = work / (out.stem + "-nosm.mp4")
    run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(video),
            "-i",
            str(audio),
            "-filter_complex",
            "[0:v]fps=24,scale=1280:720,setsar=1,setpts=N/24/TB[v];"
            "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=N/SR/TB[a]",
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-level",
            "3.1",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-x264opts",
            "keyint=24:min-keyint=24:scenecut=0:bframes=0:ref=1",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(tmp),
        ]
    )
    if smallprint_at is None:
        tmp.replace(out)
        return
    run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(tmp),
            "-loop",
            "1",
            "-i",
            str(SMALLPRINT),
            "-filter_complex",
            f"[0:v][1:v]overlay=0:0:enable='gte(t,{smallprint_at:.3f})'[v]",
            "-map",
            "[v]",
            "-map",
            "0:a",
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-level",
            "3.1",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-x264opts",
            "keyint=24:min-keyint=24:scenecut=0:bframes=0:ref=1",
            "-c:a",
            "copy",
            "-shortest",
            "-movflags",
            "+faststart",
            str(out),
        ]
    )


def font(size: int, index: int = 1):
    return ImageFont.truetype(FONT, size, index=index)


def render_point_overlay(base: Image.Image, title: str, points: list[str], active: int) -> Image.Image:
    """active = number of points visible (0 = title only)."""
    img = base.copy().convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    # Soft panel on the right so faces stay clear on left/stairs
    panel = (720, 120, 1240, 620)
    d.rounded_rectangle(panel, radius=22, fill=(13, 27, 42, 168))
    d.text((748, 150), title, font=font(30), fill=(255, 255, 255, 255))
    y = 210
    for i, text in enumerate(points):
        if i >= active:
            break
        d.ellipse((748, y + 4, 780, y + 36), fill=(34, 197, 94, 255))
        d.text((756, y + 6), str(i + 1), font=font(18), fill=(255, 255, 255, 255))
        # wrap long lines
        words = text.split()
        lines, cur = [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if d.textlength(trial, font=font(22)) <= 420:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        for j, line in enumerate(lines):
            d.text((798, y + j * 28), line, font=font(22), fill=(232, 245, 238, 255))
        y += max(44, 28 * len(lines) + 16)
    out = Image.alpha_composite(img, overlay).convert("RGB")
    return out


def rebuild_ftb() -> None:
    """FTB v9 — VO-locked runway rebuild + stairs summary end.
    Last live beat is the featured family (two children), not open-door adviser.
    """
    print("=== FTB v9 VO-locked rebuild ===")
    work = Path("/tmp/ftb-v9-cut")
    if work.exists():
        for p in work.glob("*"):
            if p.is_file():
                p.unlink()
    work.mkdir(parents=True, exist_ok=True)

    vo = ASSETS / "ftb-vo-full-sonia-compliant.mp3"
    words_path = ASSETS / "ftb-compliant-vo-words.json"
    words = json.loads(words_path.read_text()) if words_path.exists() else []
    OPEN = 3.20
    END_FADE = 0.80
    LOGO_HOLD = 4.00

    def find_start(phrase: str, after: float = 0.0) -> float:
        toks = [t for t in re.findall(r"[a-z0-9']+", phrase.lower())]
        texts: list[str] = []
        starts: list[float] = []
        for w in words:
            raw = w.get("word", "").lower().replace("mortgageeasy", "mortgage easy")
            for p in re.findall(r"[a-z0-9']+", raw):
                if p in {"adviser", "advisor"}:
                    p = "adviser"
                if p in {"convensor", "conveyensor"}:
                    p = "conveyancer"
                texts.append(p)
                starts.append(float(w["start"]))
        n = len(toks)
        for i in range(len(texts) - n + 1):
            if texts[i : i + n] == toks and starts[i] >= after:
                return starts[i]
        if n >= 4:
            for skip in range(n):
                reduced = toks[:skip] + toks[skip + 1 :]
                m = len(reduced)
                for i in range(len(texts) - m + 1):
                    if texts[i : i + m] == reduced and starts[i] >= after:
                        return starts[i]
        return -1.0

    def abs_t(phrase: str, after: float = 0.0, fallback: float = 0.0) -> float:
        found = find_start(phrase, after=after) if words else -1.0
        return OPEN + (found if found >= 0 else fallback)

    vo_dur = duration(vo)
    speech_end = OPEN + (float(words[-1]["end"]) if words else vo_dur)

    t_portal = abs_t("customer portal", after=15.0, fallback=22.0)
    t_choose = abs_t("When choosing a mortgage", after=25.0, fallback=36.0)
    t_aip = abs_t("Agreement in Principle", after=35.0, fallback=45.0)
    t_aip_pic = max(t_choose + 1.5, t_aip - 1.10)
    t_app = abs_t("From your initial application", after=45.0, fallback=56.0)
    if t_app < t_aip + 2:
        t_app = abs_t("conveyancer", after=45.0, fallback=56.8)
    if t_app < t_aip + 2:
        t_app = abs_t("estate agent", after=45.0, fallback=57.5)
    t_door = abs_t("open the door", after=55.0, fallback=63.5)
    t_journey = abs_t("Your journey", after=60.0, fallback=68.0)
    t_borrow = abs_t("Understand what you may be able to borrow", after=65.0, fallback=71.0)
    t_explore = abs_t("Explore mortgage options", after=68.0, fallback=74.0)
    t_aip_end = abs_t("Get your Agreement in Principle", after=70.0, fallback=77.0)
    t_offer = abs_t("Make your offer", after=72.0, fallback=80.0)
    t_move = abs_t("Move in", after=75.0, fallback=82.0)
    summary_end = max(speech_end + 0.25, t_move + 2.0)

    d_life = max(4.0, t_portal - OPEN)
    d_portal = max(3.0, t_choose - t_portal)
    d_choose = max(3.0, t_aip_pic - t_choose)
    d_aip = max(3.0, t_app - t_aip_pic)
    d_app = max(3.0, t_door - t_app)
    d_door = max(2.5, t_journey - t_door)

    print(
        f"anchors portal={t_portal:.2f} choose={t_choose:.2f} aip={t_aip:.2f} "
        f"aip_pic={t_aip_pic:.2f} app={t_app:.2f} door={t_door:.2f} journey={t_journey:.2f}"
    )
    print(
        f"durs life={d_life:.2f} portal={d_portal:.2f} choose={d_choose:.2f} "
        f"aip={d_aip:.2f} app={d_app:.2f} door={d_door:.2f}"
    )

    still_image(OPEN_LOGO, work / "00-open.mp4", OPEN, brand=False)

    houses = ASSETS / "mortgageeasy-seq-01-properties.mp4"
    if not houses.exists():
        houses = ASSETS / "mortgageeasy-runway-scene-01-properties.mp4"
    brand_clip(houses, work / "01-houses.mp4", d_life, min_rate=1.0)
    dissolve(work / "00-open.mp4", work / "01-houses.mp4", 0.55, work / "d-life.mp4", work)

    portal = ASSETS / "mortgageeasy-runway-side-login.mp4"
    if not portal.exists():
        portal = ASSETS / "mortgageeasy-seq-02-login.mp4"
    brand_clip(portal, work / "02-portal.mp4", d_portal, min_rate=1.0)

    choose = ASSETS / "mortgageeasy-seq-05-advisor.mp4"
    if not choose.exists():
        choose = ASSETS / "mortgageeasy-runway-scene-03-advice.mp4"
    brand_clip(choose, work / "03-choose.mp4", d_choose, min_rate=1.0)

    aip = ASSETS / "mortgageeasy-runway-aip-over-shoulder.mp4"
    if not aip.exists():
        aip = ASSETS / "mortgageeasy-seq-06-aip.mp4"
    brand_clip(aip, work / "04-aip.mp4", d_aip, min_rate=1.0, allow_freeze_tail=True)

    app = ASSETS / "mortgageeasy-runway-matching-adviser-call.mp4"
    brand_clip(app, work / "05-app.mp4", d_app, min_rate=1.0, allow_freeze_tail=True)

    family = ASSETS / "mortgageeasy-runway-family-two-children.mp4"
    if not family.exists():
        family = HOLD / "ftb-gfx" / "family-two-children-runway.mp4"
    brand_clip(family, work / "06-family.mp4", d_door, min_rate=1.0, allow_freeze_tail=True)

    body = work / "body.mp4"
    concat(
        [
            work / "d-life.mp4",
            work / "02-portal.mp4",
            work / "03-choose.mp4",
            work / "04-aip.mp4",
            work / "05-app.mp4",
            work / "06-family.mp4",
        ],
        body,
    )

    freeze_frame = work / "stairs.png"
    run(
        [
            FFMPEG,
            "-y",
            "-sseof",
            "-0.20",
            "-i",
            str(work / "06-family.mp4"),
            "-frames:v",
            "1",
            str(freeze_frame),
        ]
    )
    if not freeze_frame.exists() or freeze_frame.stat().st_size < 1000:
        run(
            [
                FFMPEG,
                "-y",
                "-ss",
                f"{max(0.0, duration(body) - 0.2):.3f}",
                "-i",
                str(body),
                "-frames:v",
                "1",
                str(freeze_frame),
            ]
        )
    base = Image.open(freeze_frame).convert("RGB").resize((1280, 720))
    title = "Your journey, made clearer"
    points = [
        "Understand what you may be able to borrow",
        "Explore mortgage options with an adviser",
        "Get your Agreement in Principle",
        "Make your offer when you are ready",
        "Move in — and talk about protecting what matters",
    ]
    cut = duration(body)
    abs_cues = [
        (t_journey, 0),
        (t_borrow, 1),
        (t_explore, 2),
        (t_aip_end, 3),
        (t_offer, 4),
        (t_move, 5),
    ]
    timeline = [(cut, 0)]
    for t, a in abs_cues:
        if t >= cut - 0.05:
            timeline.append((max(t, cut + 0.05), a))
    timeline.append((summary_end, 5))

    segs = []
    for i in range(len(timeline) - 1):
        t0, active = timeline[i]
        t1 = timeline[i + 1]
        dur = max(0.12, t1[0] - t0)
        frame = render_point_overlay(base, title, points, active)
        png = work / f"sum-{i}-a{active}.png"
        frame.save(png)
        mp4 = work / f"sum-{i}.mp4"
        still_image(png, mp4, dur, brand=False)
        segs.append(mp4)
        print(f"  summary seg {i}: {dur:.2f}s active={active}")

    still_image(OPEN_LOGO, work / "logo.mp4", LOGO_HOLD + END_FADE, brand=False)
    segs.append(work / "logo.mp4")

    picture = work / "picture.mp4"
    concat([body] + segs, picture)

    voice = work / "voice.mp3"
    end_hold = LOGO_HOLD + 0.4
    run(
        [
            FFMPEG,
            "-y",
            "-f",
            "lavfi",
            "-t",
            f"{OPEN:.2f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-i",
            str(vo),
            "-f",
            "lavfi",
            "-t",
            f"{end_hold:.2f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
            "-map",
            "[a]",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(voice),
        ]
    )

    pic_dur = duration(picture)
    aud_dur = duration(voice)
    delta = aud_dur - pic_dur
    if abs(delta) > 0.12:
        print(f"adjust logo hold ({pic_dur:.2f} -> {aud_dur:.2f}, delta={delta:+.2f})")
        still_image(OPEN_LOGO, work / "logo.mp4", max(2.8, LOGO_HOLD + END_FADE + delta), brand=False)
        concat([body] + segs[:-1] + [work / "logo.mp4"], picture)

    out = SITE / "first-time-buyer-draft-v9.mp4"
    mux(picture, voice, out, smallprint_at=summary_end)
    (ASSETS / "mortgageeasy-first-time-buyer-draft-v9.mp4").write_bytes(out.read_bytes())

    # Always land captions beside the site mp4 (generator may have written them earlier)
    vtt_src = SITE / "first-time-buyer-draft-v8.vtt"
    vtt_out = SITE / "first-time-buyer-draft-v9.vtt"
    if vtt_src.exists():
        vtt_out.write_text(vtt_src.read_text())
    vtt_src = vtt_out
    if vtt_src.exists():
        text = vtt_src.read_text()
        blocks = text.replace("\r", "").strip().split("\n\n")
        cues = []
        for block in blocks[1:]:
            lines = [l for l in block.split("\n") if l.strip()]
            if not lines or "-->" not in lines[0]:
                continue
            a, b = [x.strip() for x in lines[0].split("-->")]
            cues.append([a, b, "\n".join(lines[1:])])

        def sec(t: str) -> float:
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)

        def stamp(seconds: float) -> str:
            h = int(seconds // 3600)
            m = int((seconds % 3600) // 60)
            s = seconds - h * 3600 - m * 60
            return f"{h:02d}:{m:02d}:{s:06.3f}"

        for i in range(len(cues) - 1):
            nxt = sec(cues[i + 1][0]) - 0.06
            if nxt > sec(cues[i][0]) + 0.5:
                cues[i][1] = stamp(nxt)
        if cues:
            cues[-1][1] = stamp(max(sec(cues[-1][1]), speech_end + 0.2))
        body_txt = ["WEBVTT", ""]
        for a, b, line in cues:
            body_txt.append(f"{a} --> {b}")
            body_txt.append(line)
            body_txt.append("")
        vtt_src.write_text("\n".join(body_txt))
    print(f"wrote {out} ({duration(out):.2f}s)")


def rebuild_home_mover() -> None:
    print("=== Home-mover picture recut ===")
    work = Path("/tmp/home-mover-v3-cut")
    work.mkdir(parents=True, exist_ok=True)

    vo = ASSETS / "home-mover-vo-full-sonia-compliant.mp3"
    # Prefer compliant VO; fall back
    if not vo.exists():
        vo = ASSETS / "home-mover-vo-full-sonia.mp3"
    words_path = ASSETS / "home-compliant-vo-words.json"
    words = json.loads(words_path.read_text()) if words_path.exists() else []

    def find_start(phrase: str, after: float = 0.0) -> float:
        def norm(t: str) -> str:
            t = re.sub(r"[^a-z0-9']", "", t.lower())
            if t in {"adviser", "advisor"}:
                return "adviser"
            return t

        toks = [norm(t) for t in re.findall(r"[a-z0-9']+", phrase.lower())]
        texts = []
        starts = []
        for w in words:
            parts = re.findall(r"[a-z0-9']+", w.get("word", "").lower())
            for p in parts:
                texts.append(norm(p))
                starts.append(float(w["start"]))
        n = len(toks)
        for i in range(len(texts) - n + 1):
            if texts[i : i + n] == toks and starts[i] >= after:
                return starts[i]
        return -1.0

    OPEN = 3.20
    END_HOLD = 3.50
    vo_dur = duration(vo)
    # Absolute picture anchors from VO (+ open silence)
    def abs_t(phrase: str, after: float = 0.0, fallback: float = 0.0) -> float:
        found = find_start(phrase, after=after) if words else -1.0
        vo_t = found if found >= 0 else fallback
        return OPEN + vo_t

    t_garden = abs_t("Maybe you want", fallback=15.5)
    t_review = abs_t("Moving home is also", after=15.0, fallback=24.8)
    # Adviser on screen when adviser VO starts
    t_call = abs_t("An adviser can help", after=25.0, fallback=36.0)
    if t_call < t_review + 2:
        t_call = abs_t("You can have that conversation", after=25.0, fallback=39.0)
    # Final house shot when close VO starts
    t_close = abs_t("Your first home was about", after=40.0, fallback=52.0)
    # LIFE MOVES ON end slide: bring in 3s earlier than end-of-VO (was arriving after full close)
    t_endcard = max(t_close + 3.5, (OPEN + vo_dur) - 3.0)

    # Garden source has double-football artifact from ~6.8s — never play past safe head,
    # and never freeze: cut to estate early instead.
    garden_clip = ASSETS / "protect-runway-garden.mp4"
    GARDEN_SAFE = 6.50
    LAPTOP_LEAD = 2.20  # brief laptop before adviser line

    d_open = OPEN
    d_home = max(2.0, t_garden - OPEN)
    d_garden = min(GARDEN_SAFE, max(4.0, t_review - t_garden))
    # Estate covers from end of garden through just before laptop lead
    estate_end = max(t_garden + d_garden + 1.0, t_call - LAPTOP_LEAD)
    d_estate = max(2.5, estate_end - (t_garden + d_garden))
    d_laptop = LAPTOP_LEAD
    d_adviser = max(4.0, t_close - t_call)
    d_close = max(3.5, t_endcard - t_close)
    d_endcard = max(2.4, (OPEN + vo_dur) - t_endcard + 0.5)
    d_logo = END_HOLD + 0.8

    print(
        f"anchors garden={t_garden:.2f} review={t_review:.2f} "
        f"call={t_call:.2f} close={t_close:.2f} endcard={t_endcard:.2f}"
    )
    print(
        f"durs home={d_home:.2f} garden={d_garden:.2f} (no freeze, safe≤{GARDEN_SAFE:.2f}) "
        f"estate={d_estate:.2f} laptop={d_laptop:.2f} adviser={d_adviser:.2f} "
        f"close={d_close:.2f} endcard={d_endcard:.2f}"
    )

    still_image(OPEN_LOGO, work / "00-open.mp4", d_open, brand=False)

    s1 = ASSETS / "mortgageeasy-home-mover-runway-s1-v2.mp4"
    kitchen = ASSETS / "mortgageeasy-remortgage-runway-s2-kitchen-serve.mp4"
    garden = garden_clip
    estate = ASSETS / "mortgageeasy-home-mover-runway-s5-estate.mp4"
    laptop = ASSETS / "mortgageeasy-home-mover-runway-s4-v2.mp4"
    if not laptop.exists():
        laptop = ASSETS / "mortgageeasy-home-mover-runway-s4-laptop.mp4"
    call = ASSETS / "mortgageeasy-runway-matching-adviser-call.mp4"
    house = ASSETS / "mortgageeasy-home-mover-runway-s3-v2.mp4"

    # HOME: open live + kitchen (no garden yet)
    home_a = max(3.0, d_home * 0.55)
    home_b = max(1.5, d_home - home_a)
    brand_clip(s1, work / "01a.mp4", home_a)
    brand_clip(kitchen, work / "01b.mp4", home_b)
    dissolve(work / "00-open.mp4", work / "01a.mp4", 0.55, work / "d1.mp4", work)
    concat([work / "d1.mp4", work / "01b.mp4"], work / "home.mp4")

    # GARDEN: clean single-ball head only — no freeze
    brand_clip(garden, work / "02-garden.mp4", d_garden, min_rate=1.0)

    # ESTATE until laptop lead
    brand_clip(estate, work / "04-estate.mp4", d_estate)

    # Laptop lead-in, then adviser locked to adviser VO, then house on close VO
    brand_clip(laptop, work / "05a-laptop.mp4", d_laptop)
    brand_clip(call, work / "05b-adviser.mp4", d_adviser)
    brand_clip(house, work / "06-close.mp4", d_close, start=2.80, rate=0.75)

    still_image(END_CARD, work / "07-endcard.mp4", d_endcard, brand=False)
    still_image(OPEN_LOGO, work / "08-logo.mp4", d_logo, brand=False)
    dissolve(work / "07-endcard.mp4", work / "08-logo.mp4", 0.70, work / "07-end.mp4", work)

    picture = work / "picture.mp4"
    concat(
        [
            work / "home.mp4",
            work / "02-garden.mp4",
            work / "04-estate.mp4",
            work / "05a-laptop.mp4",
            work / "05b-adviser.mp4",
            work / "06-close.mp4",
            work / "07-end.mp4",
        ],
        picture,
    )

    # Build voice with open + end silence
    voice = work / "voice.mp3"
    run(
        [
            FFMPEG,
            "-y",
            "-f",
            "lavfi",
            "-t",
            f"{OPEN:.2f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-i",
            str(vo),
            "-f",
            "lavfi",
            "-t",
            f"{END_HOLD:.2f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
            "-map",
            "[a]",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(voice),
        ]
    )

    # Keep VO locks: pad/trim end card+logo instead of stretching the whole cut
    pic_dur = duration(picture)
    aud_dur = duration(voice)
    delta = aud_dur - pic_dur
    if abs(delta) > 0.12:
        print(f"adjust end hold to match audio ({pic_dur:.2f} -> {aud_dur:.2f}, delta={delta:+.2f})")
        end_dur = duration(work / "07-end.mp4")
        new_end = max(2.0, end_dur + delta)
        still_image(END_CARD, work / "07-endcard.mp4", min(2.6, new_end * 0.45), brand=False)
        still_image(OPEN_LOGO, work / "08-logo.mp4", max(2.0, new_end - min(2.6, new_end * 0.45)), brand=False)
        dissolve(work / "07-endcard.mp4", work / "08-logo.mp4", 0.70, work / "07-end.mp4", work)
        concat(
            [
                work / "home.mp4",
                work / "02-garden.mp4",
                work / "04-estate.mp4",
                work / "05a-laptop.mp4",
                work / "05b-adviser.mp4",
                work / "06-close.mp4",
                work / "07-end.mp4",
            ],
            picture,
        )
        # final tiny trim if still long
        pic_dur = duration(picture)
        if pic_dur > aud_dur + 0.08:
            trimmed = work / "picture-trim.mp4"
            run(
                [
                    FFMPEG,
                    "-y",
                    "-i",
                    str(picture),
                    "-t",
                    f"{aud_dur:.3f}",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-pix_fmt",
                    "yuv420p",
                    str(trimmed),
                ]
            )
            picture = trimmed

    out = SITE / "home-mover-v8.mp4"
    sp_at = OPEN + vo_dur
    mux(picture, voice, out, smallprint_at=sp_at)
    (ASSETS / "mortgageeasy-home-mover-v8.mp4").write_bytes(out.read_bytes())

    # Captions from generator; nudge last cue earlier vs speech and hold longer
    vtt_src = SITE / "home-mover-v8.vtt"
    if vtt_src.exists() and words:
        text = vtt_src.read_text()
        life_vo = find_start("And when life moves on", after=40.0)
        if life_vo >= 0:
            life_abs = OPEN + life_vo
            start = max(0.0, life_abs - 0.45)
            end = max(start + 3.5, OPEN + vo_dur + 0.4)

            def stamp(seconds: float) -> str:
                h = int(seconds // 3600)
                m = int((seconds % 3600) // 60)
                s = seconds - h * 3600 - m * 60
                return f"{h:02d}:{m:02d}:{s:06.3f}"

            # previous cue should end just before
            text = re.sub(
                r"(\d{2}:\d{2}:\d{2}\.\d{3}) --> \d{2}:\d{2}:\d{2}\.\d{3}\nYour next home is about moving forward\.",
                lambda m: f"{m.group(1)} --> {stamp(max(0.0, start - 0.08))}\nYour next home is about moving forward.",
                text,
                count=1,
            )
            text = re.sub(
                r"\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\nAnd when life moves on[^\n]*",
                f"{stamp(start)} --> {stamp(end)}\nAnd when life moves on, it can help to review your mortgage as you go.",
                text,
                count=1,
            )
            vtt_src.write_text(text)
            print(f"last caption locked to VO: {stamp(start)} -> {stamp(end)} (speech~{stamp(life_abs)})")
    print(f"wrote {out} ({duration(out):.2f}s)")


def rebuild_protect() -> None:
    """Protect v9 — warm VO-locked rebuild from runway clips + title slides.

    Sequence: open → life (warm) → change → house (birthday on line) /
    family/self titles → Mortgage Easy support → laptop then in-person adviser →
    end card held through last VO → fade to Mortgage Easy logo hold.
    """
    print("=== Protect v9 warm rebuild (VO-locked) ===")
    work = Path("/tmp/protect-v9-cut")
    if work.exists():
        for p in work.glob("*"):
            if p.is_file():
                p.unlink()
    work.mkdir(parents=True, exist_ok=True)

    vo = ASSETS / "protect-vo-full-sonia-compliant.mp3"
    words_path = ASSETS / "protect-compliant-vo-words.json"
    words = json.loads(words_path.read_text()) if words_path.exists() else []
    gfx = HOLD / "protect-gfx"
    open_logo = gfx / "open-logo.png"
    end_card = gfx / "end.png"

    def norm_tok(t: str) -> str:
        t = t.lower().replace("mortgageeasy", "mortgage easy")
        if t in {"adviser", "advisor"}:
            return "adviser"
        return t

    def find_start(phrase: str, after: float = 0.0) -> float:
        toks = [norm_tok(t) for t in re.findall(r"[a-z0-9']+", phrase.lower())]
        flat: list[str] = []
        for t in toks:
            flat.extend(t.split())
        toks = flat
        texts: list[str] = []
        starts: list[float] = []
        for w in words:
            parts = [norm_tok(p) for p in re.findall(r"[a-z0-9']+", w.get("word", "").lower())]
            for p in parts:
                for piece in p.split():
                    texts.append(piece)
                    starts.append(float(w["start"]))
        n = len(toks)
        for i in range(len(texts) - n + 1):
            if texts[i : i + n] == toks and starts[i] >= after:
                return starts[i]
        if n >= 4:
            for skip in range(n):
                reduced = toks[:skip] + toks[skip + 1 :]
                m = len(reduced)
                for i in range(len(texts) - m + 1):
                    if texts[i : i + m] == reduced and starts[i] >= after:
                        return starts[i]
        return -1.0

    OPEN = 3.20
    END_HOLD = 4.20  # Mortgage Easy logo hold after VO
    LOGO_HOLD = 4.00
    END_FADE = 0.90
    TITLE = 1.70  # short titles → more warm live picture
    vo_dur = duration(vo)
    speech_end = OPEN + vo_dur
    if words:
        try:
            speech_end = OPEN + float(words[-1]["end"])
        except (KeyError, TypeError, ValueError):
            pass

    def abs_t(phrase: str, after: float = 0.0, fallback: float = 0.0) -> float:
        found = find_start(phrase, after=after) if words else -1.0
        return OPEN + (found if found >= 0 else fallback)

    t_change = abs_t("But sometimes, life changes", fallback=16.6)
    t_house = abs_t("Because your house", after=25.0, fallback=38.0)
    t_birthday = abs_t("Where birthdays are celebrated", after=35.0, fallback=46.0)
    t_house_slide = abs_t("Protect your house", after=40.0, fallback=50.0)
    t_family = abs_t("And then there's the people", after=45.0, fallback=53.0)
    if t_family < t_house_slide + 1:
        t_family = abs_t("And then there", after=45.0, fallback=53.0)
    t_family_slide = abs_t("Protect your family", after=55.0, fallback=68.0)
    t_self = abs_t("And sometimes, the person", after=60.0, fallback=71.0)
    t_self_slide = abs_t("Because others rely on you", after=70.0, fallback=82.0)
    t_me = abs_t("At Mortgage Easy", after=75.0, fallback=86.0)
    if t_me < t_self + 2:
        t_me = abs_t("We're here to support", after=75.0, fallback=90.0)
    # Adviser on screen from the spoken adviser line (not later "They can talk…")
    t_adviser = abs_t("An adviser can discuss this", after=85.0, fallback=98.0)
    if t_adviser < t_me + 2:
        t_adviser = abs_t("An adviser can discuss", after=85.0, fallback=98.0)
    if t_adviser < t_me + 2:
        t_adviser = abs_t("adviser can discuss", after=85.0, fallback=98.0)
    t_close = abs_t("You can't always protect", after=100.0, fallback=116.0)

    d_life = max(4.0, t_change - OPEN)
    d_change = max(4.0, t_house - t_change)
    # House: live → birthday on "birthdays" → title slide on "Protect your house"
    d_house_live = max(2.0, t_birthday - t_house)
    d_birthday = max(2.0, t_house_slide - t_birthday)
    d_house_slide = max(1.5, t_family - t_house_slide)
    # Family: live → title on "Protect your family"
    d_family_live = max(3.0, t_family_slide - t_family)
    d_family_slide = max(1.5, t_self - t_family_slide)
    # Self: live → title on "Because others rely on you" (matches slide tagline)
    if t_self_slide < t_self + 2:
        t_self_slide = abs_t("Not just to you", after=70.0, fallback=80.0)
    d_self_live = max(3.0, t_self_slide - t_self)
    d_self_slide = max(1.5, t_me - t_self_slide)
    d_me = max(8.0, t_adviser - t_me)
    d_adviser = max(5.0, t_close - t_adviser)
    # Hold end slide through last spoken word, then fade to Mortgage Easy
    d_endcard_visible = max(4.0, speech_end - t_close + 0.25)
    d_endcard = d_endcard_visible + END_FADE
    d_logo = LOGO_HOLD + END_FADE

    print(
        f"anchors change={t_change:.2f} house={t_house:.2f} birthday={t_birthday:.2f} "
        f"house_slide={t_house_slide:.2f} family={t_family:.2f} family_slide={t_family_slide:.2f} "
        f"self={t_self:.2f} self_slide={t_self_slide:.2f} me={t_me:.2f} adviser={t_adviser:.2f} "
        f"close={t_close:.2f} speech_end={speech_end:.2f}"
    )
    print(
        f"durs life={d_life:.2f} change={d_change:.2f} "
        f"house_live={d_house_live:.2f} birthday={d_birthday:.2f} house_slide={d_house_slide:.2f} "
        f"family_live={d_family_live:.2f} family_slide={d_family_slide:.2f} "
        f"self_live={d_self_live:.2f} self_slide={d_self_slide:.2f} "
        f"me={d_me:.2f} adviser={d_adviser:.2f} endcard={d_endcard:.2f} logo={d_logo:.2f}"
    )

    def pack_clips(clips: list[Path], total: float, prefix: str) -> list[Path]:
        """Split time across clips without slowing below natural rate."""
        n = len(clips)
        weights = []
        for c in clips:
            weights.append(min(duration(c) - 0.08, total))
        weight_sum = sum(weights) or 1.0
        parts = []
        allocated = 0.0
        for i, clip in enumerate(clips):
            if i == n - 1:
                need = max(0.8, total - allocated)
            else:
                need = max(0.8, total * (weights[i] / weight_sum))
                need = min(need, duration(clip) - 0.05)
            dst = work / f"{prefix}-{i}.mp4"
            brand_clip(clip, dst, need, min_rate=1.0)
            parts.append(dst)
            allocated += need
        # if short, extend last clip with freeze-tail via brand_clip allow
        if allocated < total - 0.2:
            extra = total - allocated
            last = clips[-1]
            dst = work / f"{prefix}-tail.mp4"
            brand_clip(last, dst, extra, start=max(0.0, duration(last) - 1.2), min_rate=1.0, allow_freeze_tail=True)
            parts.append(dst)
        return parts

    def titled_block(title_png: Path, clips: list[Path], total: float, name: str) -> Path:
        title_dur = min(TITLE, max(1.4, total * 0.12))
        rest = max(2.5, total - title_dur)
        still_image(title_png, work / f"{name}-title.mp4", title_dur, brand=False)
        parts = [work / f"{name}-title.mp4"] + pack_clips(clips, rest, name)
        out = work / f"{name}-block.mp4"
        concat(parts, out)
        return out

    still_image(open_logo, work / "00-open.mp4", OPEN, brand=False)

    # LIFE — warm ordinary moments (no garden / no football artifact)
    life_clips = [
        ASSETS / "protect-runway-breakfast.mp4",
        ASSETS / "protect-runway-holiday-5s.mp4",
        ASSETS / "protect-runway-hallway.mp4",
        ASSETS / "protect-runway-together.mp4",
    ]
    life_parts = pack_clips(life_clips, d_life, "life")
    dissolve(work / "00-open.mp4", life_parts[0], 0.65, work / "d-life.mp4", work)
    concat([work / "d-life.mp4"] + life_parts[1:], work / "01-life.mp4")

    # CHANGE — gentle, not rushed
    change_clips = [
        ASSETS / "protect-runway-letter.mp4",
        ASSETS / "protect-runway-waiting.mp4",
        ASSETS / "protect-runway-finances.mp4",
    ]
    concat(pack_clips(change_clips, d_change, "change"), work / "02-change.mp4")

    # HOUSE — live, then birthday on the birthday line, then written slide on Protect your house
    brand_clip(ASSETS / "protect-runway-house.mp4", work / "house-live.mp4", d_house_live, min_rate=1.0)
    brand_clip(ASSETS / "protect-runway-birthday.mp4", work / "house-birthday.mp4", d_birthday, min_rate=1.0)
    still_image(gfx / "title-house.png", work / "house-slide.mp4", d_house_slide, brand=False)
    concat(
        [work / "house-live.mp4", work / "house-birthday.mp4", work / "house-slide.mp4"],
        work / "03-house.mp4",
    )

    # FAMILY — people live, then written slide on Protect your family
    family_live_clips = [
        ASSETS / "protect-runway-homework.mp4",
        ASSETS / "protect-runway-together.mp4",
        ASSETS / "protect-runway-coat-take-a.mp4",
    ]
    concat(pack_clips(family_live_clips, d_family_live, "family-live"), work / "family-live.mp4")
    still_image(gfx / "title-family.png", work / "family-slide.mp4", d_family_slide, brand=False)
    concat([work / "family-live.mp4", work / "family-slide.mp4"], work / "04-family.mp4")

    # SELF — live first, then written slide on "Because others rely on you"
    concat(
        pack_clips(
            [ASSETS / "protect-runway-leaving.mp4", ASSETS / "protect-runway-finances.mp4"],
            d_self_live,
            "self-live",
        ),
        work / "self-live.mp4",
    )
    still_image(gfx / "title-self.png", work / "self-slide.mp4", d_self_slide, brand=False)
    concat([work / "self-live.mp4", work / "self-slide.mp4"], work / "05-self.mp4")

    # Mortgage Easy support — warm home hold until adviser line
    me_clips = [
        ASSETS / "protect-runway-together.mp4",
        ASSETS / "protect-runway-homework.mp4",
        ASSETS / "protect-runway-house.mp4",
    ]
    concat(pack_clips(me_clips, d_me, "me"), work / "06-me.mp4")

    # Same adviser continuity: laptop call → in-person adviser (no second face)
    laptop = ASSETS / "mortgageeasy-runway-matching-adviser-call.mp4"
    in_person = ASSETS / "mortgageeasy-runway-scene-03-advice.mp4"
    laptop_need = min(duration(laptop) - 0.05, max(4.0, min(9.5, d_adviser * 0.55)))
    person_need = max(3.0, d_adviser - laptop_need)
    brand_clip(laptop, work / "adv-laptop.mp4", laptop_need, min_rate=1.0)
    brand_clip(
        in_person,
        work / "adv-person.mp4",
        person_need,
        min_rate=1.0,
        allow_freeze_tail=True,
    )
    concat([work / "adv-laptop.mp4", work / "adv-person.mp4"], work / "06b-adviser.mp4")

    # End card held through last VO, then fade to Mortgage Easy logo hold
    still_image(end_card, work / "07-endcard.mp4", d_endcard, brand=False)
    still_image(open_logo, work / "08-logo.mp4", d_logo, brand=False)
    dissolve(work / "07-endcard.mp4", work / "08-logo.mp4", END_FADE, work / "07-end.mp4", work)

    picture = work / "picture.mp4"
    concat(
        [
            work / "01-life.mp4",
            work / "02-change.mp4",
            work / "03-house.mp4",
            work / "04-family.mp4",
            work / "05-self.mp4",
            work / "06-me.mp4",
            work / "06b-adviser.mp4",
            work / "07-end.mp4",
        ],
        picture,
    )

    voice = work / "voice.mp3"
    run(
        [
            FFMPEG,
            "-y",
            "-f",
            "lavfi",
            "-t",
            f"{OPEN:.2f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-i",
            str(vo),
            "-f",
            "lavfi",
            "-t",
            f"{END_HOLD:.2f}",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
            "-map",
            "[a]",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(voice),
        ]
    )

    # Match audio by adjusting Mortgage Easy logo hold only — keep end slide through VO
    pic_dur = duration(picture)
    aud_dur = duration(voice)
    delta = aud_dur - pic_dur
    if abs(delta) > 0.12:
        print(f"adjust logo hold ({pic_dur:.2f} -> {aud_dur:.2f}, delta={delta:+.2f})")
        new_logo = max(LOGO_HOLD + END_FADE, duration(work / "08-logo.mp4") + delta)
        still_image(end_card, work / "07-endcard.mp4", d_endcard, brand=False)
        still_image(open_logo, work / "08-logo.mp4", new_logo, brand=False)
        dissolve(work / "07-endcard.mp4", work / "08-logo.mp4", END_FADE, work / "07-end.mp4", work)
        concat(
            [
                work / "01-life.mp4",
                work / "02-change.mp4",
                work / "03-house.mp4",
                work / "04-family.mp4",
                work / "05-self.mp4",
                work / "06-me.mp4",
                work / "06b-adviser.mp4",
                work / "07-end.mp4",
            ],
            picture,
        )
        pic_dur = duration(picture)
        if pic_dur > aud_dur + 0.08:
            trimmed = work / "picture-trim.mp4"
            run(
                [
                    FFMPEG,
                    "-y",
                    "-i",
                    str(picture),
                    "-t",
                    f"{aud_dur:.3f}",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-pix_fmt",
                    "yuv420p",
                    str(trimmed),
                ]
            )
            picture = trimmed

    out = SITE / "protect-draft-v9.mp4"
    mux(picture, voice, out, smallprint_at=OPEN + vo_dur)
    (ASSETS / "mortgageeasy-protect-draft-v9.mp4").write_bytes(out.read_bytes())

    # Captions: reuse v8 VTT (same VO), soft-extend for readability
    vtt_src = SITE / "protect-draft-v8.vtt"
    vtt_out = SITE / "protect-draft-v9.vtt"
    if vtt_src.exists():
        text = vtt_src.read_text()
        blocks = text.replace("\r", "").strip().split("\n\n")
        cues = []
        for block in blocks[1:]:
            lines = [l for l in block.split("\n") if l.strip()]
            if not lines or "-->" not in lines[0]:
                continue
            a, b = [x.strip() for x in lines[0].split("-->")]
            cues.append([a, b, "\n".join(lines[1:])])

        def sec(t: str) -> float:
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)

        def stamp(seconds: float) -> str:
            h = int(seconds // 3600)
            m = int((seconds % 3600) // 60)
            s = seconds - h * 3600 - m * 60
            return f"{h:02d}:{m:02d}:{s:06.3f}"

        for i in range(len(cues) - 1):
            nxt = sec(cues[i + 1][0]) - 0.06
            if nxt > sec(cues[i][0]) + 0.5:
                cues[i][1] = stamp(nxt)
        cues[-1][1] = stamp(max(sec(cues[-1][1]), speech_end + 0.3))
        body = ["WEBVTT", ""]
        for a, b, line in cues:
            body.append(f"{a} --> {b}")
            body.append(line)
            body.append("")
        vtt_out.write_text("\n".join(body))
    print(f"wrote {out} ({duration(out):.2f}s)")


def main() -> None:
    import sys

    targets = sys.argv[1:] or ["ftb", "home"]
    if "ftb" in targets:
        rebuild_ftb()
    if "home" in targets:
        rebuild_home_mover()
    if "protect" in targets:
        rebuild_protect()


if __name__ == "__main__":
    main()
