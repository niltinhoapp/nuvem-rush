# NubeSDK — Arquitetura proposta para Carrinho Abandonado

> **Planejamento.** Nada implementado. Complementa `NUBESDK_CODE_AUDIT.md`.
> O modelo atual (poll da Abandoned Checkout API) **permanece como fallback**.

## 1. O NubeSDK deve participar do carrinho abandonado?

**Sim — é o único caso de uso de storefront/checkout do produto e onde o SDK
agrega valor funcional real** (detecção em tempo real, etapa do checkout e dados
de contato mais confiáveis), além de atender ao requisito oficial de adequação
ao NubeSDK **com uma integração verdadeira**, não "para constar".

**Princípio:** o NubeSDK é **sinalizador**, não fonte de verdade. Ele emite um
"sinal de abandono provável" para o backend; o backend continua dono da regra de
negócio, do agendamento (jobs/retry/idempotência já existentes) e do envio.

## 2. Fluxo proposto

```
Storefront/Checkout (Web Worker, NubeSDK)
   │  escuta cart:update / checkout:ready / customer:update
   │  mantém um "snapshot" mínimo do carrinho (id, valor, itens, contato)
   │  detecta inatividade/saída (heurística de abandono)
   ▼
POST /api/storefront/cart-signal   (endpoint NOVO, autenticado)
   │  { storeId, cartId, stage, contactHint, at, sig }
   ▼
Backend Nuvem Rush
   │  valida origem + dedup por cartId
   │  confirma/enriquece via GET /checkouts (fonte oficial) — opcional
   │  grava carts/{cartId} (mesmo formato atual) + enrollCartInFlows
   ▼
Motor existente (jobs, delays, retry, idempotência, dispatch) — inalterado
```

Fallback: o **cron diário atual continua rodando**; se o sinal do SDK não vier
(loja sem SDK, worker bloqueado), o poll pega o carrinho como hoje.

## 3. Dados necessários (mínimos — LGPD)

| Dado | Uso | Enviar ao backend? |
|---|---|---|
| `storeId` | multi-tenant | ✅ |
| `cartId` / checkout id | chave/dedup | ✅ |
| `stage` (cart / shipping / payment) | qualidade do sinal | ✅ |
| valor total, itens (ids/qtd) | contexto do fluxo | ✅ (sem PII) |
| e-mail/telefone | destinatário | ⚠️ **preferir NÃO enviar**; buscar via API oficial no backend |
| endereço, pagamento, documento | — | ❌ **nunca** |

**Privacidade:** o SDK deve enviar o **mínimo** (idealmente só `cartId`+`stage`);
o backend resolve e-mail/telefone pela **Abandoned Checkout API** (fonte já
usada), evitando trafegar PII pelo canal do browser.

## 4. Eventos NubeSDK relevantes

| Evento | Utilidade p/ Nuvem Rush |
|---|---|
| `cart:update` | detectar itens/valor e mudança de intenção |
| `checkout:ready` | comprador entrou no checkout (sinal forte) |
| `customer:update` | há contato identificado (decide se dá p/ recuperar) |
| `shipping:update` | chegou a frete (intenção alta) |
| `payment:update` | chegou a pagamento (intenção altíssima) |
| `order:update` | **compra concluída → cancelar recuperação** (anti-spam) |
| `nube.getState().cart` | snapshot para montar o sinal |

**Úteis ao produto:** `checkout:ready`, `cart:update`, `customer:update`,
`order:update` (para **não** perseguir quem comprou). `shipping/payment:update`
melhoram a definição de abandono (quanto mais fundo parou, mais quente o lead).

## 5. Definição de "abandono" com segurança

- Sinal de abandono = houve `checkout:ready`/`cart:update` com contato, **e**
  não veio `order:update` dentro de uma janela (ex.: 30–60 min), **e** o carrinho
  aparece como não `completed` na API.
- O backend **confirma** com a fonte oficial antes de inscrever (evita falso
  abandono por navegação/refresh).

## 6. Endpoint novo

**Sim, é necessário** um endpoint de ingestão: `POST /api/storefront/cart-signal`.

- Recebe o sinal do worker do storefront.
- Idempotente e rápido (grava sinal + responde 200; processamento assíncrono).

## 7. Autenticação da origem

O NubeSDK roda no browser do comprador (não confiável). Opções (validar na doc
oficial qual está disponível):
- **Token de app assinado pela Nuvemshop** para o contexto do storefront (análogo
  ao session token do Nexo no Admin) → o backend valida assinatura.
- Se indisponível: **HMAC com segredo do app** + o backend **sempre reconferindo**
  o `cartId` contra `GET /checkouts` (a API oficial é a autoridade; o sinal só
  antecipa). Nunca confiar em PII vinda do browser.

## 8. Deduplicação

- Chave `cartId` (checkout id) — **mesma** já usada no cron
  (`carts/{checkoutId}`). Reutilizar a coleção `webhook_events`/`carts` para
  garantir: sinal do SDK **e** poll não criam enrollment duplicado.
- Claim atômico (Firestore `.create()`), padrão já implementado na Fase C.

## 9. LGPD

- **Minimização:** SDK envia o mínimo; PII resolvida no backend via API oficial.
- **Base legal / opt-out:** respeitar `contact.optOut` (já existe) antes de
  inscrever. Não capturar dados sensíveis no checkout.
- **Retenção:** carrinho é efêmero (ver `LGPD_DATA_MAP.md`); `recoveryUrl` é
  sensível → tratar como no mapa.
- **Transparência:** o app deve declarar a captura de sinal de checkout.

## 10. Fallback e compatibilidade com o backend atual

- **Fallback:** cron diário permanece; sistema funciona **sem** o SDK (degradado
  em latência), garantindo continuidade se o worker falhar.
- **Compatibilidade:** o sinal do SDK converge para **o mesmo `carts/{cartId}` +
  `enrollCartInFlows`** já existentes → **motor de jobs/retry/idempotência
  inalterado**. A mudança é **aditiva** (uma nova porta de entrada), sem quebrar
  contratos `Cart`/`Flow`/`Trigger("cart_abandoned")`.

## 11. Resumo

NubeSDK entra **só** para antecipar/enriquecer o carrinho abandonado, como
**camada de sinal** sobre o backend atual. Endpoint novo + autenticação de
origem + dedup por `cartId` + PII resolvida no servidor. Fallback pelo poll.
Cenário **B** do audit.
