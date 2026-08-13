# Nuvem Rush — Módulo NubeSDK (storefront/checkout)

Camada **exclusiva de storefront/checkout**, separada do painel Admin
(que continua Next.js + React + Nimbus + Nexo + iframe). Roda em **Web Worker
isolado**: sem `window`/`document`/DOM/jQuery/React.

## O que faz
Observa eventos oficiais do NubeSDK e emite um **sinal mínimo** (sem PII) ao
backend quando o checkout inicia ou a compra conclui. **Não** envia mensagem,
**não** altera carrinho/preço/frete, **não** bloqueia checkout. O abandono é
decidido **server-side**.

- Entry point: `export function App(nube: NubeSDK)` em `src/main.ts`.
- Estado: reutiliza a máquina pura em `../lib/storefront/cartState.ts`.
- Eventos: `page:loaded`, `cart:update`, `cart:view`, `checkout:ready`,
  `customer:update`, `checkout:success`, `order:update`.

## Pendências de empacotamento (Fase 9 — manuais, NÃO feitas aqui)
1. **Instalar** os pacotes oficiais (`@tiendanube/nube-sdk-types`, e `-ui`/`-jsx`
   se necessário) e **substituir** `src/nube-sdk.shim.ts` pelos tipos oficiais.
2. **Bundle** do worker (via `create-nube-app`/DevTools oficiais), definindo a
   constante `CART_SIGNAL_ENDPOINT` (URL pública do backend). **Nenhum segredo**
   entra no bundle.
3. **Associar** o script ao app e **testar em loja demo** com a tag SDK
   (ver `docs/NUBESDK_DEMO_VALIDATION_CHECKLIST.md`).
4. Marcar **"Uses NubeSDK"** apenas após validação real.

> Estas etapas dependem de detalhes de build/publicação da doc oficial que não
> estão totalmente enumerados publicamente; confirmar no `create-nube-app`/DevTools
> no momento do empacotamento.
