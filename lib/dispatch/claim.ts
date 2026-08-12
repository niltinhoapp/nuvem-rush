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
