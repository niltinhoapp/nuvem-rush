// Núcleo PURO do enrollCartOnce (sem import de firebase-admin, para teste).
// Bloqueador 6: o claim não pode bloquear para sempre após falha.
import type { EventClaim } from "@/lib/webhooks/idempotency";

// Recebe o claim e a função de inscrição por injeção. Retorna true se ESTA
// chamada inscreveu; false se outra já havia reivindicado. Em falha da
// inscrição, LIBERA o claim (permite retry/polling futuro) e relança.
export async function enrollGuarded(
  claim: EventClaim,
  storeId: string,
  key: string,
  enroll: () => Promise<void>,
): Promise<boolean> {
  const acquired = await claim.claim(storeId, key);
  if (!acquired) return false;
  try {
    await enroll();
    return true; // sucesso -> claim permanece (terminal)
  } catch (err) {
    await claim.release(storeId, key); // falha -> libera
    throw err;
  }
}
