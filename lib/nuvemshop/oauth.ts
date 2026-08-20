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

export function parseNuvemshopTokenResponse(value: unknown): NuvemshopToken {
  if (!value || typeof value !== "object") {
    throw new NuvemshopOAuthResponseError();
  }

  const response = value as Record<string, unknown>;
  const accessToken = typeof response.access_token === "string"
    ? response.access_token.trim()
    : "";
  const userId = response.user_id;
  const scope = response.scope;

  if (
    !accessToken
    || typeof userId !== "number"
    || !Number.isSafeInteger(userId)
    || userId <= 0
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

export async function exchangeCodeForToken(code: string): Promise<NuvemshopToken> {
  const appId = process.env.NUVEMSHOP_APP_ID?.trim();
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET?.trim();

  if (!appId || !clientSecret) {
    throw new NuvemshopOAuthResponseError();
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao trocar code por token: HTTP ${res.status}`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new NuvemshopOAuthResponseError();
  }

  return parseNuvemshopTokenResponse(payload);
}
