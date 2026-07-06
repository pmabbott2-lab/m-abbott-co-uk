import { useEffect, useRef, useState } from "react";
import avatarImg from "@/assets/susan.png";
import {
  isOpenAIQuotaError,
  pickBritishFemaleVoice,
  preferBrowserSpeech,
  preloadBrowserVoices,
  speakWithBrowser,
} from "@/lib/browser-speech";
import {
  REALTIME_AVATAR_ENABLED,
  encodePcm16kMono,
  getRealtimeAvatarSink,
  type RealtimeAvatarSink,
} from "@/lib/realtime-avatar-bridge";

type TtsMode = "openai" | "browser";

/** Options for a single spoken line. */
type PlayOpts = {
  /** Fires once when playback is within `leadMs` of finishing (used to pre-arm the mic). */
  onNearEnd?: () => void;
  /** How early before the end to fire `onNearEnd`. Defaults to 1000ms. */
  leadMs?: number;
  /** When true, don't drive the karaoke reveal (used for short filler/ack clips). */
  noReveal?: boolean;
};

export function Avatar({ speaking, listening, size = 220 }: { speaking?: boolean; listening?: boolean; size?: number }) {
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <div
        className={`absolute inset-0 rounded-full ${listening ? "pulse-ring" : ""}`}
        style={{ background: "radial-gradient(circle at 30% 30%, oklch(0.78 0.16 55 / 0.25), transparent 65%)" }}
      />
      <img
        src={avatarImg}
        alt="Interview guide"
        width={size}
        height={size}
        className="rounded-full object-cover object-top relative"
        style={{ transform: speaking ? "scale(1.02)" : "scale(1)", transition: "transform 200ms" }}
      />
      {speaking && (
        <span className="absolute left-1/2 -translate-x-1/2" style={{ bottom: size * 0.18 }}>
          <span className="block w-6 h-2 bg-foreground/70 rounded-full speak-mouth" />
        </span>
      )}
    </div>
  );
}

const blobCache = new Map<string, Blob>();
const MAX_BLOB_CACHE = 40;

function cacheBlob(text: string, blob: Blob) {
  const key = text.trim();
  if (blobCache.has(key)) blobCache.delete(key);
  blobCache.set(key, blob);
  while (blobCache.size > MAX_BLOB_CACHE) {
    const oldest = blobCache.keys().next().value;
    if (oldest) blobCache.delete(oldest);
  }
}

async function fetchTtsBlob(text: string, authToken: string | null): Promise<Blob> {
  const key = text.trim();
  const cached = blobCache.get(key);
  if (cached) return cached;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "TTS failed");
    throw new Error(msg);
  }
  const blob = await res.blob();
  cacheBlob(key, blob);
  return blob;
}

export function useAudioPlayback(getAuthToken?: () => Promise<string | null>) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const ampDataRef = useRef<Uint8Array | null>(null);
  const unlockedRef = useRef(false);
  const ttsModeRef = useRef<TtsMode | null>(preferBrowserSpeech() ? "browser" : null);
  const ttsProbeRef = useRef<Promise<void> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(1); // 0..1 reveal fraction for karaoke text
  const [usingBrowserVoice, setUsingBrowserVoice] = useState(preferBrowserSpeech());
  const progressRafRef = useRef<number | null>(null);
  const getAuthTokenRef = useRef(getAuthToken);
  getAuthTokenRef.current = getAuthToken;

  const setTtsMode = (mode: TtsMode) => {
    ttsModeRef.current = mode;
    setUsingBrowserVoice(mode === "browser");
  };

  const ensureTtsMode = async (token: string | null) => {
    if (ttsModeRef.current) return;
    if (preferBrowserSpeech()) {
      setTtsMode("browser");
      return;
    }
    try {
      // Unique text so server/client cache cannot mask a live quota failure.
      await fetchTtsBlob(`Ready ${Date.now()}`, token);
      setTtsMode("openai");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("OpenAI TTS probe failed — locking browser voice for session", msg);
      setTtsMode("browser");
    }
  };

  const runTtsProbe = (token: string | null) => {
    if (ttsModeRef.current) return Promise.resolve();
    if (!ttsProbeRef.current) {
      ttsProbeRef.current = ensureTtsMode(token).finally(() => {
        ttsProbeRef.current = null;
      });
    }
    return ttsProbeRef.current;
  };

  const silentWav = "data:audio/wav;base64,UklGRlIAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YS4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const ensureAudio = () => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }
    return audioRef.current;
  };

  /** Lazily create a shared AnalyserNode wired to the speakers, for lip-sync. */
  const ensureAnalyser = (ctx: AudioContext) => {
    if (!analyserRef.current) {
      const a = ctx.createAnalyser();
      a.fftSize = 256;
      a.smoothingTimeConstant = 0.6;
      a.connect(ctx.destination);
      analyserRef.current = a;
      ampDataRef.current = new Uint8Array(a.fftSize);
    }
    return analyserRef.current;
  };

  /** Route the <audio> element through the analyser (once). Skips if the context
   *  isn't running, to avoid muting playback. */
  const tapHtmlAudio = (audio: HTMLAudioElement) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== "running" || mediaSrcRef.current) return;
    try {
      const analyser = ensureAnalyser(ctx);
      const src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      mediaSrcRef.current = src;
    } catch {
      /* analysis is best-effort; audio still plays via the element */
    }
  };

  /** Current speech loudness 0..1, read live from the analyser (0 when idle or
   *  when using the browser voice, which has no analysable stream). */
  const getAmplitude = () => {
    const a = analyserRef.current;
    const data = ampDataRef.current;
    if (!a || !data) return 0;
    a.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.max(0, Math.min(1, rms * 3.2));
  };

  const unlock = async () => {
    const audio = ensureAudio();
    if (unlockedRef.current && !audio.paused) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC && !audioCtxRef.current) audioCtxRef.current = new AC();
    if (audioCtxRef.current?.state === "suspended") await audioCtxRef.current.resume();
    if (audioCtxRef.current) {
      const buffer = audioCtxRef.current.createBuffer(1, 1, audioCtxRef.current.sampleRate);
      const source = audioCtxRef.current.createBufferSource();
      const gain = audioCtxRef.current.createGain();
      gain.gain.value = 0;
      source.buffer = buffer;
      source.connect(gain).connect(audioCtxRef.current.destination);
      source.start(0);
    }
    audio.onended = null;
    audio.onerror = null;
    audio.loop = true;
    audio.src = silentWav;
    audio.load();
    await audio.play().catch((error) => {
      if (audioCtxRef.current?.state !== "running") throw error;
    });
    unlockedRef.current = true;
  };

  const playWithHtmlAudio = async (blob: Blob, opts?: PlayOpts) => {
    const audio = ensureAudio();
    tapHtmlAudio(audio);
    const url = URL.createObjectURL(blob);
    audio.loop = false;
    audio.src = url;
    audio.load();
    const report = (v: number) => { if (!opts?.noReveal) setProgress(v); };
    setProgress(0);
    let nearEndFired = false;
    const leadSec = (opts?.leadMs ?? 1000) / 1000;
    await new Promise<void>((resolve, reject) => {
      audio.ontimeupdate = () => {
        const d = audio.duration;
        if (d && isFinite(d)) {
          report(Math.min(1, audio.currentTime / d));
          if (!nearEndFired && opts?.onNearEnd && d - audio.currentTime <= leadSec) {
            nearEndFired = true;
            opts.onNearEnd();
          }
        }
      };
      audio.onended = () => {
        audio.loop = false;
        audio.ontimeupdate = null;
        report(1);
        setPlaying(false);
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        audio.loop = false;
        audio.ontimeupdate = null;
        report(1);
        setPlaying(false);
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback error"));
      };
      audio.play()
        .then(() => setPlaying(true))
        .catch((error) => {
          setPlaying(false);
          URL.revokeObjectURL(url);
          reject(error);
        });
    });
  };

  const playWithAudioContext = async (blob: Blob, opts?: PlayOpts) => {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("Web audio is unavailable");
    const ctx = audioCtxRef.current ?? new AC();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const report = (v: number) => { if (!opts?.noReveal) setProgress(v); };
    setProgress(0);
    const leadSec = (opts?.leadMs ?? 1000) / 1000;
    await new Promise<void>((resolve, reject) => {
      const source = ctx.createBufferSource();
      sourceRef.current = source;
      source.buffer = buffer;
      source.connect(ensureAnalyser(ctx));
      const dur = buffer.duration;
      const startTime = ctx.currentTime;
      let nearEndFired = false;
      const tick = () => {
        const elapsed = ctx.currentTime - startTime;
        const p = dur ? Math.min(1, elapsed / dur) : 1;
        report(p);
        if (!nearEndFired && opts?.onNearEnd && dur - elapsed <= leadSec) {
          nearEndFired = true;
          opts.onNearEnd();
        }
        if (p < 1 && sourceRef.current === source) {
          progressRafRef.current = requestAnimationFrame(tick);
        }
      };
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null;
        if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
        report(1);
        setPlaying(false);
        resolve();
      };
      try {
        setPlaying(true);
        source.start(0);
        progressRafRef.current = requestAnimationFrame(tick);
      } catch (error) {
        setPlaying(false);
        reject(error);
      }
    });
  };

  const playWithBrowser = async (text: string, opts?: PlayOpts) => {
    setPlaying(true);
    const report = (v: number) => { if (!opts?.noReveal) setProgress(v); };
    setProgress(0);
    const len = Math.max(1, text.length);
    let nearEndFired = false;
    // ~14 chars/sec at our speaking rate; used to approximate the lead time.
    const leadChars = ((opts?.leadMs ?? 1000) / 1000) * 14;
    try {
      await speakWithBrowser(text, {
        onBoundary: (charIndex) => {
          report(Math.min(1, charIndex / len));
          if (!nearEndFired && opts?.onNearEnd && len - charIndex <= leadChars) {
            nearEndFired = true;
            opts.onNearEnd();
          }
        },
      });
    } finally {
      report(1);
      setPlaying(false);
    }
  };

  /**
   * Realtime-avatar (Simli) playback. Decodes the MP3 to PCM, hands it to the
   * avatar to play + lip-sync (so we do NOT play it locally — avoids double
   * audio), and drives the karaoke reveal from the decoded buffer's known
   * duration instead of the analyser. Only ever called when the flag is on.
   */
  const playViaRealtimeAvatar = async (blob: Blob, sink: RealtimeAvatarSink, opts?: PlayOpts) => {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("Web audio is unavailable");
    const ctx = audioCtxRef.current ?? new AC();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const pcm = encodePcm16kMono(buffer);
    await sink.speak(pcm);

    const report = (v: number) => { if (!opts?.noReveal) setProgress(v); };
    setProgress(0);
    const dur = buffer.duration;
    const leadSec = (opts?.leadMs ?? 1000) / 1000;
    await new Promise<void>((resolve) => {
      const startMs = performance.now();
      let nearEndFired = false;
      const tick = () => {
        const elapsed = (performance.now() - startMs) / 1000;
        const p = dur ? Math.min(1, elapsed / dur) : 1;
        report(p);
        if (!nearEndFired && opts?.onNearEnd && dur - elapsed <= leadSec) {
          nearEndFired = true;
          opts.onNearEnd();
        }
        if (p < 1) {
          progressRafRef.current = requestAnimationFrame(tick);
        } else {
          report(1);
          setPlaying(false);
          resolve();
        }
      };
      setPlaying(true);
      progressRafRef.current = requestAnimationFrame(tick);
    });
  };

  const playWithOpenAi = async (text: string, token: string | null, opts?: PlayOpts) => {
    const blob = await fetchTtsBlob(text, token);

    // Flag-gated realtime-avatar path. When VITE_REALTIME_AVATAR is off,
    // getRealtimeAvatarSink() always returns null, so this block is inert and
    // the default local-audio path below is byte-for-byte unchanged.
    if (REALTIME_AVATAR_ENABLED) {
      const sink = getRealtimeAvatarSink();
      if (sink?.isReady()) {
        try {
          await playViaRealtimeAvatar(blob, sink, opts);
          return;
        } catch (avatarError) {
          console.warn("Realtime avatar playback failed — using local audio", avatarError);
          // fall through to normal local playback
        }
      }
    }

    try {
      await playWithHtmlAudio(blob, opts);
    } catch (htmlError) {
      console.warn("HTML audio playback failed, trying Web Audio", htmlError);
      await playWithAudioContext(blob, opts);
    }
  };

  const prefetch = async (texts: string[]) => {
    const token = (await getAuthTokenRef.current?.()) ?? null;
    await runTtsProbe(token);
    if (ttsModeRef.current === "browser") return;
    await Promise.allSettled(
      texts.filter((t) => t.trim() && !blobCache.has(t.trim())).map((t) => fetchTtsBlob(t, token)),
    );
  };

  const play = async (text: string, opts?: PlayOpts) => {
    setProgress(0);
    const audio = ensureAudio();
    if (!audio.loop) audio.pause();

    const token = (await getAuthTokenRef.current?.()) ?? null;
    await runTtsProbe(token);

    if (ttsModeRef.current === "browser") {
      return playWithBrowser(text, opts);
    }

    try {
      await playWithOpenAi(text, token, opts);
      if (!ttsModeRef.current) setTtsMode("openai");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("OpenAI TTS unavailable, locking browser voice for session", msg);
      setTtsMode("browser");
      if (isOpenAIQuotaError(msg)) {
        console.info("OpenAI quota exceeded — using British English browser voice for Susan");
      }
      await playWithBrowser(text, opts);
    }
  };

  const stop = () => {
    audioRef.current?.pause();
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
    progressRafRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    // Inert when the flag is off (getRealtimeAvatarSink() returns null).
    if (REALTIME_AVATAR_ENABLED) getRealtimeAvatarSink()?.clear();
    setPlaying(false);
  };

  useEffect(() => () => {
    audioRef.current?.pause();
    try { sourceRef.current?.stop(); } catch {}
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  useEffect(() => {
    preloadBrowserVoices();
    if (!("speechSynthesis" in window)) return;
    const load = () => pickBritishFemaleVoice();
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  return { play, prefetch, stop, playing, progress, unlock, usingBrowserVoice, getAmplitude };
}
