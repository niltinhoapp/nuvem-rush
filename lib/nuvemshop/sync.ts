// Sincroniza pedidos e contatos da API Nuvemshop para o Firestore.
// Enriquece cada item do pedido com categoria/marca (buscadas do produto, com cache).
import { col } from "@/lib/firebase/admin";
import { NuvemshopClient } from "./client";
import type { LocalizedString, NsOrder, NsProduct, NsTrackingInfo } from "./types";
import type { Contact, Order, OrderItem, Product } from "@/types";

function loc(value: LocalizedString | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.pt ?? Object.values(value)[0] ?? "";
}

const num = (v: string | number | undefined): number => Number(v ?? 0) || 0;

// Busca metadados do produto (categoria/marca), com cache em stores/{id}/products.
async function getProductMeta(
  storeId: string,
  client: NuvemshopClient,
  productId: string | null,
): Promise<{ categoryIds: string[]; brand: string | null }> {
  if (!productId) return { categoryIds: [], brand: null };

  const ref = col(storeId, "products").doc(productId);
  const cached = await ref.get();
  if (cached.exists) {
    const p = cached.data() as Product;
    return { categoryIds: p.categoryIds, brand: p.brand };
  }

  // Nao cacheado: busca na API e persiste.
  let prod: NsProduct;
  try {
    prod = await client.getProduct(productId);
  } catch {
    return { categoryIds: [], brand: null };
  }
  const categoryIds = (prod.categories ?? []).map((c) => String(c.id));
  const brand = prod.brand ?? null;

  const product: Product = {
    productId,
    sku: null,
    name: loc(prod.name),
    brand,
    categoryIds,
    price: 0,
  };
  await ref.set(product, { merge: true });
  return { categoryIds, brand };
}

// Upsert do contato a partir dos dados do pedido. Mantem contadores agregados.
async function upsertContact(storeId: string, order: NsOrder): Promise<Contact> {
  const nsCustomerId = order.customer?.id ? String(order.customer.id) : null;
  const email = order.customer?.email ?? order.contact_email ?? null;
  // Chave estavel: id do cliente, senao o e-mail.
  const contactId = nsCustomerId ?? (email ? `email:${email}` : `order:${order.id}`);
  const ref = col(storeId, "contacts").doc(contactId);

  const prev = await ref.get();
  const prevData = prev.data() as Contact | undefined;

  const contact: Contact = {
    contactId,
    nsCustomerId,
    name: order.customer?.name ?? order.contact_name ?? prevData?.name ?? null,
    email,
    phone: order.customer?.phone ?? order.contact_phone ?? null,
    tags: prevData?.tags ?? [],
    ordersCount: (prevData?.ordersCount ?? 0) + 1,
    totalSpent: (prevData?.totalSpent ?? 0) + num(order.total),
    optOut: prevData?.optOut ?? false,
    lastOrderAt: Date.now(),
  };
  await ref.set(contact, { merge: true });
  return contact;
}

export type OrderEvent = "created" | "paid" | "fulfilled" | "cancelled";

// Limpa o codigo de rastreio digitado pelo lojista: remove rotulos comuns
// ("codigo:", "rastreio:"), espacos e caracteres soltos nas pontas.
function cleanTrackingCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^\s*(c[oó]digo|rastreio|rastreamento|tracking)?\s*:?\s*/i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

// Extrai o codigo/URL de rastreio do pedido cru (campo direto ou fulfillments).
function extractTracking(raw: NsOrder): {
  code: string | null;
  url: string | null;
  shippingStatus: string | null;
} {
  // Modelo novo (Nuvem Envio): rastreio no aggregate fulfillment_orders.
  const fo = (raw.fulfillment_orders ?? []).find((f) => f.tracking_info?.code || f.tracking_info?.url);
  // Modelo antigo: objeto inline em fulfillments.
  const inline = (raw.fulfillments ?? []).find(
    (f): f is { tracking_info: NsTrackingInfo } =>
      typeof f === "object" && f !== null && "tracking_info" in f &&
      Boolean((f as { tracking_info?: NsTrackingInfo }).tracking_info?.code ||
        (f as { tracking_info?: NsTrackingInfo }).tracking_info?.url),
  );

  const rawCode =
    raw.shipping_tracking_number ?? fo?.tracking_info?.code ?? inline?.tracking_info?.code ?? null;
  const url =
    raw.shipping_tracking_url ?? fo?.tracking_info?.url ?? inline?.tracking_info?.url ?? null;
  return { code: cleanTrackingCode(rawCode), url: url ?? null, shippingStatus: raw.shipping_status ?? null };
}

// Sincroniza um pedido completo: contato + itens enriquecidos + pedido + rastreio.
export async function syncOrder(
  storeId: string,
  accessToken: string,
  nsOrderId: string,
  event: OrderEvent = "paid",
): Promise<{ order: Order; contact: Contact }> {
  const client = new NuvemshopClient(storeId, accessToken);
  const raw = await client.getOrder(nsOrderId);

  const contact = await upsertContact(storeId, raw);

  const items: OrderItem[] = [];
  for (const p of raw.products ?? []) {
    const productId = p.product_id ? String(p.product_id) : null;
    const meta = await getProductMeta(storeId, client, productId);
    items.push({
      sku: p.sku ?? null,
      productId,
      categoryIds: meta.categoryIds,
      brand: meta.brand,
      qty: num(p.quantity),
      price: num(p.price),
    });
  }

  const status: Order["status"] = event === "cancelled" ? "cancelled" : event === "created" ? "open" : "paid";
  const tracking = extractTracking(raw);

  const orderRef = col(storeId, "orders").doc(String(raw.id));
  // Escrita com merge: so grava timestamps do evento atual (nao zera os demais).
  const order: Order = {
    orderId: orderRef.id,
    nsOrderId: String(raw.id),
    contactId: contact.contactId,
    total: num(raw.total),
    items,
    status,
    shippingStatus: tracking.shippingStatus,
    trackingCode: tracking.code,
    trackingUrl: tracking.url,
    ...(event === "paid" ? { paidAt: Date.now() } : {}),
    ...(event === "fulfilled" ? { fulfilledAt: Date.now() } : {}),
  };
  await orderRef.set(order, { merge: true });

  return { order, contact };
}
