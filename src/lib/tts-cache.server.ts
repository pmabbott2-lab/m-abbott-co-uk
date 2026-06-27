const MAX_ENTRIES = 80;
const cache = new Map<string, ArrayBuffer>();

/** Bump when voice/model changes so old cached audio is not reused. */
const CACHE_VERSION = "v3-sage";

function cacheKey(text: string): string {
  return `${CACHE_VERSION}:${text.trim().slice(0, 4000)}`;
}

export function getCachedTts(text: string): ArrayBuffer | undefined {
  return cache.get(cacheKey(text));
}

export function setCachedTts(text: string, audio: ArrayBuffer): void {
  const key = cacheKey(text);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, audio);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function clearTtsCache(): void {
  cache.clear();
}
