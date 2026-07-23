// Acao "Acionar webhook": envia um POST com os dados do contato/pedido/carrinho
// para uma URL configurada no step. Util para integrar com outras ferramentas
// do lojista (planilhas, CRMs, Zapier/Make etc.).
import { col } from "@/lib/firebase/admin";
import type { Cart, Order, Step } from "@/types";

export async function triggerWebhook(params: {
  storeId: string;
  enrollmentId: string;
  step: Step;
}): Promise<void> {
  const { storeId, enrollmentId, step } = params;
  const url = (step.config as { webhookUrl?: string } | undefined)?.webhookUrl?.trim();
  if (!url) throw new Error("step sem webhookUrl configurada");

  const enroll = (await col(storeId, "enrollments").doc(enrollmentId).get()).data()!;
  const contact = (await col(storeId, "contacts").doc(enroll.contactId).get()).data();

  const order = enroll.orderId
    ? (await col(storeId, "orders").doc(enroll.orderId).get()).data() as Order | undefined
    : undefined;
  const cart = enroll.cartId
    ? (await col(storeId, "carts").doc(enroll.cartId).get()).data() as Cart | undefined
    : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storeId,
      contact: contact ? { name: contact.name, email: contact.email, phone: contact.phone } : null,
      order: order ? { orderId: order.orderId, total: order.total, status: order.status } : null,
      cart: cart ? { cartId: cart.cartId, total: cart.total, recoveryUrl: cart.recoveryUrl } : null,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook respondeu ${res.status}`);
}
