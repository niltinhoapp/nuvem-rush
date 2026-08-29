// Identidade de carrinho segura para path do Firestore (bloqueador 4).
// cartId pode conter caracteres incompatíveis com doc id ("/", ":" etc.).
// Usamos SHA-256(cartId) em hex — injetivo na prática (resistente a colisão) —
// como doc id, e guardamos o cartId ORIGINAL no documento.
import { createHash } from "node:crypto";

export function cartKeyHash(cartId: string): string {
  return createHash("sha256").update(cartId, "utf8").digest("hex");
}
