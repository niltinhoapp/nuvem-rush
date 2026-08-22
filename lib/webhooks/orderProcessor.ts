import { cancelOrderCommercialWork, handleOrderEvent } from "@/lib/rules/process";
import type { OrderWebhookProcessor } from "./worker";

export const firestoreOrderWebhookProcessor: OrderWebhookProcessor = {
  async process(candidate) {
    if (candidate.envelope.event === "order/cancelled") {
      // Prioridade: cancela enrollment/jobs usando apenas a identidade assinada
      // do envelope. Nao aguarda GET /orders nem enriquecimento de produtos.
      const result = await cancelOrderCommercialWork(
        candidate.storeId,
        candidate.envelope.resourceId,
      );
      return result.inactive ? "discarded" : "completed";
    }

    const result = await handleOrderEvent(
      candidate.storeId,
      candidate.envelope.resourceId,
      candidate.envelope.event,
    );
    return result === "inactive" ? "discarded" : "completed";
  },
};
