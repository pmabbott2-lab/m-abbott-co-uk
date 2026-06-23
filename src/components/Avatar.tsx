import { useEffect, useRef, useState } from "react";
import avatarImg from "@/assets/avatar.png";

export function Avatar({
  speaking,
  listening,
  size = 220,
  videoRef,
  showVideo,
}: {
  speaking?: boolean;
  listening?: boolean;
  size?: number;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  showVideo?: boolean;
}) {
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
        style={{
          transform: speaking ? "scale(1.02)" : "scale(1)",
          transition: "transform 200ms",
          visibility: showVideo ? "hidden" : "visible",
        }}
      />
      {videoRef && (
        <video
          ref={videoRef}
          playsInline
          width={size}
          height={size}
          className="rounded-full absolute inset-0 object-cover"
          style={{ display: showVideo ? "block" : "none" }}
        />
      )}
      {speaking && !showVideo && (
        <span className="absolute left-1/2 -translate-x-1/2" style={{ bottom: size * 0.18 }}>
          <span className="block w-6 h-2 bg-foreground/70 rounded-full speak-mouth" />
        </span>
      )}
    </div>
  );
}

export function useTalkingHead() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const unlockedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const unlock = async () => {
    const v = videoRef.current;
    if (!v || unlockedRef.current) return;
    try {
      v.muted = true;
      v.playsInline = true;
      // Tiny user-initiated play to satisfy autoplay policies for later src changes
      const playPromise = v.play();
      if (playPromise) {
        await playPromise.catch(() => {});
      }
      v.pause();
      v.muted = false;
      unlockedRef.current = true;
    } catch {
      // ignore — we'll surface a real error on first real play
    }
  };

  const play = async (text: string) => {
    const v = videoRef.current;
    if (!v) throw new Error("Video element not mounted");

    const res = await fetch("/api/talking-head", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || "Talking-head generation failed");
    }
    const { url } = (await res.json()) as { url: string };

    v.muted = false;
    v.src = url;
    v.load();
    setShowVideo(true);

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        v.onended = null;
        v.onerror = null;
      };
      v.onended = () => {
        cleanup();
        setPlaying(false);
        setShowVideo(false);
        resolve();
      };
      v.onerror = () => {
        cleanup();
        setPlaying(false);
        setShowVideo(false);
        reject(new Error("Video playback error"));
      };
      v.play()
        .then(() => setPlaying(true))
        .catch((err) => {
          cleanup();
          setPlaying(false);
          setShowVideo(false);
          reject(err);
        });
    });
  };

  const stop = () => {
    const v = videoRef.current;
    if (v) {
      try { v.pause(); } catch {}
    }
    setPlaying(false);
    setShowVideo(false);
  };

  useEffect(() => () => {
    const v = videoRef.current;
    if (v) {
      try { v.pause(); } catch {}
    }
  }, []);

  return { play, stop, playing, unlock, videoRef, showVideo };
}

// Kept for backwards compatibility / fallback audio-only playback.
export function useAudioPlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    audio.onended = null;
    audio.onerror = null;
    audio.loop = true;
    audio.src = silentWav;
    audio.load();
    await audio.play();
    unlockedRef.current = true;
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

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  useEffect(() => () => audioRef.current?.pause(), []);
  return { play, stop, playing, unlock };
}
