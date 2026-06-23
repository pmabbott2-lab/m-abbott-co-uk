import { useEffect, useRef, useState } from "react";
import avatarImg from "@/assets/avatar.png";

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
        className="rounded-full relative"
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

export function useAudioPlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const unlockedRef = useRef(false);
  const [playing, setPlaying] = useState(false);

  const silentWav = "data:audio/wav;base64,UklGRlIAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YS4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const ensureAudio = () => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }
    return audioRef.current;
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
    await audio.play();
    unlockedRef.current = true;
  };

  const playWithHtmlAudio = async (blob: Blob) => {
    const audio = ensureAudio();
    const url = URL.createObjectURL(blob);
    audio.loop = false;
    audio.src = url;
    audio.load();
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        audio.loop = false;
        setPlaying(false);
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        audio.loop = false;
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

  const playWithAudioContext = async (blob: Blob) => {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("Web audio is unavailable");
    const ctx = audioCtxRef.current ?? new AC();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await new Promise<void>((resolve, reject) => {
      const source = ctx.createBufferSource();
      sourceRef.current = source;
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null;
        setPlaying(false);
        resolve();
      };
      try {
        setPlaying(true);
        source.start(0);
      } catch (error) {
        setPlaying(false);
        reject(error);
      }
    });
  };

  const playWithSpeechSynthesis = async (text: string) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      throw new Error("Speech output is unavailable");
    }
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.onend = () => {
        setPlaying(false);
        resolve();
      };
      utterance.onerror = () => {
        setPlaying(false);
        reject(new Error("Speech synthesis failed"));
      };
      setPlaying(true);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  };

  const play = async (text: string) => {
    const audio = ensureAudio();
    if (!audio.loop) audio.pause();
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("TTS failed");
    const blob = await res.blob();
    try {
      await playWithHtmlAudio(blob);
    } catch (htmlError) {
      console.warn("HTML audio playback failed, trying Web Audio", htmlError);
      try {
        await playWithAudioContext(blob);
      } catch (webAudioError) {
        console.warn("Web Audio playback failed, trying browser speech", webAudioError);
        await playWithSpeechSynthesis(text);
      }
    }
  };

  const stop = () => {
    audioRef.current?.pause();
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
  };

  useEffect(() => () => {
    audioRef.current?.pause();
    try { sourceRef.current?.stop(); } catch {}
    audioCtxRef.current?.close().catch(() => {});
  }, []);
  return { play, stop, playing, unlock };
}
