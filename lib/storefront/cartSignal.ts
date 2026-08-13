// Validação e chaves do sinal de carrinho (PURO/testável). O sinal chega do
// Web Worker do storefront e é tratado como UNTRUSTED INPUT.
import { z } from "zod";
import { eventKey } from "@/lib/webhooks/idempotency";

// Sinal MÍNIMO (LGPD): sem e-mail/telefone/nome/endereço. `.strict()` rejeita
// campos extras (não aceitar PII "clandestina" nem lixo).
export const cartSignalSchema = z
  .object({
    storeId: z.string().min(1).max(64),
    cartId: z.string().min(1).max(128),
    phase: z.enum(["CHECKOUT_STARTED", "COMPLETED"]),
    at: z.number().int().positive(),
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

// Chave de deduplicação de INSCRIÇÃO por carrinho — compartilhada entre o sinal
// do NubeSDK e o polling, reutilizando o padrão de idempotência atômica do P0.
export function cartEnrollKey(cartId: string): string {
  return eventKey("cart_enroll", cartId);
}
