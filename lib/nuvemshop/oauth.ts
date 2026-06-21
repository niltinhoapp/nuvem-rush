// Fluxo OAuth da Nuvemshop (Authorization Code).
// O access_token NAO expira: vale ate o app ser reinstalado ou desinstalado.

const TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";

export interface NuvemshopToken {
  access_token: string;
  token_type: "bearer";
  scope: string;
  user_id: number; // = storeId
}

export function authorizeUrl(): string {
  return `https://www.tiendanube.com/apps/${process.env.NUVEMSHOP_APP_ID}/authorize`;
}

export async function exchangeCodeForToken(code: string): Promise<NuvemshopToken> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.NUVEMSHOP_APP_ID,
      client_secret: process.env.NUVEMSHOP_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha ao trocar code por token: ${res.status} ${body}`);
  }
  return (await res.json()) as NuvemshopToken;
}
