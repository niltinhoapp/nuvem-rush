import { db, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import { WHATSAPP_TEMPLATE_CATALOG_KEYS, type TemplateCatalogKey } from "./catalog";
import { mergeConfirmedCatalogTemplates } from "./connectMerge";
import type { CatalogTemplateProvision } from "./embedded";
import type { Store, WhatsappCatalogTemplate } from "@/types";

export async function persistWhatsappConnection(params: {
  storeId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  provision: CatalogTemplateProvision;
  now?: number;
}): Promise<Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>>> {
  return db.runTransaction(async (tx) => {
    const ref = storeRef(params.storeId);
    const current = await tx.get(ref);
    const store = current.data() as Store | undefined;
    if (!store || !isStoreCommerciallyActive(store.status)) throw new Error("store_inactive");
    const previous = store.whatsapp;
    const sameWaba = !previous?.wabaId || previous.wabaId === params.wabaId;
    const existingTemplates = sameWaba ? previous?.templates : undefined;
    const merged = mergeConfirmedCatalogTemplates({ existing: existingTemplates, provision: params.provision });
    const now = params.now ?? Date.now();
    const updates: Record<string, unknown> = {
      "whatsapp.wabaId": params.wabaId,
      "whatsapp.phoneNumberId": params.phoneNumberId,
      "whatsapp.accessToken": params.accessToken,
      "whatsapp.status": "connected",
      "whatsapp.connectedAt": now,
      "whatsapp.tokenRefreshedAt": now,
    };
    // Store legada permanece no shim de leitura; reconnect não a migra.
    const isLegacy = !!previous && !previous.templates && !!previous.templateName;
    if (!isLegacy) {
      for (const key of WHATSAPP_TEMPLATE_CATALOG_KEYS) {
        const outcome = params.provision[key];
        if (outcome.template && outcome.outcome !== "unconfirmed") {
          updates[`whatsapp.templates.${key}`] = outcome.template;
        }
      }
    }
    tx.update(ref, updates);
    return isLegacy ? (previous.templates ?? {}) : merged;
  });
}
