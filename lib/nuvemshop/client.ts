// Cliente HTTP para a API da Nuvemshop.
// Base: https://api.tiendanube.com/v1/{storeId}/...
// Headers obrigatorios: Authentication: bearer <token> e User-Agent.

import type { NsOrder, NsProduct, NsCheckout } from "./types";

const API_BASE = "https://api.tiendanube.com/v1";

export class NuvemshopClient {
  constructor(
    private readonly storeId: string,
    private readonly accessToken: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_BASE}/${this.storeId}/${path}`, {
      ...init,
      headers: {
        Authentication: `bearer ${this.accessToken}`,
        "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? "Nuvem Rush",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`Nuvemshop API ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
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

  // Carrinhos abandonados criados a partir de `since` (ISO 8601), mais recentes.
  listCheckouts(sinceISO?: string, perPage = 50) {
    const q = new URLSearchParams({ per_page: String(perPage), sort_by: "created-at-descending" });
    if (sinceISO) q.set("created_at_min", sinceISO);
    return this.request<NsCheckout[]>(`checkouts?${q.toString()}`);
  }

  // Registra um webhook para um evento (ex.: "order/paid").
  createWebhook(event: string, url: string) {
    return this.request("webhooks", {
      method: "POST",
      body: JSON.stringify({ event, url }),
    });
  }
}
