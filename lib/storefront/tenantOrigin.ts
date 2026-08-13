// Validação tenant-origin (bloqueador 3-D): a Origin da requisição precisa
// bater com os domínios legítimos DAQUELA loja — não basta ser "alguma" loja
// Nuvemshop. Os domínios vêm da API oficial GET /store (campos reais `domains`
// e `original_domain`), cacheados no doc da loja.
//
// PURO/testável. Sem PII.

// Domínios legítimos conhecidos da loja (cacheados a partir de GET /store).
export interface StoreDomains {
  domains?: string[]; // domínios próprios/custom (ex.: www.minhaloja.com)
  originalDomain?: string; // subdomínio nuvemshop (ex.: loja.nuvemshop.com.br)
}

function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

// Normaliza um domínio para o host BASE (sem protocolo/porta e sem "www."),
// para que www / apex / subdomínios do domínio legítimo casem.
function domainHost(d: string): string {
  const s = d.trim().toLowerCase();
  let host: string;
  try {
    host = new URL(s.includes("://") ? s : `https://${s}`).host;
  } catch {
    host = s;
  }
  return host.replace(/^www\./, "");
}

export function legitimateHosts(store: StoreDomains): string[] {
  const raw = [...(store.domains ?? []), store.originalDomain].filter(
    (d): d is string => typeof d === "string" && d.length > 0,
  );
  return raw.map(domainHost);
}

// A Origin bate com a loja se o host da Origin é um domínio legítimo dela
// (igual, com/sem www, ou subdomínio de um domínio legítimo).
export function originMatchesStore(origin: string | null, store: StoreDomains): boolean {
  const host = hostOf(origin);
  if (!host) return false;
  const legit = legitimateHosts(store);
  if (legit.length === 0) return false; // sem domínios conhecidos: não afirma match
  return legit.some((d) => host === d || host === `www.${d}` || host.endsWith(`.${d}`));
}

// True se temos domínios cacheados para decidir estritamente.
export function hasKnownDomains(store: StoreDomains): boolean {
  return legitimateHosts(store).length > 0;
}
