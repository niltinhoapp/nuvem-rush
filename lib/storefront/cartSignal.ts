// Validação do sinal de carrinho (PURO/testável). Sinal = UNTRUSTED.
import { z } from "zod";

// Sinal MÍNIMO, sem PII. `.strict()` rejeita campos extras. storeId/storeDomain/
// clientAt são derivados do NubeSDK State no worker, mas continuam UNTRUSTED no
// backend: a autoridade é a Origin (validada contra os domínios da loja) + a API
// oficial. O backend usa relógio próprio.
export const cartSignalSchema = z
  .object({
    storeId: z.string().min(1).max(64),
    cartId: z.string().min(1).max(256),
    phase: z.enum(["ACTIVITY", "CHECKOUT_STARTED", "COMPLETED"]),
    storeDomain: z.string().min(1).max(255).optional(),
    clientAt: z.number().int().positive().optional(),
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
