import type { TemplateCatalogKey } from "./catalog";
import { assertCommercialTemplateApproved } from "./templateStatus";
import type { StoreWhatsapp } from "@/types";

const GRAPH_VERSION = "v22.0";

export function normalizeWhatsappPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

// A guarda é executada imediatamente antes da expressão fetch. O fetchFn é
// injetável para provar que estado bloqueado gera zero chamadas ao provider.
export async function sendApprovedCatalogTemplate(params: {
  whatsapp: StoreWhatsapp;
  key: TemplateCatalogKey;
  phoneNumberId: string;
  accessToken: string;
  to: string;
  bodyParams: string[];
  fetchFn?: typeof fetch;
}): Promise<void> {
  const template = assertCommercialTemplateApproved({ whatsapp: params.whatsapp, key: params.key });
  const response = await (params.fetchFn ?? fetch)(
    `https://graph.facebook.com/${GRAPH_VERSION}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizeWhatsappPhone(params.to),
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          components: [{ type: "body", parameters: params.bodyParams.map((text) => ({ type: "text", text })) }],
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${await response.text()}`);
}
