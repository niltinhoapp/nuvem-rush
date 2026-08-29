// Idempotência DETERMINÍSTICA de enrollment/jobs (PURO/testável).
// A segurança exactly-once vive no EFEITO PERSISTIDO (não só no lease):
//   enrollmentId = sha256(storeId : originId : flowId)   (origin = order OU cart)
//   jobId        = `${enrollmentId}_${stepIndex}`
// Retry após crash reencontra os efeitos existentes e completa só os ausentes.
import { createHash } from "node:crypto";

// origem = orderId (pós-venda) OU cartId (carrinho). Identidade estável por
// (loja, origem, fluxo): mesmo par -> mesmo enrollment; fluxos/lojas diferentes
// -> enrollments independentes.
export function enrollmentKey(storeId: string, originId: string, flowId: string): string {
  return createHash("sha256").update(`${storeId}:${originId}:${flowId}`, "utf8").digest("hex");
}

export function jobKey(enrollmentId: string, stepIndex: number): string {
  return `${enrollmentId}_${stepIndex}`;
}

export type EnrollmentState = "MISSING" | "PARTIAL" | "COMPLETE";

// Reconhece o estado dos efeitos persistidos. COMPLETE só quando o enrollment
// existe E todos os jobs obrigatórios existem.
export function classifyEnrollment(enrollmentExists: boolean, jobsExist: boolean[]): EnrollmentState {
  const anyJob = jobsExist.some(Boolean);
  const allJobs = jobsExist.length > 0 ? jobsExist.every(Boolean) : true;
  if (!enrollmentExists && !anyJob) return "MISSING";
  if (enrollmentExists && allJobs) return "COMPLETE";
  return "PARTIAL";
}

// Plano idempotente: o que falta criar dado o estado atual. Retry completa
// PARTIAL sem duplicar o que já existe.
export function planEnrollment(
  enrollmentExists: boolean,
  jobsExist: boolean[],
): { createEnrollment: boolean; jobsToCreate: number[] } {
  return {
    createEnrollment: !enrollmentExists,
    jobsToCreate: jobsExist.map((e, i) => (e ? -1 : i)).filter((i) => i >= 0),
  };
}
