import { useCallback, useEffect, useRef, useState } from "react";
import type { SimliClient } from "simli-client";
import {
  ConnectingHold,
  CONNECTING_HEADLINE,
  CONNECTING_LINE,
  WAITING_ROOM_HEADLINE,
  WAITING_ROOM_LINE,
} from "@/components/ConnectingHold";
import { TalkingPhoto } from "@/components/TalkingPhoto";
import { AVATAR_STAGE, avatarCropInnerStyle, avatarStageFrameHeight } from "@/lib/avatar-frame";
import { supabase } from "@/integrations/supabase/client";
import {
  REALTIME_AVATAR_ENABLED,
  registerRealtimeAvatarSink,
  trimPcmLeadingSilence,
  type RealtimeAvatarSink,
} from "@/lib/realtime-avatar-bridge";

/**
 * RealtimeAvatar — a real-time, lip-synced "Susan" avatar powered by Simli
 * (https://docs.simli.com), wired behind the `VITE_REALTIME_AVATAR` flag.
 *
 * When the flag is OFF, this renders <TalkingPhoto> verbatim.
 * When the flag is ON:
 *   - Before `enabled` (consent + Start): show the waiting-room hold only.
 *     Do not open Simli — that was the frozen-Susan flash on the consent screen.
 *   - After `enabled`: connect Simli, keep the hold until live video has painted,
 *     then fade Susan in. We never put a still of Susan in the connecting slot.
 */

type Props = {
  speaking?: boolean;
  listening?: boolean;
  getAmplitude?: () => number;
  usingBrowserVoice?: boolean;
  /** When false, keep the waiting room and do not start Simli. */
  enabled?: boolean;
  size?: number;
  layout?: "circle" | "stage";
};

const SIMLI_CHUNK_BYTES = 6000;
const CONNECT_RETRY_MS = 3000;
const CONNECT_RETRY_MAX_MS = 10000;

type SessionStatus = "idle" | "connecting" | "ready";

function RealtimeAvatarImpl(props: Props) {
  const {
    size = 240,
    usingBrowserVoice,
    enabled = false,
    layout = "stage",
  } = props;
  const stage = layout === "stage";
  const width = stage ? AVATAR_STAGE.width : size;
  const height = stage ? avatarStageFrameHeight() : size;
  const frameRadius = stage ? AVATAR_STAGE.radius : "9999px";
  const cropInner = avatarCropInnerStyle();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<SimliClient | null>(null);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const unregisterRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const statusRef = useRef<SessionStatus>(status);
  statusRef.current = status;

  const [videoReady, setVideoReady] = useState(false);

  const usingBrowserVoiceRef = useRef(usingBrowserVoice);
  usingBrowserVoiceRef.current = usingBrowserVoice;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const stopClient = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      void Promise.resolve()
        .then(() => client.stop())
        .catch(() => {});
    }
    setVideoReady(false);
  }, []);

  const startSession = useCallback(async () => {
    if (startedRef.current) return;
    if (!enabledRef.current) return;
    if (usingBrowserVoiceRef.current) return;
    startedRef.current = true;
    setStatus("connecting");

    let delay = CONNECT_RETRY_MS;
    while (!cancelledRef.current && enabledRef.current && !usingBrowserVoiceRef.current) {
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

        const { SimliClient, LogLevel } = await import("simli-client");
        const client = new SimliClient(
          sessionToken,
          video,
          audio,
          null,
          LogLevel.ERROR,
          "livekit",
        );
        clientRef.current = client;

        const reconnect = () => {
          if (cancelledRef.current || !enabledRef.current) return;
          if (statusRef.current !== "ready") return;
          stopClient();
          startedRef.current = false;
          setStatus("connecting");
          void startSession();
        };
        client.on("error", reconnect);
        client.on("startup_error", reconnect);

        await client.start();
        void video.play().catch(() => {});

        if (clientRef.current !== client) {
          void client.stop().catch(() => {});
          return;
        }
        setStatus("ready");
        return;
      } catch (err) {
        console.warn("Realtime avatar connecting — retrying", err);
        stopClient();
        if (cancelledRef.current || !enabledRef.current || usingBrowserVoiceRef.current) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay + 1000, CONNECT_RETRY_MAX_MS);
      }
    }
    startedRef.current = false;
  }, [stopClient]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled || usingBrowserVoice) {
      stopClient();
      startedRef.current = false;
      setStatus("idle");
      setVideoReady(false);
      return () => {
        cancelledRef.current = true;
      };
    }

    void startSession();
    return () => {
      cancelledRef.current = true;
    };
  }, [enabled, usingBrowserVoice, startSession, stopClient]);

  useEffect(() => {
    const sink: RealtimeAvatarSink = {
      isReady: () =>
        enabledRef.current &&
        statusRef.current === "ready" &&
        !!clientRef.current &&
        !usingBrowserVoiceRef.current,
      isFailed: () => !!usingBrowserVoiceRef.current,
      speak: async (pcm: Int16Array) => {
        const client = clientRef.current;
        if (!client || statusRef.current !== "ready") throw new Error("Avatar not ready");
        const trimmed = trimPcmLeadingSilence(pcm);
        const bytes = new Uint8Array(trimmed.buffer, trimmed.byteOffset, trimmed.byteLength);
        let offset = 0;
        const immediate = (client as SimliClient & { sendAudioDataImmediate?: (data: Uint8Array) => void })
          .sendAudioDataImmediate;
        if (typeof immediate === "function" && bytes.length) {
          const first = Math.min(SIMLI_CHUNK_BYTES, bytes.length);
          immediate.call(client, bytes.slice(0, first));
          offset = first;
        }
        for (let i = offset; i < bytes.length; i += SIMLI_CHUNK_BYTES) {
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

  useEffect(() => {
    if (status !== "ready") {
      setVideoReady(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setVideoReady(true);
    };

    const vid = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };

    let rvfcId: number | undefined;
    if (typeof vid.requestVideoFrameCallback === "function") {
      rvfcId = vid.requestVideoFrameCallback(markReady);
    }
    video.addEventListener("playing", markReady);
    video.addEventListener("loadeddata", markReady);

    return () => {
      cancelled = true;
      if (rvfcId !== undefined) vid.cancelVideoFrameCallback?.(rvfcId);
      video.removeEventListener("playing", markReady);
      video.removeEventListener("loadeddata", markReady);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void client.stop().catch(() => {});
    };
  }, []);

  const live = enabled && status === "ready" && videoReady;
  const holdHeadline = enabled ? CONNECTING_HEADLINE : WAITING_ROOM_HEADLINE;
  const holdLine = enabled ? CONNECTING_LINE : WAITING_ROOM_LINE;

  return (
    <div className="relative inline-block" style={{ width, height }}>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: frameRadius,
          opacity: live ? 1 : 0,
          transition: "opacity 450ms ease-in-out",
          pointerEvents: "none",
        }}
        aria-hidden={!live}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            ...cropInner,
            objectFit: "cover",
            objectPosition: "top",
          }}
        />
      </div>

      <div
        className="absolute inset-0 overflow-hidden ring-1 ring-border/50 bg-[#14110e]"
        style={{
          borderRadius: frameRadius,
          opacity: live ? 0 : 1,
          transition: "opacity 280ms ease-out",
          pointerEvents: live ? "none" : undefined,
        }}
        aria-hidden={live}
      >
        <ConnectingHold radius={frameRadius} headline={holdHeadline} line={holdLine} />
      </div>

      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  );
}

export function RealtimeAvatar(props: Props) {
  if (!REALTIME_AVATAR_ENABLED) {
    return <TalkingPhoto {...props} />;
  }
  return <RealtimeAvatarImpl {...props} />;
}
