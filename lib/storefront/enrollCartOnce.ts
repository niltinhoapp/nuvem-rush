// Inscreve um carrinho em fluxos NO MÁXIMO UMA VEZ, independentemente da origem
// (sinal NubeSDK ou polling GET /checkouts). REUTILIZA o claim atômico de
// idempotência do P0 (lib/webhooks/idempotency.firestore) — não recria dedup.
import { firestoreEventClaim } from "@/lib/webhooks/idempotency.firestore";
import { enrollCartInFlows } from "@/lib/rules/process";
import { cartEnrollKey } from "@/lib/storefront/cartSignal";
import type { Cart, Contact } from "@/types";

// Retorna true se ESTA chamada realizou a inscrição; false se outra fonte já
// havia inscrito o mesmo carrinho (dedup). O claim é atômico (.create()).
export async function enrollCartOnce(
  storeId: string,
  cart: Cart,
  contact: Contact,
): Promise<boolean> {
  const claimed = await firestoreEventClaim.claim(storeId, cartEnrollKey(cart.cartId));
  if (!claimed) return false;
  await enrollCartInFlows(storeId, cart, contact);
  return true;
}
