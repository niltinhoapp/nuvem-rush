// Cliente HTTP para a API da Nuvemshop.
// Base: https://api.tiendanube.com/v1/{storeId}/...
// Headers obrigatorios: Authentication: bearer <token> e User-Agent.

import type { NsOrder, NsProduct } from "./types";

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
    return this.request<NsOrder>(`orders/${orderId}`);
  }

  getProduct(productId: string) {
    return this.request<NsProduct>(`products/${productId}`);
  }

  listCategories() {
    return this.request<unknown[]>("categories");
  }

  // Registra um webhook para um evento (ex.: "order/paid").
  createWebhook(event: string, url: string) {
    return this.request("webhooks", {
      method: "POST",
      body: JSON.stringify({ event, url }),
    });
  }
}
