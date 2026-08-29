# NubeSDK — Cart Signal / Security Design

> **Planejamento.** Nada implementado, nada instalado, sem commit/deploy.
> Baseado na documentação oficial do NubeSDK (DevHub Nuvemshop + repo
> `TiendaNube/nube-sdk`) e no código real do Nuvem Rush (`main`).
> Complementa `NUBESDK_CODE_AUDIT.md` e `NUBESDK_CART_ARCHITECTURE.md`.

## Fatos oficiais estabelecidos (fonte da verdade)

| Tema | Fato oficial | Implicação |
|---|---|---|
| Runtime | App roda em **Web Worker isolado**; **sem** `window`/`document`/DOM/`localStorage` | Não dá para injetar script/ler DOM; UI só via slots (`render()`) |
| Rede | **`fetch` nativo disponível no worker**; "no special SDK method" | Comunicação com o backend é `fetch` HTTP normal |
| CORS | "The target server must support **CORS**" | Nosso endpoint precisa habilitar CORS para o worker |
| Segredos | **Nenhum mecanismo oficial de segredo/token assinado client-side documentado** | ❌ **Não** colocar credencial no worker; o sinal é **não confiável** |
| Storage | `nube.getBrowserAPIs()` → `asyncLocalStorage/Session` **com escopo por app** e TTL | Persistência leve por app, se necessário |
| Eventos | `nube.on()/send()`; "**24+ commerce events**" (cart, checkout, shipping, coupons, orders); confirmados: `cart:update`, `cart:validate` | Suficiente para uma máquina de estados |
| State | `nube.getState()` imutável: **cart, store, ui, AppLocation** | `cart.items`, `cart.prices.total`; `store` = "info da loja onde o app roda" |

**Itens a confirmar no pacote oficial `@tiendanube/nube-sdk-types` (1º passo da
implementação — são lookups na fonte autoritativa, não incógnitas externas):**
- (T1) nomes exatos dos eventos de **checkout** e **order** (lifecycle);
- (T2) campo identificador de loja em `state.store` (id/domínio).

Nenhum dos dois altera a arquitetura de segurança abaixo (ver §2).

---

## 1. Mecanismo oficial de comunicação

**Worker → backend via `fetch` HTTP** (mecanismo oficial confirmado). Não há
método especial nem canal privilegiado. Portanto:

```
NubeSDK (Web Worker, storefront/checkout)
  → fetch POST https://<backend>/api/storefront/cart-signal   (CORS habilitado)
```

O endpoint do Nuvem Rush deve responder **CORS** e ser **rápido** (grava o sinal
e retorna 200; processamento assíncrono).

## 2. Autenticação (o ponto crítico)

**Não existe segredo client-side oficial → o sinal é tratado como NÃO CONFIÁVEL.**
Não inventar segredo. **Nunca** enviar `INTERNAL_DISPATCH_SECRET`, API secret,
access token Nuvemshop ou qualquer credencial no worker.

**Âncora de confiança = re-verificação server-side contra a API oficial.**
O backend nunca confia no conteúdo do sinal; ele:
1. Recebe `{ storeCtx, cartId, stage, at }` (mínimo, sem PII).
2. Usa o **access token server-side que já possui** para aquela loja e
   **reconfirma** o `cartId` na **API oficial** (`GET /checkouts`).
3. Só age se o checkout **existir**, estiver **não concluído** e casar com a
   loja. Caso contrário, ignora.

Por que é seguro sem token client-side:
- Um sinal forjado, no pior caso, faz o backend consultar um id de checkout na
  **própria** API da loja. Se não for um carrinho abandonado real, **nada
  acontece** e **nada é retornado** ao chamador (sem vazamento).
- Um `storeCtx` forjado é inofensivo: a verificação é feita **contra a loja
  reivindicada**; se o `cartId` não existir lá, rejeita.

**Camadas complementares (defense-in-depth):**
- **CORS** restrito aos domínios de storefront/checkout da Nuvemshop.
- **Rate-limit** por IP/loja (evitar abuso de recurso — o único vetor real).
- Endpoint **write-only** (nunca devolve dados do carrinho/cliente).
- (Se a doc oficial vier a expor um token de app assinado — T-futuro — adotar
  como camada extra; **não é pré-requisito** deste design.)

## 3. Dados transmitidos (minimização / LGPD)

**Sinal mínimo** — sem PII:

```jsonc
{
  "storeCtx": "<id/domínio da loja de state.store>",  // não confiável; só roteia
  "cartId":   "<checkout id>",                          // chave + dedup
  "stage":    "cart | checkout | shipping | payment",   // qualidade do sinal
  "event":    "checkout_started | order_completed | ...",
  "at":       1699999999999                             // timestamp
}
```

**Proibido no sinal:** e-mail, telefone, endereço, documento, dados de pagamento.
**PII é resolvida no backend** via API oficial (`GET /checkouts` já expõe
`contact_email/phone/name`), exatamente como o poll atual faz em
`lib/nuvemshop/carts.ts`.

## 4. Máquina de estados (por carrinho/checkout)

Um `cart:update` **não** significa abandono. Estados:

```
        cart:update (itens > 0)
  ────────────────────────────────►  ACTIVE
                                        │  checkout iniciado
                                        ▼
                                   CHECKOUT_STARTED ──(shipping/payment)──► (mesmo estado, sinal mais "quente")
                                        │                         
             order concluído ──────────┼─────────► ORDER_COMPLETED  (terminal: cancelar recuperação)
                                        │
        silêncio > TIMEOUT sem order ───┴─────────► ABANDONED  (candidato a recuperação)
```

| Estado | Alimentado por | Ação |
|---|---|---|
| **ACTIVE** | `cart:update` com itens | nada (comprador navegando) |
| **CHECKOUT_STARTED** | evento de checkout (T1) / `stage=checkout` | marca "intenção"; **emite sinal de intenção** ao backend |
| **ORDER_COMPLETED** | evento de order concluído (T1) **ou** webhook `order/paid`,`order/created` (já existe) | **terminal** → cancelar qualquer recuperação (anti-spam) |
| **ABANDONED** | ausência de ORDER_COMPLETED por `TIMEOUT` após CHECKOUT_STARTED | candidato → backend confirma via API → `enrollCartInFlows` |

**Limitação crítica do Web Worker:** quando o comprador **fecha a aba, o worker
morre** — um timer client-side **não** dispara depois disso. Por isso a decisão
de ABANDONO **é do backend**, não do worker:

- O worker emite um **sinal de intenção** cedo (em CHECKOUT_STARTED, e quando há
  contato).
- O **backend** arma o timeout: recebido o sinal, aguarda `TIMEOUT`; se **não**
  chegar `order/*` (webhook já existente) para aquele contato/checkout dentro da
  janela, confirma via `GET /checkouts` e então enrolla.
- Isso reaproveita webhooks + jobs/delays/retry/idempotência **já existentes**.

**TIMEOUT recomendado:** **30 minutos** de silêncio pós-checkout antes de
considerar ABANDONED (evita perseguir quem ainda compra). O **delay de envio**
continua sendo o configurado no fluxo (`Step.delay`) — o timeout aqui é só para
**decidir** o abandono, não para o disparo.

## 5. Deduplicação (sinal do SDK + poll fallback)

Risco: o **sinal do SDK** e o **cron de poll** criarem **dois** enrollments para
o mesmo carrinho.

**Solução — chave única `cartId` (= checkout id), reusando o padrão atômico da
Fase C:**
- Ambos os caminhos convergem para `carts/{cartId}` + `enrollCartInFlows`.
- Antes de enrollar, **claim atômico** por `cartId` (Firestore `.create()` em uma
  coleção de idempotência, ex.: `cart_enrollments/{cartId}` ou reuso de
  `webhook_events`): quem cria o doc primeiro enrolla; o outro vira no-op.
- Hoje o cron já dedup por existência de `carts/{id}` (`app/api/cron/carts`);
  basta trocar por claim atômico para cobrir a corrida SDK×poll.

Resultado: **1 carrinho → no máximo 1 enrollment**, independente da origem.

## 6. LGPD

- **Minimização:** sinal sem PII; PII buscada server-side na API oficial.
- **Base legal / opt-out:** respeitar `contact.optOut` (já existe) antes de
  inscrever.
- **Sem dados sensíveis** no browser (nada de pagamento/documento).
- **Retenção:** carrinho é efêmero (ver `LGPD_DATA_MAP.md`); `recoveryUrl`
  sensível → mesmo tratamento do mapa.
- **Transparência:** declarar a captura de sinal de checkout na política.
- **Escopo de storage** do SDK já é por app (oficial) — sem vazamento cross-app.

## 7. Fallback

**O poll atual permanece intacto** (`app/api/cron/carts`, `GET /checkouts`,
`0 9 * * *`). Se o sinal não vier (loja sem SDK, worker bloqueado, aba fechada
antes da intenção), o poll detecta como hoje. O sistema **funciona sem o SDK**
(degradado em latência). **Não remover** nesta versão.

## 8. Endpoints necessários

| Endpoint | Método | Auth | Função |
|---|---|---|---|
| `/api/storefront/cart-signal` | POST + **OPTIONS** (CORS) | Nenhuma credencial (sinal não confiável) + rate-limit | Ingerir sinal mínimo; gravar; processar assíncrono |

(Opcional) reuso de `/api/cron/dispatch` inalterado para o disparo — nenhum
endpoint novo de envio.

## 9. Mudanças necessárias no backend

- **Novo** `app/api/storefront/cart-signal/route.ts`: CORS (OPTIONS + headers),
  rate-limit, validação de forma do payload (zod), grava "sinal pendente".
- **Confirmação via API oficial:** reusar `NuvemshopClient.listCheckouts` /
  buscar o checkout específico por id com o token da loja.
- **Máquina de estados / timeout no backend:** um worker (reuso do cron 5 min já
  existente, ou um `/api/cron/cart-signals`) que, para sinais em CHECKOUT_STARTED
  há mais de `TIMEOUT` e sem `order/*`, confirma e chama `enrollCartInFlows`.
- **Dedup atômico** por `cartId` (novo claim, padrão Fase C) compartilhado entre
  sinal e poll.
- **Sem alterar** `enrollCartInFlows`, `Cart`, `Flow`, `Trigger("cart_abandoned")`,
  jobs/dispatch/retry — mudança **aditiva**.

## 10. Mudanças necessárias no módulo NubeSDK (novo pacote/app storefront)

- App NubeSDK (`src/main.ts`, `export function App(nube)`): sem DOM.
- `nube.on("cart:update", …)` + eventos de checkout/order (T1) → alimenta a
  máquina de estados local (ACTIVE/CHECKOUT_STARTED/ORDER_COMPLETED).
- Em CHECKOUT_STARTED (e quando `state.store`/`cart` disponíveis), **`fetch`** do
  sinal mínimo ao backend.
- Ler `state.store` para `storeCtx` (T2) e `cart.id` para `cartId`.
- **Nenhum** segredo embarcado. UI: nenhuma ou slot mínimo (produto não tem UI
  de vitrine).

## 11. Testes necessários

**Backend (puros/integração, padrão atual em `scripts/*.ts`):**
- Máquina de estados: `cart:update` sozinho **não** enrolla; CHECKOUT_STARTED +
  timeout sem order → candidato; ORDER_COMPLETED → cancela.
- Dedup: sinal + poll no mesmo `cartId` → **1** enrollment (claim atômico,
  inclusive concorrente).
- Verificação: `cartId` inexistente/checkout concluído → **não** enrolla.
- Opt-out: `optOut=true` → não inscreve.
- Endpoint: CORS/OPTIONS ok; payload malformado → 400; rate-limit; nunca
  retorna PII.
- Timeout/relógio: janela de 30 min respeitada; order dentro da janela cancela.

**Módulo SDK (com harness do `create-nube-app`):**
- Transições de estado a partir de eventos simulados; sinal só em
  CHECKOUT_STARTED; nenhum PII no corpo; roda sem `window`/DOM.

## 12. Riscos

- **T1/T2 não enumerados na doc pública** — resolver lendo
  `@tiendanube/nube-sdk-types` no início da implementação (baixo risco).
- **Aba fechada mata o worker** — mitigado movendo o timeout para o backend
  (webhooks + cron), não para o cliente.
- **Abuso do endpoint** (sinal não confiável) — mitigado por CORS + rate-limit +
  verificação server-side + endpoint write-only.
- **Duplicidade SDK×poll** — mitigada por claim atômico por `cartId`.
- **Falso abandono** (refresh/navegação) — mitigado por confirmação via API +
  timeout de 30 min.
- **Prazo de homologação (30/08/2026)** — implementar com folga.

## 13. Sequência de implementação (quando autorizado)

1. Confirmar **T1** (eventos checkout/order) e **T2** (store id) em
   `@tiendanube/nube-sdk-types`.
2. Backend: endpoint `cart-signal` (CORS + rate-limit + zod) — **write-only**.
3. Backend: verificação via API oficial + **claim atômico** por `cartId`
   (compartilhado com o poll).
4. Backend: máquina de estados + timeout (reuso de cron) → `enrollCartInFlows`.
5. Módulo NubeSDK mínimo: eventos → estado → `fetch` do sinal mínimo.
6. Testes (backend + SDK). Poll mantido como fallback.
7. Loja demo + tag SDK (`NUBESDK_DEMO_VALIDATION_CHECKLIST.md`) → flag
   "Uses NubeSDK" só após validação real.

---

## Classificação

**`READY_TO_IMPLEMENT`**

- O **mecanismo oficial e seguro** de comunicação está determinado: **`fetch` do
  Web Worker → backend com CORS**, **sem** segredo client-side, com o **backend
  como âncora de confiança** (re-verificação via API oficial usando o token
  server-side). Isso resolve a *prioridade máxima* da missão.
- A arquitetura (máquina de estados, timeout no backend, dedup por `cartId`,
  fallback por poll, LGPD por minimização) é **compatível e aditiva** ao backend
  atual, sem tocar contratos existentes.
- Os únicos itens pendentes (**T1** nomes de eventos, **T2** campo de store id)
  são **lookups no pacote oficial de types** — 1º passo da implementação, sem
  impacto na segurança nem na arquitetura. **Não** configuram
  `BLOCKED_BY_OFFICIAL_SDK_INFORMATION`.

## Fontes oficiais consultadas
- NubeSDK Overview — https://dev.tiendanube.com/docs/applications/nube-sdk/overview
- Browser APIs (fetch/CORS/worker) — https://dev.nuvemshop.com.br/en/docs/applications/nube-sdk/browser-apis
- First Steps — https://dev.nuvemshop.com.br/en/docs/applications/nube-sdk/first-steps
- Script Structure — https://dev.nuvemshop.com.br/en/docs/applications/nube-sdk/script-structure
- Repositório/types — https://github.com/TiendaNube/nube-sdk (`packages/types`)
