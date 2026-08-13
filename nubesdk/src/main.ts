// Módulo NubeSDK do Nuvem Rush — camada EXCLUSIVA de storefront/checkout.
// Roda em Web Worker isolado. PROIBIDO: window, document, DOM, jQuery, React,
// innerHTML. Usa somente APIs oficiais do NubeSDK + `fetch` nativo.
//
// Responsabilidade ÚNICA: observar eventos de cart/checkout, manter a máquina
// de estados e emitir um SINAL MÍNIMO ao backend (sem PII). NÃO envia
// WhatsApp/e-mail, NÃO altera carrinho/preço/frete, NÃO bloqueia checkout.
// O abandono é decidido SERVER-SIDE; a compra concluída cancela recuperação.
//
// Entry point oficial: export function App(nube: NubeSDK).
import { reduceCart, initCartMachine, type NubeCartEvent } from "../../lib/storefront/cartState";
import type { NubeSDK, NubeSDKState } from "./nube-sdk.shim";

// Definido no empacotamento (build do worker). Sem segredo — endpoint público
// que trata o sinal como UNTRUSTED e reconfirma tudo server-side.
declare const CART_SIGNAL_ENDPOINT: string | undefined;

const EVENTS: NubeCartEvent[] = [
  "page:loaded",
  "cart:update",
  "cart:view",
  "checkout:ready",
  "customer:update",
  "checkout:success",
  "order:update",
];

export function App(nube: NubeSDK): void {
  let machine = initCartMachine();
  const endpoint =
    typeof CART_SIGNAL_ENDPOINT === "string" && CART_SIGNAL_ENDPOINT
      ? CART_SIGNAL_ENDPOINT
      : "";

  for (const event of EVENTS) {
    nube.on(event, (state: NubeSDKState) => {
      const storeId = String(state.store?.id ?? "");
      const cartId = String(state.cart?.id ?? "");
      if (!storeId || !cartId) return; // sem contexto suficiente: ignora

      const { state: next, signal } = reduceCart(machine, event, {
        storeId,
        cartId,
        hasItems: (state.cart?.items?.length ?? 0) > 0,
        hasContact: Boolean(state.customer),
        now: Date.now(),
      });
      machine = next;

      if (signal && endpoint) {
        // `fetch` nativo do Web Worker. keepalive p/ sobreviver à navegação.
        // Corpo = sinal MÍNIMO (storeId, cartId, phase, at) — sem PII, sem segredo.
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(signal),
          keepalive: true,
        }).catch(() => {
          // Falha do sinal NÃO quebra a loja; o polling server-side é fallback.
        });
      }
    });
  }
}
