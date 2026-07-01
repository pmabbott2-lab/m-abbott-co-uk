// In-memory login SMS codes (per dev server process). Codes expire after 10 minutes.

type Challenge = { code: string; expiresAt: number };

const challenges = new Map<string, Challenge>();
const TTL_MS = 10 * 60 * 1000;

export function storeLoginSmsCode(userId: string, code: string): void {
  challenges.set(userId, { code, expiresAt: Date.now() + TTL_MS });
}

export function verifyLoginSmsCode(userId: string, code: string): boolean {
  const entry = challenges.get(userId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    challenges.delete(userId);
    return false;
  }
  if (entry.code !== code.trim()) return false;
  challenges.delete(userId);
  return true;
}

export function clearLoginSmsCode(userId: string): void {
  challenges.delete(userId);
}
