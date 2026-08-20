// Sincroniza carrinhos abandonados (Abandoned Checkout) da Nuvemshop.
// Nao ha webhook: e obtido por poll (GET /checkouts) via cron.
import { db, col, storeRef } from "@/lib/firebase/admin";
import type { NsCheckout } from "./types";
import type { Cart, Contact, OrderItem } from "@/types";
import { findSuppressedContactId } from "@/lib/lgpd/firestore";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

const num = (v: string | number | undefined | null): number => Number(v ?? 0) || 0;

// Upsert do contato a partir do checkout — SEM incrementar contadores de pedido
// (um carrinho abandonado nao e uma compra).
async function upsertCartContact(storeId: string, raw: NsCheckout): Promise<Contact> {
  const email = raw.contact_email ?? null;
  const phone = raw.contact_phone ?? null;
  const suppressedContactId = await findSuppressedContactId(storeId, { email, phone });
  const contactId = suppressedContactId
    ?? (email ? `email:${email}` : phone ? `phone:${phone}` : `checkout:${raw.id}`);
  const ref = col(storeId, "contacts").doc(contactId);

  return db.runTransaction(async (tx) => {
    const [store, previous] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(ref),
    ]);
    if (!isStoreCommerciallyActive(store.data()?.status)) {
      throw new Error("store_inactive");
    }
    const prev = previous.data() as Contact | undefined;
    const contact: Contact = {
      contactId,
      nsCustomerId: prev?.nsCustomerId ?? null,
      name: suppressedContactId ? null : (raw.contact_name ?? prev?.name ?? null),
      email: suppressedContactId ? null : (email ?? prev?.email ?? null),
      phone: suppressedContactId ? null : (phone ?? prev?.phone ?? null),
      tags: suppressedContactId ? [] : (prev?.tags ?? []),
      ordersCount: prev?.ordersCount ?? 0,
      totalSpent: prev?.totalSpent ?? 0,
      optOut: suppressedContactId ? true : (prev?.optOut ?? false),
      lastOrderAt: prev?.lastOrderAt ?? null,
    };
    tx.set(ref, contact, { merge: true });
    return contact;
  });
}

// Sincroniza um checkout abandonado: contato + carrinho normalizado.
export async function syncAbandonedCheckout(
  storeId: string,
  raw: NsCheckout,
): Promise<{ cart: Cart; contact: Contact }> {
  const contact = await upsertCartContact(storeId, raw);

  const items: OrderItem[] = (raw.products ?? []).map((p) => ({
    sku: p.sku ?? null,
    productId: p.product_id ? String(p.product_id) : null,
    categoryIds: [],
    brand: null,
    qty: num(p.quantity),
    price: num(p.price),
  }));

  const cartRef = col(storeId, "carts").doc(String(raw.id));
  const cart: Cart = {
    cartId: cartRef.id,
    nsCheckoutId: String(raw.id),
    contactId: contact.contactId,
    total: num(raw.total),
    items,
    recoveryUrl: raw.abandoned_checkout_url ?? null,
    createdAt: raw.created_at ? Date.parse(raw.created_at) : Date.now(),
    abandonedAt: Date.now(),
    status: "abandoned",
  };
  // Um titular suprimido nao pode ter recoveryUrl/checkout persistido novamente.
  if (!contact.optOut) {
    await db.runTransaction(async (tx) => {
      const store = await tx.get(storeRef(storeId));
      if (!isStoreCommerciallyActive(store.data()?.status)) {
        throw new Error("store_inactive");
      }
      tx.set(cartRef, cart, { merge: true });
    });
  }

  return { cart, contact };
}
