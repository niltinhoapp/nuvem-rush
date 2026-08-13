// Módulo NubeSDK do Nuvem Rush — camada EXCLUSIVA de storefront/checkout.
// Roda em Web Worker isolado. PROIBIDO: window, document, DOM, jQuery, React,
// innerHTML. Usa somente APIs oficiais do NubeSDK + `fetch` nativo.
//
// Responsabilidade ÚNICA: observar eventos de cart/checkout e emitir SINAIS
// MÍNIMOS (sem PII, sem segredo) ao backend. NÃO envia WhatsApp/e-mail, NÃO
// altera carrinho/preço/frete, NÃO bloqueia checkout. O backend é a autoridade:
// resolve a loja pela API oficial, usa relógio próprio e confirma conclusão.
//
// Entry point oficial: export const App: NubeApp.
import { reduceCart, initCartMachine, type NubeCartEvent } from "../../lib/storefront/cartState";
import type { NubeApp, NubeSDK, NubeSDKState } from "@tiendanube/nube-sdk-types";

// Injetado no bundle (tsup/DevTools). Sem segredo — endpoint público, sinal
// tratado como UNTRUSTED e reconfirmado server-side.
declare const CART_SIGNAL_ENDPOINT: string | undefined;

// Eventos LISTENABLE oficiais do NubeSDK (v0.5.0).
const EVENTS: NubeCartEvent[] = [
  "cart:update",
  "checkout:ready",
  "customer:update",
  "shipping:update",
  "payment:update",
  "checkout:success",
];

// Throttle de sinais de ATIVIDADE (renovam lastActivityAt no servidor). Sinais
// CHECKOUT_STARTED e COMPLETED são sempre enviados; ACTIVITY no máx. a cada 60s.
const ACTIVITY_THROTTLE_MS = 60_000;

export const App: NubeApp = (nube: NubeSDK) => {
  let machine = initCartMachine();
  let lastActivitySentAt = 0;
  const endpoint =
    typeof CART_SIGNAL_ENDPOINT === "string" && CART_SIGNAL_ENDPOINT ? CART_SIGNAL_ENDPOINT : "";

  for (const event of EVENTS) {
    nube.on(event, (state: NubeSDKState) => {
      const storeId = String(state.store?.id ?? "");
      const cartId = String(state.cart?.id ?? "");
      if (!cartId) return; // sem carrinho: nada a sinalizar

      const now = Date.now();
      const { state: next, signal } = reduceCart(machine, event, {
        storeId,
        cartId,
        hasItems: (state.cart?.items?.length ?? 0) > 0,
        hasContact: Boolean(state.customer),
        now,
      });
      machine = next;
      if (!signal || !endpoint) return;

      // Throttle apenas de ACTIVITY (evita flood de cart:update).
      if (signal.phase === "ACTIVITY") {
        if (now - lastActivitySentAt < ACTIVITY_THROTTLE_MS) return;
        lastActivitySentAt = now;
      }

      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signal),
        keepalive: true,
      }).catch(() => {
        // Falha do sinal NÃO quebra a loja; o polling server-side é fallback.
      });
    });
  }
};
