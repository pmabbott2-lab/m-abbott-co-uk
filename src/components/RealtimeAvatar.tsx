import { useCallback, useEffect, useRef, useState } from "react";
import type { SimliClient } from "simli-client";
import { TalkingPhoto } from "@/components/TalkingPhoto";
import { supabase } from "@/integrations/supabase/client";
import {
  REALTIME_AVATAR_ENABLED,
  registerRealtimeAvatarSink,
  type RealtimeAvatarSink,
} from "@/lib/realtime-avatar-bridge";

/**
 * RealtimeAvatar — a real-time, lip-synced "Susan" avatar powered by Simli
 * (https://docs.simli.com), wired behind the `VITE_REALTIME_AVATAR` flag.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SAFE BY DEFAULT
 * ─────────────────────────────────────────────────────────────────────────
 * When the flag is OFF (default), this renders <TalkingPhoto> verbatim — the
 * Simli code below never even mounts. It is a literal drop-in for <TalkingPhoto>
 * (identical props), so it can replace it in the interview route with no risk.
 *
 * When the flag is ON, on the first user gesture we:
 *   1. Mint a short-lived Simli session token from `/api/avatar-token`
 *      (server keeps SIMLI_API_KEY; the faceId is baked into the token).
 *   2. Open ONE Simli WebRTC session for the whole interview (billed per
 *      second — we never open one per line) and attach the streamed video to a
 *      <video> in the same circular footprint as <TalkingPhoto>.
 *   3. Register a sink (see realtime-avatar-bridge) so `useAudioPlayback` can
 *      hand us decoded TTS as 16 kHz mono Int16 PCM. Simli plays that audio and
 *      lip-syncs to it — so the existing <audio> element does NOT play it too
 *      (avoids double audio).
 *
 * On ANY failure (no key/501, token error, WebRTC failure, or browser-voice
 * fallback) we keep showing <TalkingPhoto>, so behaviour degrades gracefully.
 * We use OpenAI `sage` TTS + our STT/turn-taking exactly as before; Simli only
 * renders the face.
 */

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

/** Simli recommends ~6000-byte PCM chunks (even → keeps Int16 alignment). */
const SIMLI_CHUNK_BYTES = 6000;

type SessionStatus = "idle" | "connecting" | "ready" | "failed";

function RealtimeAvatarImpl(props: Props) {
  const { size = 240, usingBrowserVoice } = props;

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<SimliClient | null>(null);
  const startedRef = useRef(false);
  const unregisterRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const statusRef = useRef<SessionStatus>(status);
  statusRef.current = status;

  const usingBrowserVoiceRef = useRef(usingBrowserVoice);
  usingBrowserVoiceRef.current = usingBrowserVoice;

  const teardown = useCallback((next: SessionStatus) => {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      // stop() is async but we don't need to await — closing the session is
      // best-effort cleanup (it ends Simli billing for this session).
      void Promise.resolve()
        .then(() => client.stop())
        .catch(() => {});
    }
    setStatus(next);
  }, []);

  const startSession = useCallback(async () => {
    if (startedRef.current) return;
    // No OpenAI MP3 to stream when on the browser voice — stay on the portrait.
    if (usingBrowserVoiceRef.current) return;
    startedRef.current = true;
    setStatus("connecting");

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;

      const res = await fetch("/api/avatar-token", {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`avatar-token ${res.status}`);
      const { session_token: sessionToken } = (await res.json()) as { session_token?: string };
      if (!sessionToken) throw new Error("Missing Simli session token");

      const video = videoRef.current;
      const audio = audioRef.current;
      if (!video || !audio) throw new Error("Avatar media elements unavailable");

      // Client-only import: keeps Simli (and its livekit-client dep, which
      // touches browser globals) out of the SSR bundle.
      const { SimliClient, LogLevel } = await import("simli-client");
      const client = new SimliClient(
        sessionToken,
        video,
        audio,
        null, // livekit mode — no manual ICE servers; better behind firewalls
        LogLevel.ERROR,
        "livekit",
      );
      clientRef.current = client;

      // Terminal failures (bad faceId, depleted minutes, WebRTC crash): the SDK
      // retries transient issues itself, so these mean "fall back to portrait".
      client.on("error", () => teardown("failed"));
      client.on("startup_error", () => teardown("failed"));

      await client.start();

      // A late teardown (e.g. browser-voice flip) may have nulled the ref.
      if (clientRef.current !== client) {
        void client.stop().catch(() => {});
        return;
      }
      setStatus("ready");
    } catch (err) {
      console.warn("Realtime avatar unavailable — using static portrait", err);
      teardown("failed");
    }
  }, [teardown]);

  // Start one session on the first user gesture (satisfies autoplay policy and
  // avoids billing before the user actually engages with the interview).
  useEffect(() => {
    const onGesture = () => {
      void startSession();
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [startSession]);

  // Expose the sink so useAudioPlayback can feed us decoded PCM. Methods read
  // refs (not state) so they never see stale values.
  useEffect(() => {
    const sink: RealtimeAvatarSink = {
      isReady: () =>
        statusRef.current === "ready" && !!clientRef.current && !usingBrowserVoiceRef.current,
      speak: async (pcm: Int16Array) => {
        const client = clientRef.current;
        if (!client || statusRef.current !== "ready") throw new Error("Avatar not ready");
        const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i < bytes.length; i += SIMLI_CHUNK_BYTES) {
          client.sendAudioData(bytes.slice(i, i + SIMLI_CHUNK_BYTES));
        }
      },
      clear: () => {
        try {
          clientRef.current?.ClearBuffer();
        } catch {
          /* best-effort */
        }
      },
    };
    const unregister = registerRealtimeAvatarSink(sink);
    unregisterRef.current = unregister;
    return () => {
      unregister();
      if (unregisterRef.current === unregister) unregisterRef.current = null;
    };
  }, []);

  // If TTS falls back to the browser voice mid-session, there's no PCM to feed
  // Simli — tear the session down and revert to the portrait.
  useEffect(() => {
    if (usingBrowserVoice && clientRef.current) {
      teardown("failed");
    }
  }, [usingBrowserVoice, teardown]);

  // Close the session on unmount (one session per interview; billed per second).
  useEffect(() => {
    return () => {
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void client.stop().catch(() => {});
    };
  }, []);

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      {/* Base portrait: always present, so we have a face while connecting and a
          graceful fallback on failure. It also keeps the listening/speaking rings. */}
      <TalkingPhoto {...props} />

      {/* Streamed Simli video, fading in over the portrait once the session is live. */}
      <div
        className="absolute inset-0 rounded-full overflow-hidden"
        style={{
          opacity: status === "ready" ? 1 : 0,
          transition: "opacity 300ms ease",
          pointerEvents: "none",
        }}
        aria-hidden={status !== "ready"}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
        />
      </div>

      {/* Simli attaches the remote AUDIO track here — the single source of truth
          for Susan's voice in this mode (the existing <audio> stays silent). */}
      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  );
}

export function RealtimeAvatar(props: Props) {
  // Flag OFF (default): behave exactly like <TalkingPhoto>. The Simli component
  // never mounts, so no session, no token fetch, no extra hooks run.
  if (!REALTIME_AVATAR_ENABLED) {
    return <TalkingPhoto {...props} />;
  }
  return <RealtimeAvatarImpl {...props} />;
}
