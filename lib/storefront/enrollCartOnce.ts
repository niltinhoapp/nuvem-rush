// Inscrição de carrinho NO MÁXIMO UMA VEZ (sinal NubeSDK ou polling), com claim
// RECUPERÁVEL por lease + fencing (bloqueador 2). Não usa mais create/delete
// frágil; o estado vive em stores/{storeId}/cart_enrollments/{hash(cartId)}:
//   (ausente) -> enrolling{leaseId,leaseAt} -> enrolled (terminal).
import { randomUUID } from "node:crypto";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { enrollCartInFlows } from "@/lib/rules/process";
import { cartKeyHash } from "@/lib/storefront/cartKey";
import { canClaimEnroll, canFinalizeEnroll, type EnrollDoc } from "@/lib/storefront/enrollLease";
import type { Cart, Contact } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

// Retorna true se ESTA chamada inscreveu; false se já estava enrolled ou outro
// worker detém o lease vigente. Se enrollCartInFlows lançar, o lease "enrolling"
// permanece e EXPIRA -> um poll/cron futuro retoma (retry), sem dedup permanente.
export async function enrollCartOnce(storeId: string, cart: Cart, contact: Contact): Promise<boolean> {
  const ref = col(storeId, "cart_enrollments").doc(cartKeyHash(cart.cartId));
  const leaseId = randomUUID();
  const now = Date.now();

  // 1) Reivindica o lease atomicamente (fencing por leaseId).
  const claimed = await db.runTransaction(async (tx) => {
    const [store, s] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(ref),
    ]);
    if (!isStoreCommerciallyActive(store.data()?.status)) return false;
    const d = s.exists ? (s.data() as EnrollDoc) : null;
    if (!canClaimEnroll(d, now)) return false; // enrolled OU lease vigente de outro
    tx.set(ref, { status: "enrolling", leaseId, leaseAt: now, cartId: cart.cartId }, { merge: true });
    return true;
  });
  if (!claimed) return false;

  // 2) Inscreve. A idempotência REAL vive no efeito persistido (enrollment/jobs
  //    com id determinístico) — o lease é só otimização de concorrência. Se
  //    falhar, propaga: o lease fica "enrolling" e expira -> retry futuro.
  const created = await enrollCartInFlows(storeId, cart, contact);

  // 3) Finaliza (enrolling -> enrolled) SÓ se ainda detemos o lease (fencing).
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? (s.data() as EnrollDoc) : null;
    if (canFinalizeEnroll(d, leaseId)) {
      tx.set(ref, { status: "enrolled" }, { merge: true });
    }
  });
  return created > 0; // true = inscreveu algo novo; false = já estava inscrito
}
