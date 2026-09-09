#!/usr/bin/env python3
"""Home Mover V1 VO: Azure en-GB-SoniaNeural, captions + picture timing."""

import json
import os
import subprocess
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path("/Users/petermabbott/Projects/m-abbott-co-uk-main")
ENV = ROOT / ".env"
ASSETS = Path(
    "/Users/petermabbott/.cursor/projects/Users-petermabbott-Downloads-m-abbott-co-uk-main/assets"
)
SITE_VTT = ROOT / "marketing/mortgage-hub-website/assets/video/home-mover-draft-v1.vtt"
FFMPEG = str(ROOT / "node_modules/@ffmpeg-installer/darwin-x64/ffmpeg")
VOICE = "en-GB-SoniaNeural"
OPEN = 3.20
END_HOLD = 3.50
ATEMPO = 1.05

SECTIONS = [
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
        "Moving home is also a natural time to review.\n"
        "Your equity. Your existing mortgage. What your next mortgage could look like.\n"
        "Because what worked when you bought your first home may not be right for you now.",
    ),
    (
        4,
        "You can have that conversation from home, at a time that works for you.\n"
        "We'll look at it together and help you understand your options.",
    ),
    (
        5,
        "Because life is busy enough. Good mortgage advice should fit around it.\n"
        "Your first home was about getting started.\n"
        "Your next home is about moving forward.\n"
        "And when life moves on, your mortgage should move with it.",
    ),
]

CAPTION_CUES = []
for _num, text in SECTIONS:
    for para in text.strip().split("\n"):
        line = para.strip()
        if line:
            CAPTION_CUES.append(line)

# Preferred live lengths, then caps. Leftover lands on flexible cards/clips.
LIVE = [
    ("HOME", 12.00, 14.00),
    ("NEXT", 9.00, 12.00),
    ("REVIEW", 14.00, 16.00),
    ("CALL", 12.00, 14.00),
    ("CLOSE", 14.00, 18.00),
]


def env_value(name: str) -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def duration(path: Path) -> float:
    import re

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


def ssml(text: str) -> bytes:
    parts = []
    for para in text.strip().split("\n"):
        para = para.strip()
        if not para:
            continue
        parts.append(escape(para))
        parts.append('<break time="350ms"/>')
    inner = "\n".join(parts)
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-GB'>"
        f"<voice name='{VOICE}'>"
        "<prosody rate='-5%'>"
        f"{inner}"
        "</prosody></voice></speak>"
    ).encode("utf-8")


def tts(text: str) -> bytes:
    key, region = azure_speech()
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml(text),
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
            "User-Agent": "MortgageEasyHomeMoverSonia",
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
    with urllib.request.urlopen(req, timeout=180) as res:
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
}


def norm_token(tok: str) -> str:
    token = tok.lower().replace("—", " ").replace("–", " ").replace("'", "'").strip(".,!?\"' ")
    token = token.replace("'", "")
    return ALIASES.get(token, token)


def tokenize(text: str) -> list[str]:
    cleaned = text.replace("—", " ").replace("–", " ").replace("-", " ")
    return [norm_token(t) for t in cleaned.split() if norm_token(t)]


def find_seq(texts: list[str], toks: list[str], from_i: int = 0):
    if not toks:
        return None
    candidates = [toks]
    if toks[0] in {"at", "and", "you", "because"} and len(toks) > 2:
        candidates.append(toks[1:])
    for cand in candidates:
        n = len(cand)
        for i in range(from_i, len(texts) - n + 1):
            if texts[i : i + n] == cand:
                return i, n
    return None


def find_span(words: list[dict], start_phrase: str, end_phrase: str, from_i: int = 0):
    texts = [norm_token(w.get("word", "")) for w in words]
    start_toks = tokenize(start_phrase)
    end_toks = tokenize(end_phrase)
    found = find_seq(texts, start_toks, from_i)
    if not found:
        raise RuntimeError(f"could not find start phrase: {start_phrase!r}")
    s, _ = found
    found_end = find_seq(texts, end_toks, s)
    if not found_end:
        raise RuntimeError(f"could not find end phrase: {end_phrase!r}")
    e, n = found_end
    end_i = min(len(words) - 1, e + n - 1)
    return float(words[s]["start"]), float(words[end_i]["end"]), end_i + 1


def vtt_stamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def write_vtt(words: list[dict]) -> None:
    cues = []
    from_i = 0
    for line in CAPTION_CUES:
        try:
            start, end, from_i = find_span(words, line, line, from_i)
            cues.append((start + OPEN, end + OPEN, line))
            print(f"cue {start + OPEN:6.2f}-{end + OPEN:6.2f} {line[:56]}")
        except RuntimeError as exc:
            print("MISS", line, exc)
    body = ["WEBVTT", ""]
    for i, (start, end, line) in enumerate(cues):
        if i + 1 < len(cues):
            end = min(end, cues[i + 1][0] - 0.04)
        if end <= start:
            end = start + 0.6
        body.append(f"{vtt_stamp(start)} --> {vtt_stamp(end)}")
        body.append(line)
        body.append("")
    SITE_VTT.parent.mkdir(parents=True, exist_ok=True)
    SITE_VTT.write_text("\n".join(body))


def write_timing(vo_dur: float, words: list[dict]) -> None:
    from_i = 0
    marks = {}
    for key, phrase in [
        ("next", "Maybe you want"),
        ("review", "Moving home is also"),
        ("call", "You can have that conversation"),
        ("busy", "Because life is busy enough"),
        ("forward", "Your next home is about moving forward"),
        ("moves", "And when life moves on"),
    ]:
        try:
            start, end, from_i = find_span(words, phrase, phrase, from_i)
            marks[key] = (start, end)
            print(f"mark {key:11} {start:6.2f}-{end:6.2f}")
        except RuntimeError as exc:
            print("mark MISS", key, exc)

    end_title = 3.20
    names = [row[0] for row in LIVE]
    caps = [row[2] for row in LIVE]
    vals = [row[1] for row in LIVE]

    if "next" in marks:
        vals[0] = min(caps[0], max(8.0, marks["next"][0]))
    if "review" in marks and "next" in marks:
        vals[1] = min(caps[1], max(6.0, marks["review"][0] - marks["next"][0]))
    if "call" in marks and "review" in marks:
        vals[2] = min(caps[2], max(8.0, marks["call"][0] - marks["review"][0]))
    if "busy" in marks and "call" in marks:
        vals[3] = min(caps[3], max(8.0, marks["busy"][0] - marks["call"][0]))
    if "busy" in marks:
        vals[4] = max(8.0, round(vo_dur - marks["busy"][0] - end_title, 2))
        vals[4] = min(caps[4], vals[4])

    live_actual = round(sum(vals), 2)
    drift = round(vo_dur - end_title - live_actual, 2)
    if abs(drift) > 0.05:
        vals[4] = round(max(6.0, vals[4] + drift), 2)
        live_actual = round(sum(vals), 2)
        end_title = round(max(2.40, vo_dur - live_actual), 2)

    close_fade = 0.70
    close_logo = round(END_HOLD + close_fade, 2)
    lines = [
        f"OPEN_DUR={OPEN:.2f}",
        f"END_HOLD={END_HOLD:.2f}",
        f"CLOSE_FADE={close_fade:.2f}",
        f"CLOSE_LOGO={close_logo:.2f}",
        f"VO_DUR={vo_dur:.2f}",
        f"END_TITLE={end_title:.2f}",
    ]
    for name, dur in zip(names, vals):
        lines.append(f"{name}={dur:.2f}")
    (ASSETS / "home-mover-vo-timing.sh").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


def captions_and_timing(full: Path) -> None:
    vo_dur = duration(full)
    print("full", full, f"{vo_dur:.2f}s")
    words_path = ASSETS / "home-mover-vo-words.json"
    if words_path.exists() and os.environ.get("HOME_MOVER_REFRESH_WHISPER") != "1":
        words = json.loads(words_path.read_text())
        print("reusing", words_path.name)
    else:
        words = whisper_words(full)
        words_path.write_text(json.dumps(words, indent=2))
    write_vtt(words)
    print("wrote captions", SITE_VTT)
    write_timing(vo_dur, words)


def main() -> None:
    import sys

    ASSETS.mkdir(exist_ok=True)
    full = ASSETS / "home-mover-vo-full-sonia.mp3"
    if "--captions-only" in sys.argv:
        if not full.exists():
            raise SystemExit("missing home-mover-vo-full-sonia.mp3")
        os.environ["HOME_MOVER_REFRESH_WHISPER"] = "1"
        captions_and_timing(full)
        return

    files = []
    for num, text in SECTIONS:
        raw = Path("/tmp") / f"home-mover-vo-block-{num}-sonia-raw.mp3"
        out = ASSETS / f"home-mover-vo-block-{num}-sonia.mp3"
        print(f"tts sonia home-mover block {num} chars={len(text)}")
        raw.write_bytes(tts(text))
        atempo(raw, out)
        print(f"  wrote {out.name} {duration(out):.2f}s (atempo={ATEMPO})")
        files.append(out)

    concat_list = Path("/tmp/home-mover-sonia-concat.txt")
    concat_list.write_text("".join(f"file '{p}'\n" for p in files))
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
    os.environ["HOME_MOVER_REFRESH_WHISPER"] = "1"
    captions_and_timing(full)


if __name__ == "__main__":
    main()
