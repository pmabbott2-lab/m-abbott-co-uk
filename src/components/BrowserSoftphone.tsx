import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTwilioSoftphone } from "@/hooks/useTwilioSoftphone";
import { SOFTPHONE_STATE_LABELS, type SoftphoneDisplayState } from "@/lib/twilio-softphone/types";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<SoftphoneDisplayState, string> = {
  ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  dialling: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  ringing: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  connected: "bg-primary/15 text-primary",
  ended: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};

export function BrowserSoftphone({
  customerName,
  customerPhone,
  onCall,
  disabled,
  onCallComplete,
}: {
  customerName?: string | null;
  customerPhone: string;
  onCall: () => Promise<{ callId: string; customerPhone: string }>;
  disabled?: boolean;
  onCallComplete?: () => void;
}) {
  const phone = useTwilioSoftphone({ onCallComplete });
  const {
    displayState,
    errorMessage,
    isMuted,
    isOnHold,
    timerLabel,
    isDeviceReady,
    isInitializing,
    isInCall,
    connect,
    hangUp,
    toggleMute,
    toggleHold,
    resetToReady,
  } = phone;

  const handleCall = async () => {
    const prepared = await onCall();
    await connect({ callId: prepared.callId, customerPhone: prepared.customerPhone });
  };

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Browser softphone</p>
          <p className="text-xs text-muted-foreground">
            {customerName ? `Calling ${customerName}` : "Use your headset — customer sees the office line."}
          </p>
        </div>
        <span
          className={cn(
            "text-xs font-medium px-2.5 py-1 rounded-full",
            STATE_STYLES[displayState],
          )}
        >
          {SOFTPHONE_STATE_LABELS[displayState]}
          {displayState === "connected" && ` · ${timerLabel}`}
        </span>
      </div>

      {isInitializing && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Connecting to Twilio Voice…
        </p>
      )}

      {!isInitializing && !isDeviceReady && displayState !== "failed" && (
        <p className="text-xs text-muted-foreground">Registering softphone…</p>
      )}

      {errorMessage && (
        <p className="text-xs text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!isInCall && displayState !== "ended" && (
          <Button
            type="button"
            size="sm"
            disabled={disabled || !isDeviceReady || isInitializing}
            onClick={() => void handleCall().catch(() => {})}
          >
            <Phone className="w-4 h-4 mr-2" />
            Call {customerPhone}
          </Button>
        )}

        {isInCall && (
          <>
            <Button type="button" size="sm" variant="destructive" onClick={hangUp}>
              <PhoneOff className="w-4 h-4 mr-2" />
              End call
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={toggleMute}>
              {isMuted ? (
                <>
                  <MicOff className="w-4 h-4 mr-2" />
                  Unmute
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Mute
                </>
              )}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={toggleHold}>
              {isOnHold ? (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Hold
                </>
              )}
            </Button>
          </>
        )}

        {(displayState === "ended" || displayState === "failed") && (
          <Button type="button" size="sm" variant="secondary" onClick={resetToReady}>
            Ready for next call
          </Button>
        )}
      </div>
    </div>
  );
}
