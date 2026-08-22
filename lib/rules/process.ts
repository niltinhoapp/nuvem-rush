// Avalia os flows ativos da loja contra um pedido ja sincronizado,
// cria enrollments e agenda os jobs (coletados pelo cron da Vercel).
import { FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { buildContext, matches } from "@/lib/rules/evaluate";
import { delayToMs } from "@/lib/time";
import { syncOrder } from "@/lib/nuvemshop/sync";
import { enrollmentKey, jobKey, planEnrollment } from "@/lib/rules/enrollmentKey";
import type { Cart, Contact, Flow, Order, Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

// Cria o enrollment e agenda os jobs de um flow que casou — IDEMPOTENTE.
// `origin` liga o enrollment ao pedido ou ao carrinho de origem. A identidade é
// DETERMINÍSTICA (storeId+originId+flowId), então:
// - retry após crash reencontra os efeitos e completa só os AUSENTES (PARTIAL);
// - dois workers convergem para o MESMO enrollment/jobs (exactly-once lógico);
// - a operação por flow é ATÔMICA (transação: enrollment + jobs juntos).
// Retorna true se um enrollment NOVO foi criado (para métricas/dedup).
async function createEnrollmentWithJobs(
  storeId: string,
  flow: Flow,
  contactId: string,
  origin: { orderId?: string; cartId?: string },
  flowDocRef: FirebaseFirestore.DocumentReference,
): Promise<boolean> {
  const originId = origin.orderId ?? origin.cartId;
  if (!originId) return false; // sem origem estável: não há como ser idempotente

  const enrollmentId = enrollmentKey(storeId, originId, flow.flowId);
  const enrollRef = col(storeId, "enrollments").doc(enrollmentId);
  const jobRefs = flow.steps.map((_, i) => col(storeId, "jobs").doc(jobKey(enrollmentId, i)));

  return db.runTransaction(async (tx) => {
    // Leituras antes das escritas (regra do Firestore).
    const storeSnap = await tx.get(storeRef(storeId));
    const enrollSnap = await tx.get(enrollRef);
    const jobSnaps = await Promise.all(jobRefs.map((r) => tx.get(r)));

    if (!isStoreCommerciallyActive(storeSnap.data()?.status)) return false;

    const plan = planEnrollment(enrollSnap.exists, jobSnaps.map((s) => s.exists));

    if (plan.createEnrollment) {
      tx.set(enrollRef, {
        enrollmentId,
        flowId: flow.flowId,
        contactId,
        ...origin,
        currentStep: 0,
        status: "active",
        startedAt: Date.now(),
      });
    }

    for (const i of plan.jobsToCreate) {
      const step = flow.steps[i]!;
      tx.set(jobRefs[i]!, {
        jobId: jobKey(enrollmentId, i),
        storeId,
        enrollmentId,
        flowId: flow.flowId,
        stepIndex: i,
        channel: step.action,
        runAt: Date.now() + delayToMs(step.delay),
        status: "scheduled",
      });
    }

    // Métrica só quando o enrollment é NOVO (não conta retries).
    if (plan.createEnrollment) {
      tx.update(flowDocRef, { "stats.enrolled": FieldValue.increment(1) });
    }
    return plan.createEnrollment;
  });
}

// Ponto de entrada do webhook: sincroniza o pedido e roda o motor.
export type OrderWebhookEvent = "order/paid" | "order/created" | "order/fulfilled" | "order/cancelled";
export type OrderHandlingResult = "processed" | "inactive";

const EVENT_MAP: Record<OrderWebhookEvent, "paid" | "created" | "fulfilled" | "cancelled"> = {
  "order/paid": "paid",
  "order/created": "created",
  "order/fulfilled": "fulfilled",
  "order/cancelled": "cancelled",
};

export async function handleOrderEvent(
  storeId: string,
  nsOrderId: string,
  event: OrderWebhookEvent,
): Promise<OrderHandlingResult> {
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active") return "inactive";

  const { order, contact } = await syncOrder(storeId, store.accessToken, nsOrderId, EVENT_MAP[event]);

  // Pedido cancelado -> nao ha "trigger" a avaliar, so cancela o que ja
  // estava agendado para esse pedido (ex.: rastreio, cupom de recompra).
  if (event === "order/cancelled") {
    await cancelOrderCommercialWork(storeId, order.orderId);
    return "processed";
  }

  // Cliente finalizou a compra -> cancela fluxos de recuperacao de carrinho
  // pendentes desse contato (nao faz sentido "voce esqueceu o carrinho").
  if (event === "order/created" || event === "order/paid") {
    await cancelCartRecovery(storeId, contact);
  }

  await enrollInFlows(storeId, order, contact, event);
  return "processed";
}

// Cancela enrollments (e jobs agendados) vinculados a um pedido que foi
// cancelado na Nuvemshop — evita mandar rastreio/recompra de venda desfeita.
export async function cancelOrderCommercialWork(
  storeId: string,
  orderId: string,
  now = Date.now(),
): Promise<{ inactive: boolean; enrollmentsCancelled: number; jobsCancelled: number }> {
  const store = await storeRef(storeId).get();
  if (!isStoreCommerciallyActive(store.data()?.status)) {
    return { inactive: true, enrollmentsCancelled: 0, jobsCancelled: 0 };
  }

  const snap = await col(storeId, "enrollments")
    .where("orderId", "==", orderId)
    .where("status", "==", "active")
    .get();

  let enrollmentsCancelled = 0;
  let jobsCancelled = 0;
  for (const doc of snap.docs) {
    const cancelled = await db.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (
        !current.exists
        || current.data()?.status !== "active"
        || current.data()?.orderId !== orderId
      ) return false;
      tx.update(doc.ref, {
        status: "cancelled",
        cancelledAt: now,
        cancelReason: "order_cancelled",
      });
      return true;
    });
    if (!cancelled) continue;
    enrollmentsCancelled++;

    for (const status of ["scheduled", "processing"] as const) {
      const jobs = await col(storeId, "jobs")
        .where("enrollmentId", "==", doc.id)
        .where("status", "==", status)
        .get();
      for (const job of jobs.docs) {
        const jobCancelled = await db.runTransaction(async (tx) => {
          const current = await tx.get(job.ref);
          if (!current.exists || current.data()?.status !== status) return false;
          tx.update(job.ref, {
            status: "cancelled",
            cancelledAt: now,
            cancelReason: "order_cancelled",
          });
          return true;
        });
        if (jobCancelled) jobsCancelled++;
      }
    }
  }
  return { inactive: false, enrollmentsCancelled, jobsCancelled };
}

// Cancela enrollments de recuperacao de carrinho (e seus jobs agendados) do
// contato que acabou de comprar. Casa por contactId + email + telefone, pois
// o contato do pedido e do carrinho podem ter chaves diferentes.
async function cancelCartRecovery(storeId: string, contact: Contact): Promise<void> {
  const candidates = new Set<string>([contact.contactId]);
  if (contact.email) candidates.add(`email:${contact.email}`);
  if (contact.phone) candidates.add(`phone:${contact.phone}`);

  for (const cid of candidates) {
    const snap = await col(storeId, "enrollments")
      .where("contactId", "==", cid)
      .where("status", "==", "active")
      .get();

    for (const doc of snap.docs) {
      const enr = doc.data() as { enrollmentId: string; cartId?: string };
      if (!enr.cartId) continue; // so cancela recuperacao de carrinho

      await doc.ref.update({ status: "cancelled" });

      const jobs = await col(storeId, "jobs")
        .where("enrollmentId", "==", enr.enrollmentId)
        .where("status", "==", "scheduled")
        .get();
      for (const j of jobs.docs) await j.ref.update({ status: "cancelled" });

      await col(storeId, "carts").doc(enr.cartId).set({ status: "recovered" }, { merge: true });
    }
  }
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
// Retorna o número de enrollments NOVOS criados (idempotente: retries e
// caminhos concorrentes convergem, então re-execuções retornam 0).
export async function enrollCartInFlows(
  storeId: string,
  cart: Cart,
  contact: Contact,
): Promise<number> {
  if (contact.optOut) return 0;

  const flowsSnap = await col(storeId, "flows")
    .where("status", "==", "active")
    .where("trigger.event", "==", "cart_abandoned")
    .get();
  if (flowsSnap.empty) return 0;

  const ctx = buildContext(cart, contact);

  let created = 0;
  for (const doc of flowsSnap.docs) {
    const flow = doc.data() as Flow;
    if (!matches(flow.trigger, ctx)) continue;
    const isNew = await createEnrollmentWithJobs(storeId, flow, contact.contactId, { cartId: cart.cartId }, doc.ref);
    if (isNew) created++;
  }
  return created;
}
