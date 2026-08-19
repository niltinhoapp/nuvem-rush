// Cliente HTTP para a API da Nuvemshop.
// Base: https://api.tiendanube.com/v1/{storeId}/...
// Headers obrigatorios: Authentication: bearer <token> e User-Agent.

import type { NsOrder, NsProduct, NsCheckout } from "./types";

export type NsWebhook = {
  id: number;
  event: string;
  url: string;
};

const API_BASE = "https://api.tiendanube.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5_000;

export class NuvemshopApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly transient: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(`Nuvemshop API ${status}`);
    this.name = "NuvemshopApiError";
  }
}

export class NuvemshopRequestError extends Error {
  constructor(message: string, public readonly transient: boolean) {
    super(message);
    this.name = "NuvemshopRequestError";
  }
}

type ClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  timeoutMs?: number;
  maxReadRetries?: number;
};

function retryDelay(headers: Headers, now: number): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = Number(headers.get("x-rate-limit-reset"));
  return Number.isFinite(reset) && reset >= 0 ? reset : undefined;
}

export class NuvemshopPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NuvemshopPaginationError";
  }
}

function parseTotalCount(value: string | null): number {
  if (value == null || !/^\d+$/.test(value)) {
    throw new NuvemshopPaginationError("x-total-count ausente ou invalido");
  }
  return Number(value);
}

function nextCheckoutPage(link: string | null, storeId: string): number | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.trim().match(/^<([^>]+)>\s*;\s*rel="?([^";]+)"?$/i);
    if (!match || match[2] !== "next") continue;
    const url = new URL(match[1]!);
    if (url.origin !== new URL(API_BASE).origin) {
      throw new NuvemshopPaginationError("Link next aponta para origem inesperada");
    }
    if (url.pathname !== `/v1/${storeId}/checkouts`) {
      throw new NuvemshopPaginationError("Link next aponta para recurso inesperado");
    }
    const rawPage = url.searchParams.get("page");
    if (!rawPage || !/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
      throw new NuvemshopPaginationError("Link next sem pagina valida");
    }
    return Number(rawPage);
  }
  return null;
}

export class NuvemshopClient {
  constructor(
    private readonly storeId: string,
    private readonly accessToken: string,
    private readonly options: ClientOptions = {},
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await this.requestWithHeaders<T>(path, init)).data;
  }

  private async requestWithHeaders<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ data: T; headers: Headers }> {
    const method = (init.method ?? "GET").toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";
    const maxRetries = idempotent ? (this.options.maxReadRetries ?? DEFAULT_READ_RETRIES) : 0;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const sleep = this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const random = this.options.random ?? Math.random;
    const now = this.options.now ?? Date.now;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      try {
        const res = await fetchImpl(`${API_BASE}/${this.storeId}/${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Authentication: `bearer ${this.accessToken}`,
            "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? "Nuvem Rush",
            "Content-Type": "application/json",
            ...init.headers,
          },
        });
        if (res.ok) {
          return { data: (await res.json()) as T, headers: res.headers };
        }

        const transient = res.status === 429 || res.status >= 500;
        const headerDelay = retryDelay(res.headers, now());
        const error = new NuvemshopApiError(res.status, transient, headerDelay);
        if (!transient || attempt >= maxRetries) throw error;
        const backoff = Math.min(
          MAX_RETRY_DELAY_MS,
          headerDelay ?? (250 * (2 ** attempt) + Math.floor(random() * 100)),
        );
        await sleep(backoff);
      } catch (error) {
        if (error instanceof NuvemshopApiError) throw error;
        const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        const wrapped = new NuvemshopRequestError(
          aborted ? "Nuvemshop API timeout" : "Nuvemshop API network error",
          true,
        );
        if (attempt >= maxRetries) throw wrapped;
        await sleep(Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** attempt) + Math.floor(random() * 100)));
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  listProducts(page = 1, perPage = 100) {
    return this.request<unknown[]>(`products?page=${page}&per_page=${perPage}`);
  }

  getOrder(orderId: string) {
    // Inclui o aggregate de fulfillment_orders (rastreio do modelo novo).
    // Se faltar o escopo read_fulfillment_orders, o pedido volta 200 sem o
    // aggregate (degrada sem quebrar) — o rastreio manual ainda e lido.
    return this.request<NsOrder>(`orders/${orderId}?aggregates=fulfillment_orders`);
  }

  getProduct(productId: string) {
    return this.request<NsProduct>(`products/${productId}`);
  }

  listCategories() {
    return this.request<unknown[]>("categories");
  }

  // Dados da loja (GET /store). Campos oficiais usados: `domains` (domínios
  // próprios) e `original_domain` (subdomínio nuvemshop). Para validar a Origin
  // do sinal NubeSDK contra os domínios legítimos DAQUELA loja.
  getStore() {
    return this.request<{ domains?: string[]; original_domain?: string }>("store");
  }

  // Carrinhos abandonados criados a partir de `since` (ISO 8601), mais recentes.
  async listCheckouts(sinceISO?: string, perPage = 50): Promise<NsCheckout[]> {
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 200) {
      throw new NuvemshopPaginationError("perPage deve estar entre 1 e 200");
    }

    const all: NsCheckout[] = [];
    const ids = new Set<string>();
    const visitedPages = new Set<number>();
    let expectedTotal: number | null = null;
    let page = 1;

    while (true) {
      if (visitedPages.has(page)) {
        throw new NuvemshopPaginationError("ciclo detectado na paginacao");
      }
      visitedPages.add(page);

      const q = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: "created-at-descending",
      });
      if (sinceISO) q.set("created_at_min", sinceISO);

      const response = await this.requestWithHeaders<NsCheckout[]>(`checkouts?${q.toString()}`);
      const pageTotal = parseTotalCount(response.headers.get("x-total-count"));
      if (expectedTotal == null) expectedTotal = pageTotal;
      else if (pageTotal !== expectedTotal) {
        throw new NuvemshopPaginationError("x-total-count mudou durante a paginacao");
      }

      for (const checkout of response.data) {
        const id = String(checkout.id);
        if (ids.has(id)) {
          throw new NuvemshopPaginationError("checkout duplicado entre paginas");
        }
        ids.add(id);
        all.push(checkout);
      }

      const nextPage = nextCheckoutPage(response.headers.get("link"), this.storeId);
      if (nextPage == null) {
        if (all.length !== expectedTotal) {
          throw new NuvemshopPaginationError(
            `snapshot parcial: esperados ${expectedTotal}, recebidos ${all.length}`,
          );
        }
        return all;
      }
      if (nextPage <= page || all.length >= expectedTotal) {
        throw new NuvemshopPaginationError("Link next inconsistente com o snapshot");
      }
      page = nextPage;
    }
  }

  // Registra um webhook para um evento (ex.: "order/paid").
  listWebhooks(event: string, url: string) {
    const query = new URLSearchParams({ event, url, per_page: "200" });
    return this.request<NsWebhook[]>(`webhooks?${query.toString()}`);
  }

  createWebhook(event: string, url: string) {
    return this.request("webhooks", {
      method: "POST",
      body: JSON.stringify({ event, url }),
    });
  }
}
