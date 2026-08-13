// CORS restritivo para o endpoint de sinal do storefront. O sinal é UNTRUSTED
// (o CORS é defesa em profundidade, não a fronteira de segurança). Só origens
// legítimas de storefront/checkout Nuvemshop recebem headers CORS.
//
// Observação: lojas com DOMÍNIO PRÓPRIO não casam os sufixos Nuvemshop — para
// esses casos, adicionar os domínios via STOREFRONT_ALLOWED_ORIGIN_SUFFIXES.

const DEFAULT_SUFFIXES = [
  ".lojavirtualnuvem.com.br",
  ".nuvemshop.com.br",
  ".mitiendanube.com",
  ".tiendanube.com",
];

export function allowedSuffixes(): string[] {
  const env = process.env.STOREFRONT_ALLOWED_ORIGIN_SUFFIXES;
  const extra = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return [...DEFAULT_SUFFIXES, ...extra];
}

export function isAllowedOrigin(origin: string | null, suffixes: string[] = allowedSuffixes()): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return suffixes.some((suf) => {
    const bare = suf.startsWith(".") ? suf.slice(1) : suf;
    return host === bare || host.endsWith(suf.startsWith(".") ? suf : `.${suf}`);
  });
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
