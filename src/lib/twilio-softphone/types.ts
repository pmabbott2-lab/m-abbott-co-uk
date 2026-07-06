export type SoftphoneDisplayState =
  | "ready"
  | "dialling"
  | "ringing"
  | "connected"
  | "ended"
  | "failed";

export const SOFTPHONE_STATE_LABELS: Record<SoftphoneDisplayState, string> = {
  ready: "Ready",
  dialling: "Dialling",
  ringing: "Ringing",
  connected: "Connected",
  ended: "Call ended",
  failed: "Call failed",
};

export type PrepareCallResult = {
  callId: string;
  customerPhone: string;
  fromNumber: string;
};
