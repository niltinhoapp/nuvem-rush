// Lifecycle recuperável do claim de INSCRIÇÃO (bloqueador 2). PURO/testável.
//
// Separa conceitualmente "synced" (carrinho sincronizado) de "enrolled"
// (inscrito nos fluxos). O claim é um lease com fencing:
//   (ausente) -> enrolling { leaseId, leaseAt } -> enrolled (terminal)
// - inscrição falha: o lease "enrolling" NÃO vira enrolled; expira e o próximo
//   poll/cron retoma (retry). Nunca gera dedup permanente por falha.
// - sucesso: enrolled (terminal), bloqueia duplicata.
// - concorrência: só quem tem o lease vigente finaliza (fencing por leaseId).

export type EnrollStatus = "enrolling" | "enrolled";

export interface EnrollDoc {
  status: EnrollStatus;
  leaseId?: string;
  leaseAt?: number;
}

export const ENROLL_LEASE_MS = 5 * 60_000; // seguro vs maxDuration 60s do cron

// Pode reivindicar se não há doc, ou o "enrolling" está com lease vencido.
// "enrolled" é terminal -> nunca.
export function canClaimEnroll(
  doc: EnrollDoc | null,
  now: number,
  leaseMs: number = ENROLL_LEASE_MS,
): boolean {
  if (!doc) return true;
  if (doc.status === "enrolled") return false;
  // enrolling: só se o lease venceu (worker anterior morreu).
  return doc.leaseAt === undefined || now - doc.leaseAt >= leaseMs;
}

// Só finaliza (enrolling -> enrolled) quem detém o lease vigente (fencing).
export function canFinalizeEnroll(doc: EnrollDoc | null, myLeaseId: string): boolean {
  return !!doc && doc.status === "enrolling" && doc.leaseId === myLeaseId;
}
