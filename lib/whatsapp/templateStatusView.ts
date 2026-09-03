import { WHATSAPP_TEMPLATE_CATALOG_KEYS } from "./catalog";
import { storedCatalogTemplate } from "./templateStatus";
import type { StoreWhatsapp } from "@/types";

export function whatsappStatusPayload(wa: StoreWhatsapp | undefined) {
  return {
    connected: wa?.status === "connected",
    phoneNumberId: wa?.phoneNumberId ?? null,
    templates: Object.fromEntries(WHATSAPP_TEMPLATE_CATALOG_KEYS.map((key) => {
      const template = storedCatalogTemplate(wa, key);
      return [key, template ? {
        name: template.name,
        language: template.language,
        status: template.status,
        state: template.status,
        statusUpdatedAt: template.statusUpdatedAt ?? null,
      } : {
        name: null,
        language: null,
        status: null,
        state: wa?.templateProvisionFailures?.[key] ? "PROVISION_FAILED" : "ABSENT",
        statusUpdatedAt: null,
      }];
    })),
    templatesLastReconciledAt: wa?.templatesLastReconciledAt ?? null,
  };
}
