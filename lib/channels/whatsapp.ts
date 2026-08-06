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
import { col, storeRef } from "@/lib/firebase/admin";
import { generateWhatsappContent } from "@/lib/ai/openai";
import type { Cart, Order, Step, Store } from "@/types";

// Substitui placeholders {{...}} nos parametros do template pelos dados reais
// do pedido/carrinho/contato (link de rastreio, link de recuperacao, etc.).
function resolvePlaceholders(
  params: string[],
  data: {
    trackingUrl: string; trackingCode: string; orderNumber: string;
    name: string; recoveryUrl: string;
  },
): string[] {
  return params.map((p) =>
    p
      .replace(/\{\{\s*trackingUrl\s*\}\}/gi, data.trackingUrl)
      .replace(/\{\{\s*trackingCode\s*\}\}/gi, data.trackingCode)
      .replace(/\{\{\s*orderNumber\s*\}\}/gi, data.orderNumber)
      .replace(/\{\{\s*recoveryUrl\s*\}\}/gi, data.recoveryUrl)
      .replace(/\{\{\s*cartUrl\s*\}\}/gi, data.recoveryUrl)
      .replace(/\{\{\s*name\s*\}\}/gi, data.name),
  );
}

const GRAPH_VERSION = "v22.0";

interface WaCredentials {
  phoneNumberId: string;
  accessToken: string;
  // Template padrao da conta (usado quando o step nao define um).
  defaultTemplateName?: string;
  defaultTemplateLang?: string;
}

// Credenciais POR LOJA (Embedded Signup / Tech Provider): SEMPRE usa o numero
// e o token DO LOJISTA — a Meta cobra direto dele e a mensagem sai com o nome
// dele. NAO ha fallback para o numero global: mandar do numero do Nuvem Rush
// para o cliente final da loja e risco de politica (o consumidor nao reconhece
// o remetente) e de LGPD. Se a loja nao conectou, o disparo falha com mensagem
// clara e a UI mostra o botao de conectar. O numero global vive SO no botao de
// teste (sendTestWhatsapp).
async function resolveCredentials(storeId: string): Promise<WaCredentials> {
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  const wa = store?.whatsapp;
  if (wa?.status === "connected" && wa.phoneNumberId && wa.accessToken) {
    return {
      phoneNumberId: wa.phoneNumberId,
      accessToken: wa.accessToken,
      defaultTemplateName: wa.templateName,
      defaultTemplateLang: wa.templateLang,
    };
  }
  throw new Error(
    "WhatsApp nao conectado nesta loja. Conecte a conta oficial da Meta " +
      "para ativar este canal.",
  );
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

  const creds = await resolveCredentials(storeId);

  const enroll = (await col(storeId, "enrollments").doc(enrollmentId).get()).data()!;
  const contact = (await col(storeId, "contacts").doc(enroll.contactId).get()).data()!;
  if (!contact.phone) throw new Error("contato sem telefone");

  // Carrega o pedido OU o carrinho do enrollment para resolver placeholders
  // (rastreio, link de recuperacao de carrinho, etc.).
  const order = enroll.orderId
    ? ((await col(storeId, "orders").doc(enroll.orderId).get()).data() as Order | undefined)
    : undefined;
  const cart = enroll.cartId
    ? ((await col(storeId, "carts").doc(enroll.cartId).get()).data() as Cart | undefined)
    : undefined;

  const config = (step.config ?? {}) as {
    whatsappTemplateName?: string;
    whatsappTemplateLang?: string;
    whatsappTemplateParams?: string[];
  };

  // Prioridade: template do step > template padrao da conta conectada.
  // NUNCA cai em hello_world aqui: mandar "Hello World" em ingles para o
  // cliente final e pior do que falhar. Se nao ha template, falha explicita
  // (o job fica "failed" no log, visivel, em vez de enviar lixo).
  const templateName = config.whatsappTemplateName ?? creds.defaultTemplateName;
  if (!templateName) {
    throw new Error(
      "sem template de WhatsApp configurado (nem no step, nem na conta). " +
        "Configure um template aprovado antes de disparar.",
    );
  }
  const languageCode =
    config.whatsappTemplateLang ??
    (config.whatsappTemplateName ? "pt_BR" : creds.defaultTemplateLang) ??
    "pt_BR";

  let bodyParams = config.whatsappTemplateParams ?? [];
  // Resolve placeholders ({{trackingUrl}}, {{recoveryUrl}}, ...) com dados reais.
  if (bodyParams.length > 0) {
    bodyParams = resolvePlaceholders(bodyParams, {
      trackingUrl: order?.trackingUrl ?? "",
      trackingCode: order?.trackingCode ?? "",
      orderNumber: order?.nsOrderId ?? "",
      recoveryUrl: cart?.recoveryUrl ?? "",
      name: contact.name ?? "",
    });
  }
  if (bodyParams.length === 0 && step.aiPrompt) {
    try {
      const text = await generateWhatsappContent(step.aiPrompt, { contact });
      bodyParams = [text];
    } catch (err) {
      // IA indisponivel (sem OPENAI_API_KEY, timeout ou erro): NUNCA derruba o
      // envio. Usa um texto padrao para preencher a variavel do template.
      console.warn("[whatsapp] IA indisponivel, usando fallback:", String(err));
      const nome = contact.name ?? "";
      bodyParams = [nome ? `Ola ${nome}!` : "Ola!"];
    }
  }

  const components =
    bodyParams.length > 0
      ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
      : undefined;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
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

// Envio de MENSAGEM DE TESTE: usado pelo botao "Enviar mensagem de teste" do
// dashboard. Serve para o lojista validar a conexao (e para a evidencia em
// video exigida na analise do app da Meta). Usa o template hello_world, que
// toda WABA ja tem aprovado por padrao.
export async function sendTestWhatsapp(params: {
  storeId: string;
  to: string;
}): Promise<void> {
  const { storeId, to } = params;

  // O botao de teste usa SEMPRE o numero GLOBAL do Nuvem Rush (nunca a conta
  // do lojista): serve para validar o canal antes da conexao e para gravar os
  // videos da analise da Meta. Prioriza o numero de teste dedicado, senao o
  // numero global de producao. Este e o UNICO ponto onde o numero global e
  // usado (o disparo real, sendWhatsapp, exige a conta do lojista).
  const phoneNumberId =
    process.env.WHATSAPP_TEST_PHONE_NUMBER_ID ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error("credenciais globais de WhatsApp (teste) nao configuradas");
  }
  const creds = { phoneNumberId, accessToken };
  void storeId; // storeId nao e mais usado aqui (mantido na assinatura da API)

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizePhone(to),
        type: "template",
        template: { name: "hello_world", language: { code: "en_US" } },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${body}`);
  }
}
