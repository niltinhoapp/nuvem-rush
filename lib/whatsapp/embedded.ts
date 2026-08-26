// Embedded Signup (modelo Tech Provider) — cada lojista conecta a PROPRIA
// conta de WhatsApp Business. A Meta cobra as mensagens direto do lojista;
// o Nuvem Rush nao paga pelo trafego dele.
//
// Fluxo completo:
//   1. Lojista clica "Conectar WhatsApp" (app/connect-whatsapp) -> popup da
//      Meta (FB.login com config_id) -> ele cria/escolhe a WABA e o numero.
//   2. O popup devolve um `code` (OAuth) + waba_id + phone_number_id.
//   3. O backend (api/whatsapp/connect) troca o code por um BUSINESS TOKEN
//      do lojista, inscreve nosso app na WABA dele (webhooks) e cria o
//      template padrao de pos-venda na conta DELE.
//
// Env necessarias: NEXT_PUBLIC_META_APP_ID, META_APP_SECRET.
// Pre-requisitos na Meta (fora do codigo): app aprovado no App Review com
// acesso avancado a whatsapp_business_management + whatsapp_business_messaging,
// fluxo "Provedor de Tecnologia" concluido e uma Configuration do Embedded
// Signup criada (NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID).

import {
  WHATSAPP_TEMPLATE_CATALOG_KEYS,
  getCatalogTemplate,
  type TemplateCatalogEntry,
  type TemplateCatalogKey,
} from "./catalog";
import { normalizeTemplateStatus } from "./templateStatus";
import type { WhatsappCatalogTemplate, WhatsappTemplateStatus } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";


async function graphJson(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: number } }).error;
    throw new Error(
      `Graph API ${res.status}: ${err?.message ?? JSON.stringify(body)}`,
    );
  }
  return body;
}

// Troca o `code` retornado pelo Embedded Signup por um business token do
// lojista (token de longa duracao, escopado a WABA que ele conectou).
export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("NEXT_PUBLIC_META_APP_ID / META_APP_SECRET ausentes");
  }
  const url =
    `${GRAPH}/oauth/access_token?client_id=${appId}` +
    `&client_secret=${appSecret}&code=${encodeURIComponent(code)}`;
  const body = await graphJson(await fetch(url));
  const token = body.access_token as string | undefined;
  if (!token) throw new Error("Graph nao retornou access_token na troca do code");
  return token;
}

// Renova um business token antes de ele expirar (a config do Embedded Signup
// emite tokens com validade de 60 dias). A troca fb_exchange_token devolve um
// token NOVO com mais 60 dias; o antigo continua valido ate expirar.
export async function refreshBusinessToken(currentToken: string): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("NEXT_PUBLIC_META_APP_ID / META_APP_SECRET ausentes");
  }
  const url =
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${appId}&client_secret=${appSecret}` +
    `&fb_exchange_token=${encodeURIComponent(currentToken)}`;
  const body = await graphJson(await fetch(url));
  const token = body.access_token as string | undefined;
  if (!token) throw new Error("Graph nao retornou access_token na renovacao");
  return token;
}

// Inscreve o NOSSO app na WABA do lojista — obrigatorio para recebermos os
// webhooks (status de entrega, aprovacao de template) da conta dele.
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
): Promise<void> {
  await graphJson(
    await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

// Registra o numero na Cloud API (necessario para numeros novos; numeros em
// coexistencia com o app WhatsApp Business ja vem registrados, e registrar de
// novo retorna erro "already registered" — tratado aqui como nao-fatal. O pin
// e a verificacao em duas etapas do numero —
// se nao existir, este define uma.
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin = "152563",
): Promise<{ registered: boolean; alreadyRegistered: boolean }> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  if (res.ok) return { registered: true, alreadyRegistered: false };

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; error_user_title?: string };
  };
  const msg = `${body.error?.message ?? ""} ${body.error?.error_user_title ?? ""}`;
  if (/already registered|already verified|two step/i.test(msg)) {
    return { registered: false, alreadyRegistered: true };
  }
  throw new Error(`registrar numero: ${msg.trim() || `HTTP ${res.status}`}`);
}

// Cria o template padrao de pos-venda na WABA DO LOJISTA. A aprovacao pela
// Meta leva de minutos a 24h; o webhook (message_template_status_update)
// avisa quando mudar.
//
// Categoria UTILITY (nao MARKETING): a mensagem e transacional — confirma um
// pedido especifico ja realizado. UTILITY custa ~9x menos por mensagem que
// MARKETING no Brasil (~R$0,04 vs ~R$0,33), e a conta e do lojista. Por isso
// o texto e puramente sobre o pedido, sem apelo promocional nem "responda SAIR"
// (opt-out so faz sentido em templates de MARKETING; incluir aqui forcaria a
// Meta a reclassificar como MARKETING).
export async function createCatalogTemplate(
  wabaId: string,
  token: string,
  template: TemplateCatalogEntry,
): Promise<{ created: boolean; alreadyExisted: boolean; status?: WhatsappTemplateStatus }> {
  const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: template.name,
      language: template.language,
      category: template.category,
      components: [
        {
          type: "BODY",
          text: template.body,
          example: { body_text: [template.example] },
        },
      ],
    }),
  });
  if (res.ok) {
    await res.json().catch(() => ({}));
    return {
      created: true,
      alreadyExisted: false,
      // A criação nunca comprova aprovação, mesmo que a resposta carregue um
      // campo de status. Apenas o lookup de uma reconexão ou o webhook pode
      // mudar PENDING para APPROVED.
      status: "PENDING",
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; error_user_title?: string };
  };
  // Se o lojista reconectar, o template ja existe — nao e erro.
  const msg = `${body.error?.message ?? ""} ${body.error?.error_user_title ?? ""}`;
  if (/already exists|ja existe/i.test(msg)) {
    return { created: false, alreadyExisted: true };
  }
  throw new Error(`criar template: ${msg.trim() || `HTTP ${res.status}`}`);
}

// Consulta o template ja existente durante reconexao. Essa leitura evita
// assumir que um template anterior continua aprovado; se nao houver status
// verificavel, o chamador permanece fail-closed.
export async function getCatalogTemplateStatus(
  wabaId: string,
  token: string,
  template: TemplateCatalogEntry,
): Promise<WhatsappTemplateStatus | undefined> {
  const url = new URL(`${GRAPH}/${wabaId}/message_templates`);
  url.searchParams.set("name", template.name);
  url.searchParams.set("fields", "name,language,status");
  const body = await graphJson(await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  const templates = Array.isArray(body.data) ? body.data : [];
  const existing = templates.find((item): item is Record<string, unknown> =>
    !!item
    && typeof item === "object"
    && (item as Record<string, unknown>).name === template.name
    && (item as Record<string, unknown>).language === template.language,
  );
  return existing ? normalizeTemplateStatus(existing.status) : undefined;
}

export type CatalogTemplateOperations = {
  create: typeof createCatalogTemplate;
  lookup: typeof getCatalogTemplateStatus;
};

// Cada criação é independente e sequencial. Falhas não autorizam envios:
// ausência de status verificável é persistida como PENDING.
export async function provisionCatalogTemplates(
  wabaId: string,
  token: string,
  operations: CatalogTemplateOperations = {
    create: createCatalogTemplate,
    lookup: getCatalogTemplateStatus,
  },
): Promise<Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>>> {
  const templates: Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>> = {};
  for (const key of WHATSAPP_TEMPLATE_CATALOG_KEYS) {
    const catalog = getCatalogTemplate(key);
    try {
      const created = await operations.create(wabaId, token, catalog);
      let status = created.status;
      if (created.alreadyExisted) {
        try {
          status = await operations.lookup(wabaId, token, catalog);
        } catch {
          status = undefined;
        }
      }
      templates[key] = {
        name: catalog.name,
        language: catalog.language,
        status: status ?? "PENDING",
        statusUpdatedAt: Date.now(),
      };
    } catch {
      // O restante do catálogo continua sendo provisionado; o item ausente
      // não é gravado e, portanto, não pode ser usado comercialmente.
    }
  }
  return templates;
}
