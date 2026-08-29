export const WHATSAPP_TEST_COOLDOWN_MS = 60_000;
export const WHATSAPP_TEST_DAILY_LIMIT = 10;

export type WhatsappTestLimitState = {
  dayKey?: string;
  attempts?: number;
  lastAttemptAt?: number;
};

export type WhatsappTestLimitDecision =
  | { ok: true; next: Required<WhatsappTestLimitState> }
  | { ok: false; reason: "cooldown" | "daily_limit" };

export function whatsappTestDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function decideWhatsappTestAttempt(
  current: WhatsappTestLimitState | undefined,
  now: number,
): WhatsappTestLimitDecision {
  const dayKey = whatsappTestDayKey(now);
  const sameDay = current?.dayKey === dayKey;
  const attempts = sameDay && typeof current?.attempts === "number" && current.attempts > 0
    ? current.attempts
    : 0;
  const lastAttemptAt = sameDay && typeof current?.lastAttemptAt === "number"
    ? current.lastAttemptAt
    : 0;

  if (lastAttemptAt > 0 && now - lastAttemptAt < WHATSAPP_TEST_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }
  if (attempts >= WHATSAPP_TEST_DAILY_LIMIT) return { ok: false, reason: "daily_limit" };
  return { ok: true, next: { dayKey, attempts: attempts + 1, lastAttemptAt: now } };
}
