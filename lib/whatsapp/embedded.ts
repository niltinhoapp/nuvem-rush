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

const GRAPH = "https://graph.facebook.com/v22.0";

export const DEFAULT_TEMPLATE_NAME = "pos_venda_agradecimento";
export const DEFAULT_TEMPLATE_LANG = "pt_BR";

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
// coexistencia com o app WhatsApp Business ja vem registrados). O pin e a
// verificacao em duas etapas do numero — se nao existir, este define uma.
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin = "152563",
): Promise<void> {
  await graphJson(
    await fetch(`${GRAPH}/${phoneNumberId}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    }),
  );
}

// Cria o template padrao de pos-venda na WABA DO LOJISTA. A aprovacao pela
// Meta leva de minutos a 24h; o webhook (message_template_status_update)
// avisa quando mudar.
export async function createDefaultTemplate(
  wabaId: string,
  token: string,
): Promise<{ created: boolean; alreadyExisted: boolean }> {
  const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: DEFAULT_TEMPLATE_NAME,
      language: DEFAULT_TEMPLATE_LANG,
      category: "MARKETING",
      components: [
        {
          type: "BODY",
          text:
            "Ola {{1}}! Muito obrigado pela sua compra. Qualquer duvida " +
            "sobre o pedido, e so responder por aqui. Para nao receber " +
            "mais mensagens promocionais, responda SAIR.",
          example: { body_text: [["Maria"]] },
        },
      ],
    }),
  });
  if (res.ok) return { created: true, alreadyExisted: false };

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
