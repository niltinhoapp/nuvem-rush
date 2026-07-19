// Avalia os flows ativos da loja contra um pedido ja sincronizado,
// cria enrollments e agenda os jobs (coletados pelo cron da Vercel).
import { col, storeRef } from "@/lib/firebase/admin";
import { buildContext, matches } from "@/lib/rules/evaluate";
import { delayToMs } from "@/lib/time";
import { syncOrder } from "@/lib/nuvemshop/sync";
import type { Cart, Contact, Flow, Order, Store } from "@/types";

// Cria o enrollment e agenda os jobs de um flow que casou.
// `origin` liga o enrollment ao pedido ou ao carrinho de origem.
async function createEnrollmentWithJobs(
  storeId: string,
  flow: Flow,
  contactId: string,
  origin: { orderId?: string; cartId?: string },
  flowDocRef: FirebaseFirestore.DocumentReference,
): Promise<void> {
  const enrollRef = col(storeId, "enrollments").doc();
  await enrollRef.set({
    enrollmentId: enrollRef.id,
    flowId: flow.flowId,
    contactId,
    ...origin,
    currentStep: 0,
    status: "active",
    startedAt: Date.now(),
  });

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i]!;
    const jobRef = col(storeId, "jobs").doc();
    await jobRef.set({
      jobId: jobRef.id,
      storeId,
      enrollmentId: enrollRef.id,
      flowId: flow.flowId,
      stepIndex: i,
      channel: step.action,
      runAt: Date.now() + delayToMs(step.delay),
      status: "scheduled",
    });
  }

  await flowDocRef.update({ "stats.enrolled": (flow.stats?.enrolled ?? 0) + 1 });
}

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
    await createEnrollmentWithJobs(storeId, flow, contact.contactId, { orderId: order.orderId }, doc.ref);
  }
}

// Inscreve um carrinho abandonado nos flows com gatilho "cart_abandoned".
// Chamado pelo cron de carrinhos (nao ha webhook de carrinho na Nuvemshop).
export async function enrollCartInFlows(
  storeId: string,
  cart: Cart,
  contact: Contact,
): Promise<void> {
  if (contact.optOut) return;

  const flowsSnap = await col(storeId, "flows")
    .where("status", "==", "active")
    .where("trigger.event", "==", "cart_abandoned")
    .get();
  if (flowsSnap.empty) return;

  const ctx = buildContext(cart, contact);

  for (const doc of flowsSnap.docs) {
    const flow = doc.data() as Flow;
    if (!matches(flow.trigger, ctx)) continue;
    await createEnrollmentWithJobs(storeId, flow, contact.contactId, { cartId: cart.cartId }, doc.ref);
  }
}
