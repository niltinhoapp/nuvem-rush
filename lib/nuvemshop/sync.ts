// Sincroniza pedidos e contatos da API Nuvemshop para o Firestore.
// Enriquece cada item do pedido com categoria/marca (buscadas do produto, com cache).
import { col } from "@/lib/firebase/admin";
import { NuvemshopClient } from "./client";
import type { LocalizedString, NsOrder, NsProduct } from "./types";
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

// Sincroniza um pedido completo: contato + itens enriquecidos + pedido.
export async function syncOrder(
  storeId: string,
  accessToken: string,
  nsOrderId: string,
  status: Order["status"] = "paid",
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

  const orderRef = col(storeId, "orders").doc(String(raw.id));
  const order: Order = {
    orderId: orderRef.id,
    nsOrderId: String(raw.id),
    contactId: contact.contactId,
    total: num(raw.total),
    items,
    status,
    paidAt: status === "paid" ? Date.now() : null,
  };
  await orderRef.set(order, { merge: true });

  return { order, contact };
}
