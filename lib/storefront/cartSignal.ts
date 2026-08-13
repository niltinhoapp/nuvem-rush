// Validação e chaves do sinal de carrinho (PURO/testável). Sinal = UNTRUSTED.
import { z } from "zod";
import { eventKey } from "@/lib/webhooks/idempotency";

// Sinal MÍNIMO. `.strict()` rejeita campos extras (não aceitar PII clandestina).
// storeId/clientAt são TELEMETRIA opcional — o backend usa relógio próprio e
// resolve a loja via API (nunca confia neles).
export const cartSignalSchema = z
  .object({
    cartId: z.string().min(1).max(128),
    phase: z.enum(["ACTIVITY", "CHECKOUT_STARTED", "COMPLETED"]),
    clientAt: z.number().int().positive().optional(),
    storeId: z.string().min(1).max(64).optional(),
  })
  .strict();

export type CartSignalInput = z.infer<typeof cartSignalSchema>;

export function parseCartSignal(
  body: unknown,
): { ok: true; data: CartSignalInput } | { ok: false; error: string } {
  const r = cartSignalSchema.safeParse(body);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
  };
}

// Chave de dedup de INSCRIÇÃO por carrinho — compartilhada entre sinal e polling,
// reutilizando o padrão de idempotência atômica do P0.
export function cartEnrollKey(cartId: string): string {
  return eventKey("cart_enroll", cartId);
}
