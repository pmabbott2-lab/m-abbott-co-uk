/**
 * Realtime avatar bridge — the *only* link between our TTS audio pipeline
 * (`useAudioPlayback` in `src/components/Avatar.tsx`) and the Simli-powered
 * <RealtimeAvatar>.
 *
 * It is a tiny, framework-agnostic module-level registry so the audio producer
 * and the avatar (a sibling component) can rendezvous without prop-drilling.
 *
 * CRITICAL SAFETY PROPERTY: everything here is gated by `REALTIME_AVATAR_ENABLED`.
 * When the flag is OFF, `getRealtimeAvatarSink()` always returns `null`, so the
 * existing audio path in `useAudioPlayback` is byte-for-byte unchanged — the
 * realtime branch there is dead code that never executes.
 */

/** Off by default. Set VITE_REALTIME_AVATAR=true to opt in. */
export const REALTIME_AVATAR_ENABLED = import.meta.env.VITE_REALTIME_AVATAR === "true";

/** Simli requires PCM Int16, mono, 16 kHz. */
export const SIMLI_SAMPLE_RATE = 16000;

/**
 * A sink that consumes our decoded TTS audio and renders Susan's lip-synced
 * face. Implemented by <RealtimeAvatar> and fed by `useAudioPlayback`.
 */
export type RealtimeAvatarSink = {
  /** True only when a Simli session is live and ready to receive audio. */
  isReady: () => boolean;
  /**
   * Hand off one spoken line as 16 kHz mono Int16 PCM. The avatar plays the
   * audio itself (single source of truth — we must NOT also play it locally,
   * to avoid double audio). Resolves once the audio has been fully streamed.
   */
  speak: (pcm: Int16Array) => Promise<void>;
  /** Stop the avatar mid-sentence and drop any buffered audio. */
  clear: () => void;
};

let activeSink: RealtimeAvatarSink | null = null;

/**
 * Register the live avatar sink. Returns an unregister fn. There is only ever
 * one interview avatar mounted at a time, so a single slot is sufficient.
 */
export function registerRealtimeAvatarSink(sink: RealtimeAvatarSink): () => void {
  activeSink = sink;
  return () => {
    if (activeSink === sink) activeSink = null;
  };
}

/**
 * Get the live sink, or `null` when the flag is off or no avatar is mounted.
 * Returning `null` while disabled is what keeps the flag-off path untouched.
 */
export function getRealtimeAvatarSink(): RealtimeAvatarSink | null {
  if (!REALTIME_AVATAR_ENABLED) return null;
  return activeSink;
}

/**
 * Decode-context output → Simli input. Downmixes to mono and resamples (linear
 * interpolation) to 16 kHz, then converts Float32 [-1,1] to Int16 little-endian.
 *
 * We resample manually rather than relying on a 16 kHz AudioContext because
 * Safari/iOS don't reliably honour a custom `sampleRate` on AudioContext.
 */
export function encodePcm16kMono(buffer: AudioBuffer): Int16Array {
  const srcRate = buffer.sampleRate;
  const srcLen = buffer.length;
  const channels = buffer.numberOfChannels;

  // Downmix all channels to a single mono Float32 track.
  const mono = new Float32Array(srcLen);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < srcLen; i++) mono[i] += data[i] / channels;
  }

  const clampToInt16 = (s: number): number => {
    const v = Math.max(-1, Math.min(1, s));
    return v < 0 ? v * 0x8000 : v * 0x7fff;
  };

  if (srcRate === SIMLI_SAMPLE_RATE) {
    const out = new Int16Array(srcLen);
    for (let i = 0; i < srcLen; i++) out[i] = clampToInt16(mono[i]);
    return out;
  }

  const dstLen = Math.max(1, Math.round((srcLen * SIMLI_SAMPLE_RATE) / srcRate));
  const out = new Int16Array(dstLen);
  const ratio = srcRate / SIMLI_SAMPLE_RATE;
  for (let i = 0; i < dstLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, srcLen - 1);
    const frac = pos - i0;
    out[i] = clampToInt16(mono[i0] * (1 - frac) + mono[i1] * frac);
  }
  return out;
}
