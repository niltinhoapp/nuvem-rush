# LGPD — Mapa de Dados (Nuvem Rush)

> **Status:** planejamento. Este documento **descreve** o que existe hoje no
> Firestore. Nenhuma exclusão/anonimização foi implementada.
> Fonte: `types/index.ts` + usos reais de `col(storeId, …)` / `db.collection`.
> Data: agosto/2026. Branch de referência: `fix/pre-homologation-p0`.

## Arquitetura de armazenamento

Tudo é **multi-tenant por loja**, sob `stores/{storeId}`:

```
stores/{storeId}                         (documento da loja)
  ├─ contacts/{contactId}
  ├─ orders/{orderId}
  ├─ carts/{cartId}
  ├─ products/{productId}
  ├─ flows/{flowId}
  ├─ templates/{templateId}
  ├─ enrollments/{enrollmentId}
  ├─ jobs/{jobId}
  ├─ logs/{autoId}
  ├─ lgpd_requests/{autoId}
  └─ webhook_events/{event:resourceId}
```

Não há coleção top-level com PII além de `stores`. O único identificador
top-level é o `storeId` (= `user_id` da Nuvemshop).

## Legenda

- **PII** = dado pessoal (titular = consumidor final da loja) ou segredo.
- **Excluir / Anonimizar / Preservar** = ação recomendada no `customers/redact`
  ou `store/redact` (ver o Plano). "Preservar" pode significar preservar de
  forma anonimizada.

---

## 1. `stores/{storeId}` — documento da loja

| Campo | Conteúdo | PII? |
|---|---|---|
| `storeId`, `ownerUid`, `scope`, `plan`, `status`, `installedAt` | identidade/estado da loja | Não (dado do lojista, não do consumidor) |
| `accessToken` | **token OAuth da Nuvemshop** (cripto em repouso) | **Segredo** |
| `whatsapp.accessToken` | **token Meta/WhatsApp do lojista** (Embedded Signup) | **Segredo** |
| `whatsapp.wabaId/phoneNumberId/templateName/...` | config do canal WhatsApp da loja | Não (dado do lojista) |
| `quotas.*` | contadores de uso (e-mail/WhatsApp) | Não |

- **Finalidade:** autenticar chamadas à Nuvemshop e à Meta; controle de plano/cota.
- **Relação:** raiz do tenant (`storeId`). Não contém PII do consumidor.
- **store/redact:** **Excluir** o documento (inclui tokens).
- **customers/redact:** **Preservar** (não é dado do titular).
- **Retenção:** enquanto a loja estiver instalada. Após `app/uninstalled`, ver política.
- **Risco de apagar:** apagar tokens = perder acesso à loja (esperado no uninstall/redact).

## 2. `stores/{storeId}/contacts/{contactId}` — **núcleo do PII do titular**

| Campo | PII? |
|---|---|
| `name`, `email`, `phone` | **Sim (PII direto)** |
| `nsCustomerId` | Sim (id do cliente na Nuvemshop) |
| `tags`, `ordersCount`, `totalSpent`, `optOut`, `lastOrderAt` | Derivado/perfil |

- **Finalidade:** destinatário das automações (e-mail/WhatsApp) e avaliação de regras.
- **Relação:** **é o titular**. Chave: `contactId`; liga a `nsCustomerId`/email/phone.
- **customers/redact:** **Anonimizar/Excluir** (name/email/phone → nulo/hash).
- **store/redact:** **Excluir**.
- **Retenção:** enquanto a loja usa o app; `optOut=true` deve ser **preservado**
  mesmo após anonimização (para não reenviar — obrigação de supressão).
- **Risco de apagar:** manter `optOut` e um id opaco evita reenvio indevido.

## 3. `stores/{storeId}/orders/{orderId}`

| Campo | PII? |
|---|---|
| `contactId` | Vínculo ao titular |
| `nsOrderId`, `total`, `items[]`, `status`, `paidAt`, `fulfilledAt` | Transacional |
| `trackingCode`, `trackingUrl`, `shippingStatus` | Logística (pode ser sensível) |

- **Finalidade:** contexto do pós-venda (rastreio, valor, itens) e placeholders.
- **Relação:** `contactId` → titular; `nsOrderId` → pedido na Nuvemshop.
- **customers/redact:** **Anonimizar o vínculo** (`contactId` → id opaco), **preservar**
  o registro transacional/financeiro.
- **store/redact:** **Excluir**.
- **Retenção:** ⚠️ **dado financeiro/fiscal** — a fonte primária é a Nuvemshop.
  Podemos excluir nossa cópia derivada, mas o vínculo com o titular deve ser
  quebrado, não necessariamente o valor/agregado.
- **Risco de apagar:** apagar cru pode remover base de auditoria de disparo
  (por que uma mensagem foi enviada). Preferir anonimizar o vínculo.

## 4. `stores/{storeId}/carts/{cartId}`

| Campo | PII? |
|---|---|
| `contactId` | Vínculo ao titular |
| `recoveryUrl` | **Pode conter token/identificador do checkout** |
| `nsCheckoutId`, `total`, `items[]`, `status`, timestamps | Transacional |

- **Finalidade:** recuperação de carrinho abandonado.
- **customers/redact:** **Excluir** (dado efêmero; `recoveryUrl` é sensível).
- **store/redact:** **Excluir**.
- **Retenção:** curta (carrinho abandonado perde valor rápido).
- **Risco de apagar:** baixo.

## 5. `stores/{storeId}/products/{productId}`

- **Conteúdo:** catálogo (sku, nome, marca, categoria, preço). **Sem PII do titular.**
- **customers/redact:** **Preservar**. **store/redact:** **Excluir** (dado da loja).
- **Retenção:** enquanto instalado. **Risco:** nenhum.

## 6. `stores/{storeId}/flows/{flowId}`

- **Conteúdo:** automações (trigger, steps, stats). **Sem PII do titular** (config da loja).
- **customers/redact:** **Preservar**. **store/redact:** **Excluir**.
- **Risco:** nenhum (não referencia titular específico).

## 7. `stores/{storeId}/templates/{templateId}`

- **Conteúdo:** `subject`/`html` de e-mail (conteúdo da loja). Em tese sem PII;
  ⚠️ **pode conter PII se o lojista digitou dados no corpo** (raro).
- **customers/redact:** **Preservar**. **store/redact:** **Excluir**.
- **Risco:** baixo.

## 8. `stores/{storeId}/enrollments/{enrollmentId}`

| Campo | PII? |
|---|---|
| `contactId` | Vínculo ao titular |
| `flowId`, `orderId`/`cartId`, `currentStep`, `status`, `startedAt` | Execução |

- **Finalidade:** liga um titular a uma automação em andamento.
- **customers/redact:** **Excluir** os enrollments do titular **e cancelar** jobs
  agendados vinculados (senão dispararíamos para alguém que pediu remoção).
- **store/redact:** **Excluir**.
- **Risco de apagar:** ⚠️ é preciso **cancelar os jobs** juntos para não enviar.

## 9. `stores/{storeId}/jobs/{jobId}`

| Campo | PII? |
|---|---|
| `enrollmentId`, `flowId`, `stepIndex`, `channel`, `runAt`, `status` | Execução |
| `lastError`, `attempts`, `nextAttemptAt`, `claimedAt` | Diagnóstico (novos, Fase E) |

- **Finalidade:** unidade de disparo agendado. **Sem PII direto**, mas referencia
  enrollment → contato.
- **customers/redact:** **Cancelar/Excluir** os jobs `scheduled`/`processing` do
  titular (impede envio futuro). Jobs já `sent` podem ser preservados como log.
- **store/redact:** **Excluir**.
- **Risco de apagar:** deixar um job `scheduled` órfão dispararia mensagem indevida.

## 10. `stores/{storeId}/logs/{autoId}`

| Campo | PII? |
|---|---|
| `jobId`, `channel`, `status`, `at`, `error?`, `attempt?` | Auditoria de envio |

- **Finalidade:** trilha de auditoria (o que foi enviado, quando, sucesso/erro).
- **PII:** normalmente **não** contém e-mail/telefone (só `jobId`), **mas** o campo
  `error` pode conter a resposta crua da API (⚠️ eventualmente com telefone/e-mail).
- **customers/redact:** **Anonimizar** entradas cujo `error` contenha PII; preservar
  o restante como auditoria.
- **store/redact:** **Excluir**.
- **Retenção:** ⚠️ útil para auditoria/suporte. Preferir anonimizar a apagar tudo.

## 11. `stores/{storeId}/lgpd_requests/{autoId}`

| Campo | PII? |
|---|---|
| `type` (store/redact, customers/redact, customers/data_request) | — |
| `payload` (webhook cru da Nuvemshop) | **Pode conter id/e-mail do cliente** |
| `status`, `at` | controle |

- **Finalidade:** **registro da própria solicitação LGPD** (prova de recebimento).
- **customers/redact:** **Preservar** (é a evidência de que a solicitação foi feita
  e atendida) — mas o `payload` deve guardar o mínimo necessário.
- **store/redact:** avaliar preservar fora do tenant (prova de conformidade) ou excluir.
- **Risco de apagar:** ⚠️ apagar destrói a **evidência de conformidade** — preservar.

## 12. `stores/{storeId}/webhook_events/{event:resourceId}` (novo — Fase C)

| Campo | PII? |
|---|---|
| doc id = `event:resourceId` (ex.: `order_paid:12345`) | id de pedido, **sem PII direto** |
| `at`, `status` | idempotência |

- **Finalidade:** deduplicação de webhooks (idempotência). TTL natural curto.
- **customers/redact:** **Preservar** (não identifica pessoa; só id de pedido).
- **store/redact:** **Excluir** com a loja.
- **Risco:** nenhum.

---

## Resumo por ação

| Coleção | store/redact | customers/redact | data_request (exportar?) |
|---|---|---|---|
| stores (doc) | Excluir (tokens) | Preservar | Não (dado do lojista) |
| contacts | Excluir | **Anonimizar/Excluir** | **Sim** |
| orders | Excluir | Anonimizar vínculo | **Sim** |
| carts | Excluir | Excluir | Sim |
| products | Excluir | Preservar | Não |
| flows | Excluir | Preservar | Não |
| templates | Excluir | Preservar | Não |
| enrollments | Excluir | Excluir + cancelar jobs | Sim (histórico) |
| jobs | Excluir | Cancelar/Excluir agendados | Parcial |
| logs | Excluir | Anonimizar `error` c/ PII | Parcial |
| lgpd_requests | Preservar/mover | **Preservar** (evidência) | — |
| webhook_events | Excluir | Preservar | Não |

## Segredos/tokens (atenção especial)

- `stores.accessToken` (Nuvemshop) e `stores.whatsapp.accessToken` (Meta) —
  **revogar/remover** no `app/uninstalled` e no `store/redact`.
- Observação herdada da auditoria: `whatsapp.accessToken` tem TODO de
  criptografia em repouso (KMS) — recomendável antes do go-live amplo.
