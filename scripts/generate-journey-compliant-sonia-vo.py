#!/usr/bin/env python3
"""Safer journey-film VO (Azure Sonia) + VTT + remux to new site versions.

Does not change webpage legal placeholders. Does not claim FCA/HLP approval.
Locks prior site MP4s by writing new filenames (v3 / v2) per film-hold rules.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path("/Users/petermabbott/Projects/m-abbott-co-uk-main")
ENV = ROOT / ".env"
ASSETS = Path(
    "/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
)
SITE = ROOT / "marketing/mortgage-hub-website/assets/video"
HOLD = ROOT / "marketing/mortgageeasy-film-hold/previous-drafts"
FFMPEG = str(ROOT / "node_modules/@ffmpeg-installer/darwin-x64/ffmpeg")
VOICE = "en-GB-SoniaNeural"
OPEN = 3.20
END_HOLD = 3.50
ATEMPO = 1.05

# Safer dialogue — review-ready wording for HLP; not an approval claim.
FILMS = {
    "ftb": {
        "label": "first-time-buyer",
        "src_mp4": SITE / "first-time-buyer-draft-v5.mp4",
        "out_mp4": SITE / "first-time-buyer-draft-v8.mp4",
        "out_vtt": SITE / "first-time-buyer-draft-v8.vtt",
        "vo_full": ASSETS / "ftb-vo-full-sonia-compliant.mp3",
        "canonical": ASSETS / "mortgageeasy-first-time-buyer-draft-v8.mp4",
        "tempo": 1.10,
        "sections": [
            (
                1,
                "Buying your first home can feel like a big step.\n"
                "It often begins before you have even found the right property.\n"
                "We're here to help you with that journey.",
            ),
            (
                2,
                "An adviser can help you understand what you may be able to borrow, "
                "based on your individual circumstances and lender criteria.",
            ),
            (
                3,
                "You can start your journey in your own time using our customer portal, "
                "or book a conversation when you're ready.\n"
                "Our customer portal helps your adviser understand your situation earlier — "
                "so they can focus on what matters most.",
            ),
            (
                4,
                "When choosing a mortgage, your adviser will help you explore options "
                "that may suit your circumstances.\n"
                "They can also help you prepare for the next steps.",
            ),
            (
                5,
                "When the time is right, your adviser can provide an Agreement in Principle.\n"
                "Although this is not a mortgage offer.\n"
                "It can help you move forward with more clarity when you are ready to make an offer.\n"
                "From your initial application to completion, "
                "your adviser works with your conveyancer and estate agent.\n"
                "And when you finally open the door to your new home, it is your moment.",
            ),
            (
                6,
                "Your journey.\n"
                "Made clearer.\n"
                "Understand what you may be able to borrow.\n"
                "Explore mortgage options with an adviser.\n"
                "Get your Agreement in Principle.\n"
                "Make your offer when you are ready.\n"
                "Move in — and talk about protecting what matters.",
            ),
        ],
    },
    "home": {
        "label": "home-mover",
        "src_mp4": SITE / "home-mover-v1.mp4",
        "out_mp4": SITE / "home-mover-v8.mp4",
        "out_vtt": SITE / "home-mover-v8.vtt",
        "vo_full": ASSETS / "home-mover-vo-full-sonia-compliant.mp3",
        "canonical": ASSETS / "mortgageeasy-home-mover-v8.mp4",
        # Current live VO was already ~+10% vs raw TTS; another +5% => ~1.1576
        "tempo": 1.157625,
        "sections": [
            (
                1,
                "Your first home is a big moment.\n"
                "The place where you get started — where you build your life and make memories.\n"
                "But life doesn't stand still.\n"
                "And sometimes, the home that was perfect a few years ago isn't quite perfect anymore.",
            ),
            (
                2,
                "Maybe you want a little more space. A bigger garden. A better location.\n"
                "Or simply somewhere that feels like the next chapter.",
            ),
            (
                3,
                "Moving home is also a natural time to review what your next mortgage could look like.\n"
                "Because what suited a first purchase may not suit a later move.",
            ),
            (
                4,
                "An adviser can help you review the options.\n"
                "You can have that conversation from home, at a time that works for you.\n"
                "We'll look at it together and help you understand your options.",
            ),
            (
                5,
                "Because life is busy enough. Mortgage advice that fits around your life can help.\n"
                "Your first home was about getting started.\n"
                "Your next home is about moving forward.\n"
                "And when life moves on, it can help to review your mortgage as you go.",
            ),
        ],
    },
    "remortgage": {
        "label": "remortgage",
        "src_mp4": SITE / "remortgage-draft-v2.mp4",
        "out_mp4": SITE / "remortgage-draft-v4.mp4",
        "out_vtt": SITE / "remortgage-draft-v4.vtt",
        "vo_full": ASSETS / "remortgage-vo-full-sonia-compliant.mp3",
        "canonical": ASSETS / "mortgageeasy-remortgage-draft-v4.mp4",
        "sections": [
            (
                1,
                "Remember how much thought went into choosing your first mortgage?\n"
                "You looked at your options, talked it through, and found what felt right for you.\n"
                "But then life gets busy.\n"
                "And a few years later, your mortgage is coming up for renewal.",
            ),
            (
                2,
                "It can be tempting just to stay with the lender you know.\n"
                "Don't just renew. Review.\n"
                "At Mortgage Easy, we can help you review available mortgage options "
                "and discuss whether staying with your current lender or moving may be suitable, "
                "based on your circumstances.",
            ),
            (
                3,
                "Because a lot can change in a few years.\n"
                "We'll take the time to understand what's changed in your life, "
                "and check whether the advice you received last time still makes sense today.\n"
                "And sometimes, staying with your existing lender will still be the right choice.\n"
                "Sometimes it won't.\n"
                "The important thing is knowing.",
            ),
            (
                4,
                "From today, and in the years ahead, until you're mortgage-free.\n"
                "Mortgage Easy is here from your first home throughout your mortgage journey.\n"
                "Helping you review your options, make informed choices, "
                "and consider what may suit you next.\n"
                "Don't just renew. Review.",
            ),
        ],
    },
    "protect": {
        "label": "protect",
        "src_mp4": SITE / "protect-draft-v1.mp4",
        "out_mp4": SITE / "protect-draft-v8.mp4",
        "out_vtt": SITE / "protect-draft-v8.vtt",
        "vo_full": ASSETS / "protect-vo-full-sonia-compliant.mp3",
        "canonical": ASSETS / "mortgageeasy-protect-draft-v8.mp4",
        # Previous protect was at default ATEMPO 1.05; +5% more
        "tempo": 1.1025,
        # Keep early blocks unchanged when only compliance pacing is amended
        "reuse_sections": {1, 2, 3, 4, 5, 7},
        "sections": [
            (
                1,
                "Most of the time, life is exactly how we want it to be.\n"
                "Happy and full of plans.\n"
                "We plan for the things we hope will happen.\n"
                "A home. A family. A future.\n"
                "And that's how it should be.",
            ),
            (
                2,
                "But sometimes, life changes.\n"
                "An unexpected bill.\n"
                "A change in circumstances.\n"
                "An illness. An accident.\n"
                "Or when you can't work in the way you always have.\n"
                "You can't predict everything life will bring. "
                "But you can think about what would happen if it did.",
            ),
            (
                3,
                "Because your house isn't just a house.\n"
                "It's where your family feels safe.\n"
                "Where birthdays are celebrated. Where memories are made.\n"
                "Where life happens.\n"
                "Protect your house — because it's your home.",
            ),
            (
                4,
                "And then there's the people inside it.\n"
                "The people you work for. The people you make plans for.\n"
                "The people who make all of it worthwhile.\n"
                "Because when life changes, it's not just your future you're thinking about.\n"
                "Protect your family — because they're everything.",
            ),
            (
                5,
                "And sometimes, the person who needs protecting most is you.\n"
                "Because your income matters. Your ability to work matters. Your future matters.\n"
                "Not just to you.\n"
                "Because others rely on you.",
            ),
            (
                6,
                # Line-by-line compliance — calmer than film tempo, longer pauses
                "At Mortgage Easy, we're not just here to help you get into your home.\n"
                "We're here to support you as your life changes.\n"
                "Because a mortgage recommendation should reflect your circumstances today "
                "and what might change.\n"
                "An adviser can discuss this with you to make sure the advice you receive "
                "continues to make sense as your life changes.\n"
                "They can talk through your options and what may be suitable for you, "
                "based on your circumstances.",
                {"tempo": 1.05, "break_ms": 650},
            ),
            (
                7,
                "You can't always protect yourself from what life brings.\n"
                "But you can talk about the things that matter most.\n"
                "Your home. Your family. Yourself.\n"
                "Because protecting what matters isn't about expecting the worst.\n"
                "It's about being ready for whatever comes next.",
            ),
        ],
    },
}


def env_value(name: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


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


def azure_speech() -> tuple[str, str]:
    key = env_value("AZURE_SPEECH_KEY")
    region = (env_value("AZURE_SPEECH_REGION") or "uksouth").lower()
    if not key:
        raise SystemExit("missing AZURE_SPEECH_KEY")
    return key, region


def openai_key() -> str:
    key = env_value("OPENAI_API_KEY")
    if not key:
        raise SystemExit("missing OPENAI_API_KEY")
    return key


def ssml(text: str, break_ms: int = 350) -> bytes:
    def enrich(para: str) -> str:
        para = para.replace("Mortgage Easy", "MortgageEasy")
        # Brand as one spoken name
        para = re.sub(
            r"\bMortgageEasy\b",
            '§BRAND§',
            para,
        )
        # Clear UK pronunciations
        para = re.sub(
            r"\bAgreement in Principle\b",
            "§AIP§",
            para,
        )
        para = re.sub(r"\bconveyancer\b", "§CONV§", para, flags=re.I)

        parts: list[str] = []
        for token in re.split(r"(§BRAND§|§AIP§|§CONV§)", para):
            if token == "§BRAND§":
                parts.append(
                    '<phoneme alphabet="ipa" ph="mɔːɡɪdʒiːzi">MortgageEasy</phoneme>'
                )
            elif token == "§AIP§":
                parts.append(
                    'Agreement in <phoneme alphabet="ipa" ph="ˈprɪnsɪpəl">Principle</phoneme>'
                )
            elif token == "§CONV§":
                parts.append(
                    '<phoneme alphabet="ipa" ph="kənˈveɪənsə">conveyancer</phoneme>'
                )
            elif token:
                parts.append(escape(token))
        return "".join(parts)

    parts = []
    for para in text.strip().split("\n"):
        para = para.strip()
        if not para:
            continue
        parts.append(enrich(para))
        parts.append(f'<break time="{int(break_ms)}ms"/>')
    inner = "\n".join(parts)
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-GB'>"
        f"<voice name='{VOICE}'>"
        "<prosody rate='-5%'>"
        f"{inner}"
        "</prosody></voice></speak>"
    ).encode("utf-8")


def tts(text: str, break_ms: int = 350) -> bytes:
    key, region = azure_speech()
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml(text, break_ms=break_ms),
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
            "User-Agent": "MortgageEasyCompliantJourneySonia",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def atempo(src: Path, dst: Path, tempo: float = ATEMPO) -> None:
    subprocess.check_call(
        [
            FFMPEG,
            "-y",
            "-i",
            str(src),
            "-filter:a",
            f"atempo={tempo}",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(dst),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def whisper_words(path: Path) -> list[dict]:
    boundary = "----cursorform"
    file_bytes = path.read_bytes()
    parts = []

    def field(name, value):
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        )

    field("model", "whisper-1")
    field("language", "en")
    field("response_format", "verbose_json")
    field("timestamp_granularities[]", "word")
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
        "Content-Type: audio/mpeg\r\n\r\n".encode()
        + file_bytes
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=b"".join(parts),
        headers={
            "Authorization": f"Bearer {openai_key()}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        data = json.loads(res.read().decode())
    words = data.get("words") or []
    if not words:
        for seg in data.get("segments") or []:
            words.append({"word": seg.get("text", ""), "start": seg["start"], "end": seg["end"]})
    return words


ALIASES = {
    "adviser": "advisor",
    "advisers": "advisors",
    "we'll": "well",
    "whats": "what's",
    "you're": "youre",
    "wont": "won't",
    "dont": "don't",
    "isnt": "isn't",
    "conveyancer": "conveyancer",
    "convensor": "conveyancer",
    "conveyensor": "conveyancer",
}


def norm_token(tok: str) -> str:
    token = tok.lower().replace("—", " ").replace("–", " ").replace("'", "'").strip(".,!?\"' ")
    token = token.replace("'", "")
    return ALIASES.get(token, token)


def tokenize(text: str) -> list[str]:
    cleaned = text.replace("—", " ").replace("–", " ").replace("-", " ")
    out: list[str] = []
    for raw in cleaned.split():
        token = norm_token(raw)
        if not token:
            continue
        if token == "mortgageeasy":
            out.extend(["mortgage", "easy"])
        else:
            out.append(token)
    return out


def expand_whisper_words(words: list[dict]) -> list[dict]:
    """Split Whisper tokens like MortgageEasy so caption matching stays stable."""
    out: list[dict] = []
    for w in words:
        token = norm_token(w.get("word", ""))
        if token == "mortgageeasy":
            out.append({**w, "word": "Mortgage"})
            out.append({**w, "word": "Easy"})
        else:
            out.append(w)
    return out


def find_seq(texts: list[str], toks: list[str], from_i: int = 0):
    if not toks:
        return None
    candidates = [toks]
    if toks[0] in {"at", "and", "you", "because", "an", "many"} and len(toks) > 2:
        candidates.append(toks[1:])
    # Allow one missing Whisper token (e.g. Busy. Happy. Full… when Happy drops)
    if len(toks) >= 3:
        for skip in range(len(toks)):
            candidates.append(toks[:skip] + toks[skip + 1 :])
    for cand in candidates:
        n = len(cand)
        for i in range(from_i, len(texts) - n + 1):
            if texts[i : i + n] == cand:
                return i, n
    return None


def find_span(words: list[dict], phrase: str, from_i: int = 0):
    words = expand_whisper_words(words)
    texts = [norm_token(w.get("word", "")) for w in words]
    toks = tokenize(phrase)
    found = find_seq(texts, toks, from_i)
    if not found:
        raise RuntimeError(f"could not find phrase: {phrase!r}")
    s, n = found
    end_i = min(len(words) - 1, s + n - 1)
    return float(words[s]["start"]), float(words[end_i]["end"]), end_i + 1


def vtt_stamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def section_parts(item) -> tuple[int, str, dict]:
    if len(item) == 3:
        num, text, opts = item
        return int(num), str(text), dict(opts or {})
    num, text = item
    return int(num), str(text), {}


def caption_lines(sections: list) -> list[str]:
    lines = []
    for item in sections:
        _num, text, _opts = section_parts(item)
        for para in text.strip().split("\n"):
            line = para.strip()
            if line:
                lines.append(line)
    return lines


def write_vtt(path: Path, words: list[dict], lines: list[str]) -> None:
    cues = []
    from_i = 0
    for line in lines:
        try:
            start, end, from_i = find_span(words, line, from_i)
            cues.append((start + OPEN, end + OPEN, line))
            print(f"  cue {start + OPEN:6.2f}-{end + OPEN:6.2f} {line[:64]}")
        except RuntimeError as exc:
            print("  MISS", line[:64], exc)
    body = ["WEBVTT", ""]
    for i, (start, end, line) in enumerate(cues):
        if i + 1 < len(cues):
            end = min(end, cues[i + 1][0] - 0.04)
        if end <= start:
            end = start + 0.6
        body.append(f"{vtt_stamp(start)} --> {vtt_stamp(end)}")
        body.append(line)
        body.append("")
    path.write_text("\n".join(body))


def build_vo(key: str, film: dict) -> Path:
    ASSETS.mkdir(parents=True, exist_ok=True)
    default_tempo = float(film.get("tempo", ATEMPO))
    reuse = {int(x) for x in film.get("reuse_sections") or []}
    files = []
    for item in film["sections"]:
        num, text, opts = section_parts(item)
        raw = Path("/tmp") / f"{key}-compliant-vo-{num}-raw.mp3"
        out = ASSETS / f"{key}-compliant-vo-{num}-sonia.mp3"
        tempo = float(opts.get("tempo", default_tempo))
        break_ms = int(opts.get("break_ms", 350))
        if num in reuse and out.exists():
            print(f"reuse {key} block {num} ({out.name} {duration(out):.2f}s)")
            files.append(out)
            continue
        print(
            f"tts {key} block {num} chars={len(text)} tempo={tempo:.4f} break={break_ms}ms"
        )
        raw.write_bytes(tts(text, break_ms=break_ms))
        atempo(raw, out, tempo=tempo)
        print(f"  {out.name} {duration(out):.2f}s")
        files.append(out)

    concat_list = Path(f"/tmp/{key}-compliant-concat.txt")
    concat_list.write_text("".join(f"file '{p}'\n" for p in files))
    full = film["vo_full"]
    subprocess.check_call(
        [
            FFMPEG,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(full),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"full VO {full.name} {duration(full):.2f}s")
    return full


def remux(film: dict, vo: Path) -> None:
    src = film["src_mp4"]
    out = film["out_mp4"]
    vid_dur = duration(src)
    vo_dur = duration(vo)
    speech_window = max(1.0, vid_dur - OPEN - END_HOLD)
    print(f"remux {src.name} vid={vid_dur:.2f}s vo={vo_dur:.2f}s window={speech_window:.2f}s")

    work = Path(f"/tmp/{film['label']}-compliant-remux")
    work.mkdir(parents=True, exist_ok=True)
    voice = work / "voice.mp3"

    if vo_dur <= speech_window + 0.05:
        # Pad end silence so total audio matches existing picture (VO over B-roll).
        tail = max(END_HOLD, vid_dur - OPEN - vo_dur)
        subprocess.check_call(
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
                f"{tail:.2f}",
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
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.check_call(
            [
                FFMPEG,
                "-y",
                "-i",
                str(src),
                "-i",
                str(voice),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
                "-movflags",
                "+faststart",
                str(out),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        # New VO longer: keep open + speech + short end hold; stretch picture to match.
        total = OPEN + vo_dur + END_HOLD
        factor = total / vid_dur
        print(f"  VO longer — stretch picture factor={factor:.4f} total={total:.2f}s")
        subprocess.check_call(
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
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.check_call(
            [
                FFMPEG,
                "-y",
                "-i",
                str(src),
                "-i",
                str(voice),
                "-filter_complex",
                f"[0:v]setpts=PTS*{factor:.6f},fps=24,scale=1280:720,setsar=1[v];"
                f"[1:a]aresample=48000,aformat=channel_layouts=stereo[a]",
                "-map",
                "[v]",
                "-map",
                "[a]",
                "-r",
                "24",
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
                str(out),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    film["canonical"].write_bytes(out.read_bytes())
    print(f"wrote {out} ({duration(out):.2f}s) and {film['canonical'].name}")


def process_film(key: str, film: dict) -> None:
    print(f"\n=== {key} ===")
    if not film["src_mp4"].exists():
        raise SystemExit(f"missing source {film['src_mp4']}")
    HOLD.mkdir(parents=True, exist_ok=True)
    vo = build_vo(key, film)
    words_path = ASSETS / f"{key}-compliant-vo-words.json"
    words = whisper_words(vo)
    words_path.write_text(json.dumps(words, indent=2))
    write_vtt(film["out_vtt"], words, caption_lines(film["sections"]))
    print(f"wrote {film['out_vtt'].name}")
    remux(film, vo)


def main() -> None:
    import sys

    keys = sys.argv[1:] or list(FILMS.keys())
    for key in keys:
        if key not in FILMS:
            raise SystemExit(f"unknown film {key}; choose from {list(FILMS)}")
        process_film(key, FILMS[key])
    print("\nDone. Update index.html sources to the new filenames.")


if __name__ == "__main__":
    main()
