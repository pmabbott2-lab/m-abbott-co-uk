import { useCallback, useEffect, useRef, useState } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import { useServerFn } from "@tanstack/react-start";
import { getVoiceAccessToken, attachBrowserCallSid, finalizeBrowserCall } from "@/lib/telephony.functions";
import type { SoftphoneDisplayState } from "@/lib/twilio-softphone/types";

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useTwilioSoftphone(opts?: { onCallComplete?: () => void }) {
  const onCallComplete = opts?.onCallComplete;
  const tokenFn = useServerFn(getVoiceAccessToken);
  const attachFn = useServerFn(attachBrowserCallSid);
  const finalizeFn = useServerFn(finalizeBrowserCall);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const activeCallIdRef = useRef<string | null>(null);

  const [displayState, setDisplayState] = useState<SoftphoneDisplayState>("ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [timerLabel, setTimerLabel] = useState("00:00");
  const [isDeviceReady, setIsDeviceReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    connectedAtRef.current = null;
    setTimerLabel("00:00");
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    connectedAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      if (!connectedAtRef.current) return;
      const elapsed = Math.floor((Date.now() - connectedAtRef.current) / 1000);
      setTimerLabel(formatTimer(elapsed));
    }, 1000);
  }, [clearTimer]);

  const teardownCall = useCallback(
    async (status: "completed" | "failed" | "canceled" | "no_answer" = "completed") => {
      const callId = activeCallIdRef.current;
      const elapsed =
        connectedAtRef.current != null
          ? Math.floor((Date.now() - connectedAtRef.current) / 1000)
          : 0;
      activeCallIdRef.current = null;
      callRef.current = null;
      clearTimer();
      setIsMuted(false);
      setIsOnHold(false);

      if (callId) {
        try {
          await finalizeFn({
            data: { callId, status, durationSeconds: elapsed > 0 ? elapsed : undefined },
          });
        } catch {
          /* best-effort */
        }
      }
    },
    [clearTimer, finalizeFn],
  );

  const wireCall = useCallback(
    (call: Call, callId: string) => {
      callRef.current = call;
      activeCallIdRef.current = callId;

      call.on("ringing", () => setDisplayState("ringing"));
      call.on("accept", () => {
        setDisplayState("connected");
        startTimer();
        const sid = call.parameters?.CallSid;
        if (sid) {
          attachFn({ data: { callId, twilioCallSid: sid } }).catch(() => {});
        }
      });
      call.on("disconnect", () => {
        setDisplayState("ended");
        void teardownCall("completed").then(() => onCallComplete?.());
      });
      call.on("cancel", () => {
        setDisplayState("ended");
        void teardownCall("canceled");
      });
      call.on("reject", () => {
        setDisplayState("failed");
        setErrorMessage("Call was rejected.");
        void teardownCall("failed");
      });
      call.on("error", (err) => {
        setDisplayState("failed");
        setErrorMessage(err.message || "Call failed");
        void teardownCall("failed");
      });
    },
    [attachFn, onCallComplete, startTimer, teardownCall],
  );

  const ensureDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current;
    setIsInitializing(true);
    setErrorMessage(null);
    try {
      const { token } = await tokenFn({ data: undefined as never });
      const device = new Device(token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        closeProtection: true,
      });

      device.on("registered", () => {
        setIsDeviceReady(true);
        setDisplayState("ready");
      });
      device.on("unregistered", () => setIsDeviceReady(false));
      device.on("error", (err) => {
        setErrorMessage(err.message);
        setDisplayState("failed");
      });
      device.on("tokenWillExpire", async () => {
        try {
          const { token: fresh } = await tokenFn({ data: undefined as never });
          device.updateToken(fresh);
        } catch {
          setErrorMessage("Voice token expired — refresh the page.");
        }
      });

      await device.register();
      deviceRef.current = device;
      return device;
    } finally {
      setIsInitializing(false);
    }
  }, [tokenFn]);

  useEffect(() => {
    void ensureDevice().catch((e: unknown) => {
      setErrorMessage(e instanceof Error ? e.message : "Could not initialise softphone");
      setDisplayState("failed");
    });

    return () => {
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
      deviceRef.current = null;
      clearTimer();
    };
  }, [ensureDevice, clearTimer]);

  const requestMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Your browser does not support microphone access.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  }, []);

  const connect = useCallback(
    async (opts: { callId: string; customerPhone: string }) => {
      setErrorMessage(null);
      setDisplayState("dialling");
      try {
        await requestMicrophone();
        const device = await ensureDevice();
        const call = await device.connect({
          params: {
            To: opts.customerPhone,
            CallId: opts.callId,
          },
        });
        const sid = call.parameters?.CallSid;
        if (sid) {
          attachFn({ data: { callId: opts.callId, twilioCallSid: sid } }).catch(() => {});
        }
        wireCall(call, opts.callId);
      } catch (e: unknown) {
        setDisplayState("failed");
        setErrorMessage(e instanceof Error ? e.message : "Could not start call");
        await teardownCall("failed");
        throw e;
      }
    },
    [ensureDevice, requestMicrophone, teardownCall, wireCall],
  );

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
    setDisplayState("ended");
    void teardownCall("completed").then(() => onCallComplete?.());
  }, [teardownCall, onCallComplete]);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !call.isMuted();
    call.mute(next);
    setIsMuted(next);
  }, []);

  const toggleHold = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !isOnHold;
    if (next) {
      call.hold();
    } else {
      call.unhold();
    }
    setIsOnHold(next);
  }, [isOnHold]);

  const resetToReady = useCallback(() => {
    setDisplayState("ready");
    setErrorMessage(null);
  }, []);

  return {
    displayState,
    errorMessage,
    isMuted,
    isOnHold,
    timerLabel,
    isDeviceReady,
    isInitializing,
    isInCall: displayState === "dialling" || displayState === "ringing" || displayState === "connected",
    connect,
    hangUp,
    toggleMute,
    toggleHold,
    resetToReady,
  };
}
