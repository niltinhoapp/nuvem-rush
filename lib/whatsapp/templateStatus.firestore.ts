import { db } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  canApplyTemplateStatusUpdate,
  type MetaTemplateStatusUpdate,
} from "./templateStatus";
import type { Store } from "@/types";

export type TemplateStatusUpdateResult =
  | "updated"
  | "ignored_missing_or_ambiguous_waba"
  | "ignored_store_or_template_mismatch";

// Repositório de produção para o evento message_template_status_update. A
// seleção por WABA é fail-closed: zero ou mais de uma store não gera mutação.
export async function updateTemplateStatus(
  update: MetaTemplateStatusUpdate,
): Promise<TemplateStatusUpdateResult> {
  const candidates = await db
    .collection("stores")
    .where("whatsapp.wabaId", "==", update.wabaId)
    .limit(2)
    .get();
  if (candidates.size !== 1) return "ignored_missing_or_ambiguous_waba";

  const ref = candidates.docs[0]!.ref;
  return db.runTransaction(async (tx) => {
    const storeSnap = await tx.get(ref);
    const store = storeSnap.data() as Store | undefined;
    const whatsapp = store?.whatsapp;
    if (!store || !canApplyTemplateStatusUpdate({
      storeActive: isStoreCommerciallyActive(store.status),
      whatsapp,
      wabaId: update.wabaId,
      name: update.name,
      language: update.language,
      receivedAt: update.receivedAt,
    })) return "ignored_store_or_template_mismatch";

    tx.update(ref, {
      "whatsapp.templateStatus": update.status,
      "whatsapp.templateStatusUpdatedAt": update.receivedAt,
    });
    return "updated";
  });
}
