# NubeSDK Cart Signals — Status de Implementação & Pendências Manuais

> Branch `feat/nubesdk-cart-signals` (a partir de `fix/pre-homologation-p0`).
> **Sem merge, sem deploy, sem ativar "Uses NubeSDK", sem tocar o Portal.**

## O que foi implementado (código)

| Camada | Arquivo | Papel |
|---|---|---|
| Estado (puro) | `lib/storefront/cartState.ts` | Máquina ACTIVE→CHECKOUT_STARTED→COMPLETED + `isAbandonedCandidate` (server-side) |
| Módulo SDK | `nubesdk/src/main.ts` | `App(nube)`; escuta eventos; emite sinal mínimo via `fetch` |
| Tipos | `nubesdk/src/nube-sdk.shim.ts` | Shim local (trocar por `@tiendanube/nube-sdk-types`) |
| Endpoint | `app/api/storefront/cart-signal/route.ts` | Ingestão UNTRUSTED (CORS + zod + sem op privilegiada) |
| CORS/validação | `lib/storefront/cors.ts`, `cartSignal.ts` | Allowlist de origem + schema + `cartEnrollKey` |
| Dedup | `lib/storefront/enrollCartOnce.ts` | Inscrição única (reusa idempotência atômica P0) |
| Timeout | `app/api/cron/cart-signals/route.ts` | Abandono server-side (30 min) + reconfirma via API |
| Fallback | `app/api/cron/carts/route.ts` | Poll preservado, agora via `enrollCartOnce` |

## Pendências MANUAIS (não feitas — exigem Portal/empacotamento)

1. **Empacotar o worker** com os pacotes oficiais (`@tiendanube/nube-sdk-types`,
   `create-nube-app`/DevTools), substituindo o shim; definir `CART_SIGNAL_ENDPOINT`.
2. **Associar o script** ao app (conforme o fluxo oficial de publicação do bundle).
3. **Solicitar a tag/flag SDK** para a **loja de teste**.
4. **Validar** storefront + checkout na loja demo (ver `NUBESDK_DEMO_VALIDATION_CHECKLIST.md`).
5. **Configurar env de produção:** `STOREFRONT_ALLOWED_ORIGIN_SUFFIXES` (incluir
   domínios próprios de lojas, se houver); confirmar **Vercel Pro** (crons `*/5`);
   rate-limit de borda (Vercel WAF) para `/api/storefront/cart-signal`.
6. **Marcar "Uses NubeSDK"** SOMENTE após validação real.

## A confirmar na loja demo (incerteza técnica registrada)

- **`state.cart.id` == id do Abandoned Checkout?** O dedup de inscrição é robusto
  de qualquer forma (ambas as fontes chaveiam por `raw.id` via
  `syncAbandonedCheckout`). Mas a **confirmação por API no cron** casa o
  `cart_signals` por `cartId`; se os ids diferirem, o sinal vira no-op e o
  **poll diário** assume (fallback). Validar a correspondência e ajustar a chave
  de matching se necessário.

## Segurança (resumo)
- Sinal = **UNTRUSTED**: nenhum segredo no bundle; backend nunca envia mensagem
  nem lê dado privado a partir do sinal; reconfirma tudo via API oficial com o
  token **server-side**.
- CORS restritivo; zod `.strict`; endpoint write-only; dedup atômico.

## Rollback
- Descartar a branch: `git branch -D feat/nubesdk-cart-signals` (nada em `main`).
- Ou reverter por commit (ver relatório). Campos/coleção novos (`cart_signals`,
  chave `cart_enroll:*`) são **aditivos**; reverter o código simplesmente para de
  usá-los. O poll volta a `enrollCartInFlows` ao reverter o commit da Fase 3-7.
