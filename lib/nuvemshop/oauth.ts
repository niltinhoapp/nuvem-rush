// Fluxo OAuth da Nuvemshop (Authorization Code).
// O access_token NAO expira: vale ate o app ser reinstalado ou desinstalado.

const TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";

export interface NuvemshopToken {
  access_token: string;
  token_type: "bearer";
  scope: string;
  user_id: number; // = storeId
}

export class NuvemshopOAuthResponseError extends Error {
  constructor(message = "Resposta OAuth invalida da Nuvemshop") {
    super(message);
    this.name = "NuvemshopOAuthResponseError";
  }
}

// A doc oficial (tiendanube.github.io/api-documentation/authentication)
// mostra `user_id` como STRING no JSON de resposta (ex.: "user_id": "789"),
// nao number. Aceita os dois formatos e normaliza para number — nunca
// relaxa a validacao em si (so o tipo de origem aceito).
function parseUserId(userId: unknown): number | null {
  if (typeof userId === "number") {
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
  }
  if (typeof userId === "string" && /^[0-9]{1,15}$/.test(userId)) {
    const parsed = Number(userId);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function parseNuvemshopTokenResponse(value: unknown): NuvemshopToken {
  if (!value || typeof value !== "object") {
    throw new NuvemshopOAuthResponseError();
  }

  const response = value as Record<string, unknown>;
  const accessToken = typeof response.access_token === "string"
    ? response.access_token.trim()
    : "";
  const userId = parseUserId(response.user_id);
  const scope = response.scope;

  if (
    !accessToken
    || userId === null
    || typeof scope !== "string"
  ) {
    throw new NuvemshopOAuthResponseError();
  }

  return {
    access_token: accessToken,
    token_type: "bearer",
    scope,
    user_id: userId,
  };
}

export function authorizeUrl(): string {
  return `https://www.tiendanube.com/apps/${process.env.NUVEMSHOP_APP_ID}/authorize`;
}

// DIAGNOSTICO TEMPORARIO (remover apos identificar a causa real do
// NuvemshopOAuthResponseError em homologacao). Cada estagio loga so
// booleanos/tipos/estrutura sanitizados — NUNCA NUVEMSHOP_CLIENT_SECRET,
// access_token, code, nem o header Authorization ou o body bruto da
// resposta. user_id pode aparecer em claro: e so o id da loja.
export async function exchangeCodeForToken(code: string): Promise<NuvemshopToken> {
  const appId = process.env.NUVEMSHOP_APP_ID?.trim();
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET?.trim();
  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");

  // Categoria A: configuracao/env ausente — nunca chega a fazer a chamada.
  console.log("[oauth-diag] A: config", {
    appIdPresent: !!appId,
    clientSecretPresent: !!clientSecret,
    appBaseUrlPresent: !!appBaseUrl,
  });
  if (!appId || !clientSecret || !appBaseUrl) {
    console.log("[oauth-diag] A: abortando por config ausente, antes de qualquer chamada de rede");
    throw new NuvemshopOAuthResponseError();
  }

  // Categoria B: HTTP da troca do token (inclui falha de rede/timeout).
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: appId,
        client_secret: clientSecret,
        redirect_uri: `${appBaseUrl}/api/auth/nuvemshop/callback`,
        grant_type: "authorization_code",
        code,
      }),
    });
  } catch (networkError) {
    console.log("[oauth-diag] B: falha de rede na troca do token", {
      errorName: networkError instanceof Error ? networkError.name : typeof networkError,
      errorMessage: networkError instanceof Error ? networkError.message : String(networkError),
    });
    throw networkError;
  }
  console.log("[oauth-diag] B: resposta HTTP da troca do token", {
    httpStatus: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
  });
  if (!res.ok) {
    console.log("[oauth-diag] B: abortando por HTTP nao-ok", { httpStatus: res.status });
    throw new Error(`Falha ao trocar code por token: HTTP ${res.status}`);
  }

  // Categoria C: corpo da resposta nao e JSON valido.
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (jsonError) {
    console.log("[oauth-diag] C: corpo da resposta nao e JSON valido", {
      errorMessage: jsonError instanceof Error ? jsonError.message : String(jsonError),
    });
    throw new NuvemshopOAuthResponseError();
  }

  // Categoria D: payload JSON recebido, mas pode ser rejeitado pelo parser.
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    console.log("[oauth-diag] D: payload JSON recebido (sanitizado)", {
      httpStatus: res.status,
      payloadType: typeof payload,
      keys: Object.keys(p),
      accessTokenPresent: "access_token" in p,
      accessTokenType: typeof p.access_token,
      userIdType: typeof p.user_id,
      userIdValueSanitized: p.user_id,
      scopeType: typeof p.scope,
      scopePresent: "scope" in p,
      tokenType: typeof p.token_type,
      tokenTypeValue: typeof p.token_type === "string" ? p.token_type : undefined,
    });
  } else {
    console.log("[oauth-diag] D: payload JSON recebido, mas nao e um objeto", {
      httpStatus: res.status,
      payloadType: typeof payload,
    });
  }

  return parseNuvemshopTokenResponse(payload);
}
