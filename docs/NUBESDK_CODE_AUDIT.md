# NubeSDK — Auditoria de Código (Nuvem Rush)

> **Somente auditoria.** Nenhum arquivo alterado, nenhuma dependência instalada.
> Fonte de verdade: `main`. Base analisada: código real + documentação oficial
> Nuvemshop. Data: agosto/2026.

## Resumo executivo

O Nuvem Rush é **exclusivamente um app incorporado ao Admin** (Next.js + React +
Nimbus + Nexo em iframe) com **backend server-side** (API routes + webhooks +
crons Firebase/Vercel). **Não há hoje nenhum runtime de storefront nem de
checkout**: nenhuma página servida ao consumidor, nenhum script injetado na
loja, nenhuma leitura de DOM da vitrine, nenhum NubeSDK instalado ou referenciado.

- **NubeSDK no código:** `@tiendanube/nube-*` → **0 ocorrências**. Única dep
  `@tiendanube` é o **Nexo** (`@tiendanube/nexo`, admin embedado).
- **Única funcionalidade que toca o mundo da vitrine:** **carrinho abandonado**,
  detectado hoje **100% no backend** por *polling* da API oficial
  `GET /checkouts` (Abandoned Checkout), via cron diário. Sem código no browser
  do comprador.

→ O único ponto onde o NubeSDK teria valor **funcional** é o **carrinho
abandonado** (storefront/checkout). Ver `NUBESDK_CART_ARCHITECTURE.md`.

## Mapa `window` / `document` / DOM / browser

Legenda de classe: **A** Admin/Nexo/iframe · **B** Landing pública · **C**
Backend/server-only · **D** Storefront · **E** Checkout · **F** Legado · **G**
Não relacionado.

| Arquivo | Uso | Classe | Observação |
|---|---|---|---|
| `app/page.tsx` | `window.self!==window.top`, `window.location.replace` | **B** | Landing raiz; detecta iframe e redireciona p/ `/dashboard`. |
| `app/dashboard/page.tsx` | `getNexo()` (usa window), `window.open('/connect-whatsapp')`, `window.location.reload` | **A** | Tela principal do app embedado. `window.open` abre popup do Embedded Signup. |
| `app/dashboard/flows/[id]/page.tsx` | `dynamic(..., { ssr:false })` | **A** | Carrega o Flow Builder só no client (React Flow precisa de window). |
| `components/flow-builder/FlowBuilder.tsx`, `nodes.tsx` | React Flow (`@xyflow/react`) | **A** | Canvas do construtor, dentro do Admin. |
| `app/connect-whatsapp/page.tsx` | `document.createElement('script')` (Facebook `sdk.js`), `window.FB`, `window.addEventListener('message')`, `postMessage`, `window.location.search` | **A** | **Meta Embedded Signup** (conexão WhatsApp), aberto em nova aba a partir do Admin. **Não é storefront** — é o SDK da Meta, não da loja. |
| `app/instalado/page.tsx`, `app/privacidade/page.tsx`, `app/suporte/page.tsx` | páginas estáticas | **B/G** | Info/legal; sem DOM dinâmico. |
| `lib/nexo.ts` | init do Nexo (window) | **A** | Ponte admin↔Nuvemshop. |
| `lib/**` (channels, dispatch, rules, nuvemshop, firebase, auth, webhooks) | — | **C** | Server-only; sem acesso a browser. |

**Conclusão do mapa:** todo uso de `window/document` é **A (Admin embedado)** ou
**B (landing)**. O único `createElement('script')` carrega o **SDK da Meta**
(fluxo de conexão WhatsApp no Admin), **não** um script na vitrine. **Zero** em
classes **D (storefront)** e **E (checkout)**.

## Mapa storefront / checkout

**`NO_STOREFRONT_RUNTIME_FOUND`.**

- Nenhuma rota/página servida ao consumidor final.
- Nenhum script injetado na loja (nenhum `ScriptTag`/`Storefront App Fragment`).
- Nenhuma leitura de DOM da vitrine, nenhum banner, nenhum slot, nenhum tracking
  de cliques, nenhuma captura de dados no browser do comprador.
- Rotas existentes (todas Admin/backend): landing `/`, `/dashboard`,
  `/dashboard/flows/[id]`, `/connect-whatsapp`, `/instalado`, `/privacidade`,
  `/suporte`; APIs `auth/callback`, `crons/*`, `dispatch/*`, `flows/*`,
  `webhooks/*`, `whatsapp/*`.

## Funcionamento atual do carrinho abandonado

Fluxo **inteiramente server-side**:

1. **Origem do dado:** API oficial Nuvemshop `GET /checkouts`
   (`lib/nuvemshop/client.ts::listCheckouts`, `sort_by=created-at-descending`,
   `created_at_min` opcional).
2. **Sem webhook:** a Nuvemshop **não** oferece webhook de carrinho abandonado
   (comentado no próprio código). → **polling**.
3. **Cron:** `app/api/cron/carts/route.ts`, agendado `0 9 * * *` (**1×/dia**),
   protegido por `CRON_SECRET`, `maxDuration=60`.
4. **Processamento:** para cada checkout com `completed_at == null` (não
   finalizado), **dedup por id** (`carts/{checkoutId}` já existe? pula) →
   `syncAbandonedCheckout` normaliza contato+carrinho → `enrollCartInFlows`
   inscreve nos fluxos com gatilho `cart_abandoned`.
5. **Dados capturados** (`lib/nuvemshop/carts.ts`): `contact_email`,
   `contact_phone`, `contact_name`, itens (sku/productId/qty/price), `total`,
   `abandoned_checkout_url` (link de recuperação), `created_at`.
6. **`abandonedAt`** = `Date.now()` no momento do poll (**não** o instante real
   do abandono). `contactId` derivado de `email:`/`phone:`/`checkout:`.
7. **Evento que inicia o fluxo:** a **inscrição** feita pelo cron
   (`enrollCartInFlows`), não um evento do browser.

### Respostas obrigatórias (§3)

1. **Webhook oficial p/ carrinho abandonado?** ❌ Não existe (por isso poll).
2. **Existe polling?** ✅ Sim — cron diário sobre `GET /checkouts`.
3. **Busca periódica de checkouts/carts?** ✅ Sim (`listCheckouts`).
4. **Código no storefront?** ❌ Não.
5. **Código no checkout?** ❌ Não.
6. **Script injetado na loja?** ❌ Não.
7. **Backend detecta abandono sozinho?** ✅ Sim, via Abandoned Checkout API —
   **mas** só quando a Nuvemshop marca o checkout como abandonado e ele aparece
   no `GET /checkouts`; e apenas na varredura diária.
8. **Limitações:** (a) **latência de até ~24h** (cron 1×/dia); (b) `abandonedAt`
   impreciso (hora do poll, não do abandono); (c) depende da API popular o
   checkout; (d) sem sinais de intenção (etapa do checkout, frete, pagamento);
   (e) e-mail/telefone só se o comprador os preencheu **e** a API os expõe.
9. **Precisão atual:** grosseira — janela diária; sem tempo real; sem etapa.
10. **Dá p/ saber que abandonou sem NubeSDK?** ✅ **Sim** — já funciona pela
    Abandoned Checkout API. NubeSDK **não é obrigatório** para detectar; ele
    **melhora** (tempo real, etapa, dados mais ricos).

## Gaps

- **Latência:** detecção diária vs. abandono em minutos.
- **Precisão temporal:** `abandonedAt` = hora do poll.
- **Sem tempo real / sem etapa:** não sabemos se o comprador chegou a
  frete/pagamento (sinais fortes de intenção).
- **Homologação:** requisito oficial de **validação/adequação ao NubeSDK** para
  novas instalações após 30/08/2026 — hoje **não atendido** (nenhum SDK real).

## Possíveis usos do NubeSDK

Único caso funcional real: **carrinho abandonado/checkout** — capturar
`cart:update` / `checkout:ready` / `customer:update` no storefront e sinalizar o
backend em **tempo real**, com etapa e dados de contato mais confiáveis.
Detalhamento em `NUBESDK_CART_ARCHITECTURE.md`. **Não há** outra funcionalidade
de vitrine no produto (sem banner, sem alteração de carrinho, sem bloqueio de
checkout, sem tracking).

## Recomendação arquitetural (resumo)

- **Admin:** permanece **React + Nimbus + Nexo + iframe** — é o modelo oficial
  para apps embedados; **não** migrar para NubeSDK (sem base oficial p/ isso).
- **Backend/webhooks/crons:** permanecem.
- **NubeSDK:** introduzir um **módulo de storefront mínimo e real** dedicado ao
  **carrinho abandonado** (Cenário B), que sinaliza o backend. Isso atende ao
  requisito de homologação **com função verdadeira** (não "para constar") e
  melhora a precisão do único recurso de vitrine.

## Riscos

- **Prazo de homologação** (30/08/2026) vs. nada implementado hoje — risco de
  novas instalações bloqueadas.
- **LGPD:** capturar dados de checkout no browser exige minimização e base legal
  (ver arquitetura).
- **Duplicidade:** sinal do SDK + poll atual precisam de dedup por `cartId`.
- **Complexidade nova:** Web Worker sem `window/DOM`, comunicação por
  eventos/slots — paradigma diferente do Admin atual.
