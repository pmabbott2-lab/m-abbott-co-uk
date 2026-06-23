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
  const [playing, setPlaying] = useState(false);

  const play = async (text: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("TTS failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(true);
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback error"));
      };
      audio.play().catch(reject);
    });
  };

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  useEffect(() => () => audioRef.current?.pause(), []);
  return { play, stop, playing };
}
