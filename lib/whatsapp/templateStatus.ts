import type { StoreWhatsapp, WhatsappTemplateStatus } from "@/types";

export const TEMPLATE_NOT_APPROVED_ERROR = "whatsapp_template_not_approved";

export type MetaTemplateStatusUpdate = {
  wabaId: string;
  name: string;
  language: string;
  status: WhatsappTemplateStatus;
  receivedAt: number;
};

export function normalizeTemplateStatus(value: unknown): WhatsappTemplateStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized || undefined;
}

export function isTemplateApproved(status: WhatsappTemplateStatus | undefined): boolean {
  return status === "APPROVED";
}

export function initialTemplateStatus(value: unknown): WhatsappTemplateStatus {
  return normalizeTemplateStatus(value) ?? "PENDING";
}

export function sameTemplate(
  whatsapp: Pick<StoreWhatsapp, "templateName" | "templateLang">,
  name: string,
  language: string,
): boolean {
  return whatsapp.templateName === name && whatsapp.templateLang === language;
}

export function assertCommercialTemplateApproved(params: {
  whatsapp: Pick<StoreWhatsapp, "templateName" | "templateLang" | "templateStatus">;
  name: string;
  language: string;
}): void {
  if (!sameTemplate(params.whatsapp, params.name, params.language)) {
    throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
  }
  if (!isTemplateApproved(params.whatsapp.templateStatus)) {
    throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
  }
}

export function canApplyTemplateStatusUpdate(params: {
  storeActive: boolean;
  whatsapp: Pick<StoreWhatsapp, "wabaId" | "templateName" | "templateLang" | "templateStatusUpdatedAt"> | undefined;
  wabaId: string;
  name: string;
  language: string;
  receivedAt: number;
}): boolean {
  const whatsapp = params.whatsapp;
  return !!whatsapp
    && params.storeActive
    && whatsapp.wabaId === params.wabaId
    && sameTemplate(whatsapp, params.name, params.language)
    && (typeof whatsapp.templateStatusUpdatedAt !== "number"
      || whatsapp.templateStatusUpdatedAt <= params.receivedAt);
}

function webhookTimeMs(value: unknown): number {
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
}

export function parseMetaTemplateStatusUpdate(entry: unknown, change: unknown): MetaTemplateStatusUpdate | null {
  if (!entry || typeof entry !== "object" || !change || typeof change !== "object") return null;
  const currentEntry = entry as { id?: unknown; time?: unknown };
  const currentChange = change as { field?: unknown; value?: unknown };
  if (currentChange.field !== "message_template_status_update") return null;
  if (!currentChange.value || typeof currentChange.value !== "object") return null;
  const value = currentChange.value as {
    event?: unknown;
    message_template_name?: unknown;
    message_template_language?: unknown;
  };
  const status = normalizeTemplateStatus(value.event);
  if (
    typeof currentEntry.id !== "string"
    || typeof value.message_template_name !== "string"
    || typeof value.message_template_language !== "string"
    || !status
  ) return null;
  return {
    wabaId: currentEntry.id,
    name: value.message_template_name,
    language: value.message_template_language,
    status,
    receivedAt: webhookTimeMs(currentEntry.time),
  };
}

export function templateStatusLabel(status: WhatsappTemplateStatus | undefined): string {
  switch (status) {
    case "PENDING": return "Em análise";
    case "APPROVED": return "Aprovado";
    case "REJECTED": return "Rejeitado";
    case "PAUSED": return "Pausado";
    case "DISABLED": return "Desativado";
    default: return "Indisponível";
  }
}
