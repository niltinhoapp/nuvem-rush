// Avalia os flows ativos da loja contra um pedido ja sincronizado,
// cria enrollments e agenda os jobs (coletados pelo cron da Vercel).
import { col, storeRef } from "@/lib/firebase/admin";
import { buildContext, matches } from "@/lib/rules/evaluate";
import { delayToMs } from "@/lib/time";
import { syncOrder } from "@/lib/nuvemshop/sync";
import type { Contact, Flow, Order, Store } from "@/types";

// Ponto de entrada do webhook: sincroniza o pedido e roda o motor.
type OrderWebhookEvent = "order/paid" | "order/created" | "order/fulfilled";

const EVENT_MAP: Record<OrderWebhookEvent, "paid" | "created" | "fulfilled"> = {
  "order/paid": "paid",
  "order/created": "created",
  "order/fulfilled": "fulfilled",
};

export async function handleOrderEvent(
  storeId: string,
  nsOrderId: string,
  event: OrderWebhookEvent,
): Promise<void> {
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active") return;

  const { order, contact } = await syncOrder(storeId, store.accessToken, nsOrderId, EVENT_MAP[event]);

  await enrollInFlows(storeId, order, contact, event);
}

// Avalia os flows e agenda os disparos.
async function enrollInFlows(
  storeId: string,
  order: Order,
  contact: Contact,
  event: OrderWebhookEvent,
): Promise<void> {
  if (contact.optOut) return;

  const triggerEvent =
    event === "order/paid" ? "order_paid"
    : event === "order/fulfilled" ? "order_fulfilled"
    : "order_created";
  const flowsSnap = await col(storeId, "flows")
    .where("status", "==", "active")
    .where("trigger.event", "==", triggerEvent)
    .get();

  const ctx = buildContext(order, contact);

  for (const doc of flowsSnap.docs) {
    const flow = doc.data() as Flow;
    if (!matches(flow.trigger, ctx)) continue;

    const enrollRef = col(storeId, "enrollments").doc();
    await enrollRef.set({
      enrollmentId: enrollRef.id,
      flowId: flow.flowId,
      contactId: contact.contactId,
      orderId: order.orderId,
      currentStep: 0,
      status: "active",
      startedAt: Date.now(),
    });

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i]!;
      const jobRef = col(storeId, "jobs").doc();
      const runAt = Date.now() + delayToMs(step.delay);

      // Agendamento via Vercel Cron: persistimos o job com runAt e o cron
      // (/api/cron/dispatch) o coleta quando vencer. Sem dependencia de GCP.
      await jobRef.set({
        jobId: jobRef.id,
        storeId,
        enrollmentId: enrollRef.id,
        flowId: flow.flowId,
        stepIndex: i,
        channel: step.action,
        runAt,
        status: "scheduled",
      });
    }

    await doc.ref.update({ "stats.enrolled": (flow.stats?.enrolled ?? 0) + 1 });
  }
}
