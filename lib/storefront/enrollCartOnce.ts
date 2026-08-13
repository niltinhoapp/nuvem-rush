// Inscrição de carrinho NO MÁXIMO UMA VEZ (sinal NubeSDK ou polling), reusando
// o claim atômico de idempotência do P0. A lógica de lease/liberação vive em
// enrollGuard.ts (puro/testável).
import { firestoreEventClaim } from "@/lib/webhooks/idempotency.firestore";
import { enrollCartInFlows } from "@/lib/rules/process";
import { cartEnrollKey } from "@/lib/storefront/cartSignal";
import { enrollGuarded } from "@/lib/storefront/enrollGuard";
import type { Cart, Contact } from "@/types";

export async function enrollCartOnce(storeId: string, cart: Cart, contact: Contact): Promise<boolean> {
  return enrollGuarded(firestoreEventClaim, storeId, cartEnrollKey(cart.cartId), () =>
    enrollCartInFlows(storeId, cart, contact),
  );
}
