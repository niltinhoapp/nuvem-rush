// Canal comercial WhatsApp: apenas o catálogo fechado e aprovado pela Meta
// pode alcançar o provider. Não há texto livre, IA ou template arbitrário.
import { col, storeRef } from "@/lib/firebase/admin";
import {
  buildCatalogTemplateParameters,
  resolveCommercialTemplateKey,
} from "@/lib/whatsapp/templateRouting";
import { normalizeWhatsappPhone, sendApprovedCatalogTemplate } from "@/lib/whatsapp/templateProvider";
import type { Cart, Flow, Order, Step, Store, StoreWhatsapp } from "@/types";

const GRAPH_VERSION = "v22.0";

interface WaCredentials {
  phoneNumberId: string;
  accessToken: string;
  whatsapp: StoreWhatsapp;
}

async function resolveCredentials(storeId: string): Promise<WaCredentials> {
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  const whatsapp = store?.whatsapp;
  if (whatsapp?.status === "connected" && whatsapp.phoneNumberId && whatsapp.accessToken) {
    return { phoneNumberId: whatsapp.phoneNumberId, accessToken: whatsapp.accessToken, whatsapp };
  }
  throw new Error("WhatsApp nao conectado nesta loja. Conecte a conta oficial da Meta para ativar este canal.");
}

export async function sendWhatsapp(params: { storeId: string; enrollmentId: string; step: Step }): Promise<void> {
  const { storeId, enrollmentId, step } = params;
  const creds = await resolveCredentials(storeId);
  const enroll = (await col(storeId, "enrollments").doc(enrollmentId).get()).data()!;
  const flow = (await col(storeId, "flows").doc(enroll.flowId).get()).data() as Flow | undefined;
  if (!flow) throw new Error("fluxo nao encontrado");
  const key = resolveCommercialTemplateKey(flow.trigger.event, step.config);

  const contact = (await col(storeId, "contacts").doc(enroll.contactId).get()).data()!;
  if (!contact.phone) throw new Error("contato sem telefone");
  const order = enroll.orderId ? (await col(storeId, "orders").doc(enroll.orderId).get()).data() as Order | undefined : undefined;
  const cart = enroll.cartId ? (await col(storeId, "carts").doc(enroll.cartId).get()).data() as Cart | undefined : undefined;
  const bodyParams = buildCatalogTemplateParameters(key, {
    name: contact.name,
    recoveryUrl: cart?.recoveryUrl,
    orderNumber: order?.nsOrderId,
    trackingUrl: order?.trackingUrl,
  });
  await sendApprovedCatalogTemplate({
    whatsapp: creds.whatsapp,
    key,
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    to: contact.phone,
    bodyParams,
  });
}

// O teste é isolado do envio comercial e usa o template oficial hello_world.
export async function sendTestWhatsapp(params: { storeId: string; to: string }): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_TEST_PHONE_NUMBER_ID ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) throw new Error("credenciais globais de WhatsApp (teste) nao configuradas");
  void params.storeId;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: normalizeWhatsappPhone(params.to), type: "template", template: { name: "hello_world", language: { code: "en_US" } } }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
}
