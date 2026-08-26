// Cliente server-side minimo para o Billing nativo da Nuvemshop.
//
// CONTRATO OFICIAL (dev.nuvemshop.com.br / tiendanube.github.io — ver o
// relatorio da OS para a separacao DOCUMENTED/INFERRED/PORTAL_CONFIGURATION):
//
//   GET /concepts/{concept_code}/services/{service_id}/subscriptions
//     -> 200 com { store_id, plan:{id,code}, next_execution, last_execution, ... }
//        quando ja existe (ou existiu) uma assinatura para a loja.
//     -> 404 quando a loja nunca teve assinatura para este service/concept.
//   Autenticacao: metodo Partner-Action (nao e o access_token por loja).
//
// O `status` da assinatura NAO e um campo documentado explicitamente — o
// estado operacional e inferido de existir/nao existir o registro e de
// `next_execution`. Os dias gratis ("Teste gratis") sao configurados no
// Partner Portal e nao aparecem como campo isolado nesta resposta; por isso
// este cliente so informa "existe assinatura ou nao", nunca inventa um campo
// de trial. A politica (policy.ts) decide o que fazer com essa informacao.
//
// Fail-closed: qualquer erro de rede, timeout, HTTP inesperado ou corpo
// malformado vira "unknown" — nunca e tratado como "found" nem "not_found".
const BILLING_API_BASE = "https://api.nuvemshop.com.br/v1";
const REQUEST_TIMEOUT_MS = 5_000;

export type NuvemshopSubscriptionResult =
  | { kind: "found"; planCode: string | null; nextExecution: string | null; lastExecution: string | null }
  | { kind: "not_found" }
  | { kind: "unknown"; reason: string };

export interface NuvemshopBillingCredentials {
  conceptCode: string;
  serviceId: string;
  partnerToken: string;
}

function readCredentials(): NuvemshopBillingCredentials | null {
  const conceptCode = process.env.NUVEMSHOP_BILLING_CONCEPT_CODE;
  const serviceId = process.env.NUVEMSHOP_BILLING_SERVICE_ID;
  const partnerToken = process.env.NUVEMSHOP_PARTNER_TOKEN;
  if (!conceptCode?.trim() || !serviceId?.trim() || !partnerToken?.trim()) return null;
  return { conceptCode, serviceId, partnerToken };
}

// Injetavel para teste (fake fetch) — nunca chamado com a API real nesta OS.
export async function fetchNuvemshopSubscription(
  storeId: string,
  fetchFn: typeof fetch = fetch,
  credentials: NuvemshopBillingCredentials | null = readCredentials(),
): Promise<NuvemshopSubscriptionResult> {
  if (!credentials) return { kind: "unknown", reason: "billing_credentials_missing" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${BILLING_API_BASE}/concepts/${encodeURIComponent(credentials.conceptCode)}` +
      `/services/${encodeURIComponent(credentials.serviceId)}/subscriptions?store_id=${encodeURIComponent(storeId)}`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: {
        // Partner-Action: o token de parceiro nunca e logado nem devolvido
        // ao cliente — so trafega neste header, servidor-a-servidor.
        Authorization: `bearer ${credentials.partnerToken}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "unknown", reason: `http_${res.status}` };

    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return { kind: "unknown", reason: "malformed_body" };
    const data = body as Record<string, unknown>;
    const plan = data.plan as Record<string, unknown> | undefined;
    return {
      kind: "found",
      planCode: typeof plan?.code === "string" ? plan.code : null,
      nextExecution: typeof data.next_execution === "string" ? data.next_execution : null,
      lastExecution: typeof data.last_execution === "string" ? data.last_execution : null,
    };
  } catch (error) {
    // AbortError (timeout) e falha de rede caem aqui — nunca vazam o erro
    // bruto (poderia conter detalhes da chamada); so a categoria.
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    return { kind: "unknown", reason };
  } finally {
    clearTimeout(timeout);
  }
}
