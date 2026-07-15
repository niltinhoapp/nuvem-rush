// Canal de WhatsApp via Meta Cloud API (WhatsApp Business Platform).
// Mensagens de pos-venda disparadas horas/dias apos a compra caem FORA da
// janela de 24h de atendimento, entao a Meta so permite envio via "template"
// (HSM) pre-aprovado — nao da pra mandar texto livre nesse cenario.
//
// Config esperada em step.config (opcional):
//   whatsappTemplateName   -> nome do template aprovado no WhatsApp Manager
//   whatsappTemplateLang   -> codigo de idioma do template (ex.: "pt_BR")
//   whatsappTemplateParams -> parametros fixos do corpo do template, em ordem
//
// Se nenhum template for configurado, cai no "hello_world" (o template de
// teste que toda WABA ja tem aprovado por padrao) so para validar o envio —
// ele nao aceita parametros, entao nao usa o aiPrompt. Para producao de
// verdade, crie e aprove um template proprio no WhatsApp Manager e configure
// whatsappTemplateName/whatsappTemplateLang no step.
import { col } from "@/lib/firebase/admin";
import { generateWhatsappContent } from "@/lib/ai/openai";
import type { Step } from "@/types";

const GRAPH_VERSION = "v22.0";

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error("WHATSAPP_PHONE_NUMBER_ID nao configurada");
  return id;
}

function accessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN nao configurado");
  return token;
}

// Normaliza para o formato esperado pela Graph API (digitos, com DDI).
// Heuristica: numeros com ate 11 digitos vem sem DDI -> assume Brasil (55).
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

export async function sendWhatsapp(params: {
  storeId: string;
  enrollmentId: string;
  step: Step;
}): Promise<void> {
  const { storeId, enrollmentId, step } = params;

  const enroll = (await col(storeId, "enrollments").doc(enrollmentId).get()).data()!;
  const contact = (await col(storeId, "contacts").doc(enroll.contactId).get()).data()!;
  if (!contact.phone) throw new Error("contato sem telefone");

  const config = (step.config ?? {}) as {
    whatsappTemplateName?: string;
    whatsappTemplateLang?: string;
    whatsappTemplateParams?: string[];
  };

  const templateName = config.whatsappTemplateName ?? "hello_world";
  const languageCode = config.whatsappTemplateLang ?? "en_US";

  let bodyParams = config.whatsappTemplateParams ?? [];
  if (bodyParams.length === 0 && step.aiPrompt && templateName !== "hello_world") {
    const text = await generateWhatsappContent(step.aiPrompt, { contact });
    bodyParams = [text];
  }

  const components =
    bodyParams.length > 0
      ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
      : undefined;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId()}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizePhone(contact.phone),
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components ? { components } : {}),
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${body}`);
  }
}
