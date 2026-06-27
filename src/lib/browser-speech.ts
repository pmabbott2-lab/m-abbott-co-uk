/** Browser speech APIs — fallback when OpenAI TTS/STT is unavailable or rate-limited. */

export type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isBrowserSttSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function preferBrowserSpeech(): boolean {
  return import.meta.env.VITE_PREFER_BROWSER_SPEECH === "true";
}

/** Locked for the page session so Susan's browser voice never swaps mid-interview. */
let lockedBritishVoice: SpeechSynthesisVoice | null = null;

export function pickBritishFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (lockedBritishVoice) return lockedBritishVoice;
  const voices = window.speechSynthesis.getVoices();
  const score = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase();
    const name = v.name.toLowerCase();
    let s = 0;
    if (lang.startsWith("en-gb")) s += 40;
    else if (lang.startsWith("en")) s += 10;
    if (/kate|serena|martha|fiona|moira|susan|female|woman|victoria|samantha/i.test(name)) s += 30;
    if (/daniel|james|male|man|aaron|fred/i.test(name)) s -= 50;
    if (v.default && s > 0) s += 5;
    return s;
  };
  const ranked = [...voices].sort((a, b) => score(b) - score(a));
  lockedBritishVoice =
    ranked.find((v) => score(v) > 0) ?? voices.find((v) => v.lang.toLowerCase().startsWith("en-gb")) ?? null;
  return lockedBritishVoice;
}

export function speakWithBrowser(
  text: string,
  opts?: { onBoundary?: (charIndex: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      reject(new Error("Speech output is unavailable in this browser"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 1.08;
    utterance.pitch = 1.05;
    const voice = pickBritishFemaleVoice();
    if (voice) utterance.voice = voice;
    if (opts?.onBoundary) {
      utterance.onboundary = (e: SpeechSynthesisEvent) => opts.onBoundary?.(e.charIndex);
    }
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("Browser speech failed"));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export function preloadBrowserVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
}

export function isOpenAIQuotaError(message: string): boolean {
  return /429|quota|rate limit|insufficient/i.test(message);
}
