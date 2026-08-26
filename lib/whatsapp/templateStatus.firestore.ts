import { db } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  catalogTemplateKeyForStoredIdentity,
  canApplyTemplateStatusUpdate,
  storedCatalogTemplate,
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
    const key = catalogTemplateKeyForStoredIdentity(whatsapp, update.name, update.language);
    const template = key ? storedCatalogTemplate(whatsapp, key) : undefined;
    if (!store || !canApplyTemplateStatusUpdate({
      storeActive: isStoreCommerciallyActive(store.status),
      template,
      receivedAt: update.receivedAt,
    })) return "ignored_store_or_template_mismatch";

    if (whatsapp?.wabaId !== update.wabaId || !key) return "ignored_store_or_template_mismatch";
    if (!whatsapp.templates && key === "pos_venda_agradecimento") {
      tx.update(ref, {
        "whatsapp.templateStatus": update.status,
        "whatsapp.templateStatusUpdatedAt": update.receivedAt,
      });
    } else {
      tx.update(ref, {
        [`whatsapp.templates.${key}.status`]: update.status,
        [`whatsapp.templates.${key}.statusUpdatedAt`]: update.receivedAt,
      });
    }
    return "updated";
  });
}
