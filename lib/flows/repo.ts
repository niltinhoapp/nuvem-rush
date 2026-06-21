// Persistencia de Flows no Firestore (servidor).
import { col } from "@/lib/firebase/admin";
import type { Flow, Step, Trigger } from "@/types";

export async function listFlows(storeId: string): Promise<Flow[]> {
  const snap = await col(storeId, "flows").orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => d.data() as Flow);
}

export async function getFlow(storeId: string, flowId: string): Promise<Flow | null> {
  const doc = await col(storeId, "flows").doc(flowId).get();
  return doc.exists ? (doc.data() as Flow) : null;
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

  const existing = input.flowId ? (await ref.get()).data() : undefined;

  const flow: Flow = {
    flowId: ref.id,
    name: input.name,
    status: input.status,
    trigger: input.trigger,
    steps: input.steps,
    stats: (existing?.stats as Flow["stats"]) ?? { enrolled: 0, sent: 0, failed: 0 },
    createdAt: (existing?.createdAt as number) ?? Date.now(),
  };

  await ref.set(flow);
  return flow;
}
