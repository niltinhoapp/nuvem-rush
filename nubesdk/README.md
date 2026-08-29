# Nuvem Rush — Módulo NubeSDK (storefront/checkout)

Camada **exclusiva de storefront/checkout**, separada do painel Admin
(que continua Next.js + React + Nimbus + Nexo + iframe). Roda em **Web Worker
isolado**: sem `window`/`document`/DOM/jQuery/React.

## O que faz
Observa eventos oficiais do NubeSDK e emite um **sinal mínimo** (sem PII, sem
segredo) ao backend. **Não** envia mensagem, **não** altera carrinho/preço/frete,
**não** bloqueia checkout. Toda autoridade é **server-side** (resolve a loja pela
API oficial, usa relógio próprio, confirma conclusão via API/webhook).

- Entry point oficial: `export const App: NubeApp` em `src/main.ts`.
- Tipos oficiais: `@tiendanube/nube-sdk-types` (v0.5.0).
- Estado: reutiliza a máquina pura `../lib/storefront/cartState.ts`.
- Eventos **listenable** oficiais usados: `cart:update`, `checkout:ready`,
  `customer:update`, `shipping:update`, `payment:update`, `checkout:success`.
  (page:loaded / cart:view / order:update NÃO são listenable na v0.5.0.)

## Build / Local Mode (oficial, tsup)
```bash
cd nubesdk
npm install
npm run build      # gera dist/main.min.js (tsup, minificado)
npm run dev        # watch + serve em http://localhost:8080
```
- Bundle: **`dist/main.min.js`** — URL de Local Mode: `http://localhost:8080/main.min.js`.
- O **NubeSDK DevTools** (extensão Chrome) carrega essa URL na loja de teste.
- `CART_SIGNAL_ENDPOINT` é injetado em build-time (env), **sem segredo**.

## Pendências MANUAIS (Portal — NÃO feitas aqui)
1. Scaffold de referência: `npm create nube-app@latest` (já replicado nesta pasta).
2. **Associar** o script/bundle ao app no fluxo oficial de publicação.
3. **Solicitar a tag/flag SDK** para a loja de teste.
4. **Validar** storefront + checkout (ver `docs/NUBESDK_DEMO_VALIDATION_CHECKLIST.md`).
5. Marcar **"Uses NubeSDK"** SOMENTE após validação real.
