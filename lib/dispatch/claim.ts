// Helpers PUROS do claim de job e da cota (sem dependencia de Firestore, para
// teste unitario). A atomicidade real vem da transacao do Firestore em
// lib/dispatch.ts; aqui ficam as decisoes e uma store em memoria que espelha
// a mesma garantia (check-and-set) para testar concorrencia.

// So reivindica jobs ainda "scheduled". "processing" (outro worker ja pegou),
// "sent", "failed" e "cancelled" nao sao reivindicaveis.
export function canClaim(status: string): boolean {
  return status === "scheduled";
}

// Campo do contador de cota conforme o canal (WhatsApp tem cota propria porque
// cada mensagem tem custo na Meta; e-mail usa a cota legada "dispatches").
export function quotaUsageField(isWhatsapp: boolean): string {
  return isWhatsapp ? "quotas.whatsappMonthUsed" : "quotas.dispatchesMonthUsed";
}

export function hasQuota(used: number, limit: number): boolean {
  return used < limit;
}

// Um job so e "vencido" (elegivel para disparo pelo cron) quando runAt <= now.
// Como o retry reagenda o job com runAt = nextAttemptAt (futuro), esta mesma
// funcao garante que a proxima tentativa so ocorre apos o backoff.
export function isJobDue(runAt: number, now: number): boolean {
  return runAt <= now;
}

// Limiar para considerar um job "processing" como ORFAO (worker morreu apos o
// claim e antes de escrever o estado terminal). O maxDuration do cron e 60s,
// entao nenhuma execucao legitima fica "processing" por 10 min — a margem e 10x.
export const PROCESSING_TIMEOUT_MS = 10 * 60_000;

// True se o job esta preso em "processing" ha tempo demais e pode ser recuperado.
// Exige claimedAt conhecido (jobs sem claimedAt NAO sao tocados, por seguranca).
export function isOrphanProcessing(
  status: string,
  claimedAt: number | undefined,
  now: number,
  timeoutMs: number = PROCESSING_TIMEOUT_MS,
): boolean {
  if (status !== "processing" || claimedAt === undefined) return false;
  return now - claimedAt >= timeoutMs;
}

// Store de jobs em memoria com claim ATOMICO (secao critica sincrona),
// espelhando a garantia da transacao do Firestore. Usada nos testes de
// concorrencia (dois workers tentando o mesmo job).
export function createInMemoryJobStore(initial: Record<string, string>) {
  const status = new Map<string, string>(Object.entries(initial));
  return {
    get: (id: string) => status.get(id),
    async claim(id: string): Promise<boolean> {
      const s = status.get(id);
      if (s === undefined || !canClaim(s)) return false;
      status.set(id, "processing"); // check-and-set sincrono = atomico
      return true;
    },
    async markSent(id: string) {
      status.set(id, "sent");
    },
    async markFailed(id: string) {
      status.set(id, "failed");
    },
  };
}
