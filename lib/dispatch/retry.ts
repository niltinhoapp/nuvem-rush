// Politica de retry para falhas de envio (Fase E). PURO/testavel.
//
// TRANSITORIO (vale repetir): timeout, 429, 5xx, indisponibilidade temporaria.
// PERMANENTE (nao adianta repetir): config ausente, template inexistente/
// invalido, credencial invalida, payload invalido, 4xx (exceto 429).

export const MAX_ATTEMPTS = 5;

// Extrai um status HTTP embutido na mensagem dos canais, ex.:
// "WhatsApp API 503: ...". So considera padroes ancorados ("api NNN" ou "NNN:")
// para nao confundir com numeros soltos na mensagem.
function extractHttpStatus(msg: string): number | null {
  const m =
    msg.match(/\b(?:api|status|http)\s+(\d{3})\b/) ?? msg.match(/\b(\d{3}):/);
  return m ? Number(m[1]) : null;
}

export function isTransient(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();

  const status = extractHttpStatus(msg);
  if (status != null) {
    if (status === 429) return true; // rate limit -> transitorio
    if (status >= 500) return true; // erro de servidor -> transitorio
    return false; // demais 4xx -> permanente
  }

  // Sem status: heuristica por palavras-chave de rede/indisponibilidade.
  if (
    /(timeout|timed out|etimedout|econnreset|econnrefused|enotfound|eai_again|network|fetch failed|socket hang up|temporar|unavailable|try again)/.test(
      msg,
    )
  ) {
    return true;
  }

  // Desconhecido: trata como PERMANENTE, para nao criar tempestade de retries
  // (falhar visivelmente > repetir as cegas).
  return false;
}

// Backoff exponencial LIMITADO (teto de 1h). attempts = numero de tentativas
// ja realizadas (1 = apos a 1a falha).
export function backoffMs(attempts: number): number {
  const base = 60_000; // 1 min
  const cap = 60 * 60_000; // 1 h
  return Math.min(base * 2 ** Math.max(0, attempts - 1), cap);
}

export type RetryPlan =
  | { retry: true; attempts: number; nextAttemptAt: number }
  | { retry: false; attempts: number };

// Decide o proximo passo apos uma falha de ENVIO. `attempts` = tentativas ja
// feitas antes desta falha.
export function planRetry(attempts: number, err: unknown, now: number): RetryPlan {
  const nextAttempts = attempts + 1;
  if (!isTransient(err) || nextAttempts >= MAX_ATTEMPTS) {
    return { retry: false, attempts: nextAttempts };
  }
  return { retry: true, attempts: nextAttempts, nextAttemptAt: now + backoffMs(nextAttempts) };
}
