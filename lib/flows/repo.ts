// Persistencia de Flows no Firestore (servidor).
import { db, col, storeRef } from "@/lib/firebase/admin";
import type { Flow, Step, Trigger } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import { cancelJobAndReleaseQuota } from "@/lib/dispatch/cancel";

export const FLOW_STATUSES = ["active", "paused", "draft"] as const;

export async function listFlows(storeId: string): Promise<Flow[]> {
  const snap = await col(storeId, "flows").orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => d.data() as Flow).filter((f) => !f.deletedAt);
}

export async function getFlow(storeId: string, flowId: string): Promise<Flow | null> {
  const doc = await col(storeId, "flows").doc(flowId).get();
  return doc.exists ? (doc.data() as Flow) : null;
}

// Cancela os jobs pendentes (scheduled/processing) de um fluxo, liberando
// cota — usado ao pausar ou excluir. Best-effort por job (cada cancelamento
// e atomico via cancelJobAndReleaseQuota); nao falha a operacao principal se
// um job especifico ja tiver mudado de estado entre a query e o cancelamento.
async function cancelPendingJobsOfFlow(
  storeId: string,
  flowId: string,
  reason: string,
  now: number,
): Promise<number> {
  let cancelled = 0;
  for (const status of ["scheduled", "processing"] as const) {
    const jobs = await col(storeId, "jobs")
      .where("flowId", "==", flowId)
      .where("status", "==", status)
      .get();
    for (const job of jobs.docs) {
      const ok = await cancelJobAndReleaseQuota({
        storeId, jobRef: job.ref, reason, now, expectedStatus: status,
      });
      if (ok) cancelled++;
    }
  }
  return cancelled;
}

// Altera o status de um fluxo (active/paused/draft). Pausar cancela
// imediatamente os jobs ja agendados desse fluxo (com liberacao de cota) —
// reativar NAO os recria: novas inscricoes voltam a funcionar normalmente,
// mas o que foi cancelado pela pausa fica cancelado.
export async function updateFlowStatus(
  storeId: string,
  flowId: string,
  status: Flow["status"],
): Promise<Flow> {
  if (!FLOW_STATUSES.includes(status)) throw new Error("status_invalido");
  const ref = col(storeId, "flows").doc(flowId);
  const now = Date.now();

  const flow = await db.runTransaction(async (tx) => {
    const [store, doc] = await Promise.all([tx.get(storeRef(storeId)), tx.get(ref)]);
    if (!isStoreCommerciallyActive(store.data()?.status)) throw new Error("store_inactive");
    if (!doc.exists) throw new Error("fluxo_nao_encontrado");
    const existing = doc.data() as Flow;
    if (existing.deletedAt) throw new Error("fluxo_nao_encontrado");
    const updated: Flow = { ...existing, status };
    tx.set(ref, updated);
    return updated;
  });

  if (status === "paused") {
    await cancelPendingJobsOfFlow(storeId, flowId, "flow_paused", now);
  }

  return flow;
}

// Soft delete: marca deletedAt, preservando documento/stats/historico para
// auditoria/suporte. Nao usa "status" para representar exclusao. Cancela
// tambem os jobs pendentes desse fluxo.
export async function softDeleteFlow(storeId: string, flowId: string): Promise<void> {
  const ref = col(storeId, "flows").doc(flowId);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const [store, doc] = await Promise.all([tx.get(storeRef(storeId)), tx.get(ref)]);
    if (!isStoreCommerciallyActive(store.data()?.status)) throw new Error("store_inactive");
    if (!doc.exists) throw new Error("fluxo_nao_encontrado");
    const existing = doc.data() as Flow;
    if (existing.deletedAt) return; // idempotente
    tx.set(ref, { ...existing, deletedAt: now });
  });

  await cancelPendingJobsOfFlow(storeId, flowId, "flow_deleted", now);
}

export async function saveFlow(
  storeId: string,
  input: {
    flowId?: string;
    name: string;
    status: Flow["status"];
    trigger: Trigger;
    steps: Step[];
  },
): Promise<Flow> {
  const ref = input.flowId
    ? col(storeId, "flows").doc(input.flowId)
    : col(storeId, "flows").doc();

  return db.runTransaction(async (tx) => {
    const [store, existingDoc] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(ref),
    ]);
    if (!isStoreCommerciallyActive(store.data()?.status)) {
      throw new Error("store_inactive");
    }
    const existing = existingDoc.data();
    const flow: Flow = {
      flowId: ref.id,
      name: input.name,
      status: input.status,
      trigger: input.trigger,
      steps: input.steps,
      stats: (existing?.stats as Flow["stats"]) ?? { enrolled: 0, sent: 0, failed: 0 },
      createdAt: (existing?.createdAt as number) ?? Date.now(),
    };
    tx.set(ref, flow);
    return flow;
  });
}
