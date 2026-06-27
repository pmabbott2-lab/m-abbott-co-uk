import { useEffect, useRef } from "react";
import susanImg from "@/assets/susan.png";

/**
 * TalkingPhoto — a clean, dependency-free professional portrait of Susan.
 *
 * It is a drop-in replacement for <Avatar3D>: same props, same visual footprint
 * (a circular framed portrait inside the interview card). No WebGL, no ML, no
 * network — just the real photo with subtle, never-broken motion cues:
 *   • a soft glow ring + gentle pulse while she's speaking, scaled a touch by
 *     the live speech amplitude so she feels responsive;
 *   • the listening pulse-ring while we're on the mic;
 *   • slow idle "breathing" so the still frame feels alive.
 *
 * Deliberately NO "jaw-split" / layered-image effect — a single, unbroken
 * portrait is the target. Simplicity beats fancy here.
 */

const BASE_SIZE = 240;
const IDLE_SCALE = 0.006; // gentle breathing scale when idle
const SPEAK_SCALE = 0.018; // subtle lean-in baseline while speaking
const AMP_SCALE = 0.03; // extra scale driven by live speech amplitude
const SMOOTH = 0.25; // amplitude low-pass

type Props = {
  /** True while Susan is speaking. */
  speaking?: boolean;
  /** True while listening on the mic. */
  listening?: boolean;
  /** Live 0..1 speech loudness (from useAudioPlayback). */
  getAmplitude?: () => number;
  /** Browser-voice sessions have no analysable stream — drive a procedural pulse. */
  usingBrowserVoice?: boolean;
  size?: number;
};

export function TalkingPhoto({
  speaking = false,
  listening = false,
  getAmplitude,
  usingBrowserVoice = false,
  size = BASE_SIZE,
}: Props) {
  const frameWrapRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  // Latest props for the RAF loop, so we never animate on a stale closure.
  const propsRef = useRef({ speaking, getAmplitude, usingBrowserVoice });
  propsRef.current = { speaking, getAmplitude, usingBrowserVoice };

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let smoothAmp = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const { speaking, getAmplitude, usingBrowserVoice } = propsRef.current;

      let target = speaking && getAmplitude ? getAmplitude() : 0;
      if (speaking && usingBrowserVoice && target < 0.02) {
        // Browser TTS has no analysable stream — pulse procedurally so she still
        // reads as actively speaking.
        target = 0.16 + 0.14 * Math.abs(Math.sin(t * 9)) + 0.07 * Math.abs(Math.sin(t * 15));
      }
      target = Math.max(0, Math.min(1, target));
      smoothAmp += (target - smoothAmp) * SMOOTH;
      const amp = speaking ? smoothAmp : 0;

      if (frameWrapRef.current) {
        const breathe = reduceMotion ? 0 : (Math.sin(t * 0.9) + 1) * 0.5 * IDLE_SCALE;
        const speak = speaking ? SPEAK_SCALE + amp * AMP_SCALE : 0;
        frameWrapRef.current.style.transform = `scale(${1 + breathe + speak})`;
      }
      if (glowRef.current) {
        glowRef.current.style.opacity = speaking ? `${0.35 + amp * 0.65}` : "0";
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      {/* Listening cue — soft ring/pulse around the frame. */}
      <div
        className={`absolute inset-0 rounded-full ${listening ? "pulse-ring" : ""}`}
        style={{
          background:
            "radial-gradient(circle at 30% 30%, oklch(0.78 0.16 55 / 0.25), transparent 65%)",
        }}
      />

      {/* Speaking glow ring — fades/strengthens with live amplitude. */}
      <div
        ref={glowRef}
        aria-hidden
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: -6,
          opacity: 0,
          transition: "opacity 120ms linear",
          boxShadow:
            "0 0 0 3px oklch(0.78 0.16 55 / 0.35), 0 0 22px 6px oklch(0.78 0.16 55 / 0.30)",
        }}
      />

      {/* The portrait. A single, unbroken image — gentle breathing/lean-in only. */}
      <div
        ref={frameWrapRef}
        className="absolute inset-0 rounded-full overflow-hidden shadow-sm ring-1 ring-border/50"
        style={{ willChange: "transform" }}
      >
        <img
          src={susanImg}
          alt="Susan, your interview guide"
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
