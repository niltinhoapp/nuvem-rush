# LGPD — Plano de Implementação (Nuvem Rush)

> **Status:** planejamento, **aguardando aprovação**. Nada aqui está implementado.
> **Nenhum purge, endpoint destrutivo ou alteração de Firestore foi feito.**
> Complementa `LGPD_DATA_MAP.md`. Branch: `fix/pre-homologation-p0`.

## 0. Estado atual (o que já existe no código)

`app/api/webhooks/nuvemshop/route.ts` hoje:

| Evento | Comportamento atual |
|---|---|
| `store/redact` | grava `lgpd_requests` (`status:"pending"`) — **não apaga nada** |
| `customers/redact` | grava `lgpd_requests` — **não apaga nada** |
| `customers/data_request` | grava `lgpd_requests` — **não compila nada** |
| `app/uninstalled` | `stores/{id}.status = "uninstalled"` + **TODO** de purga |

O webhook já valida **HMAC** e é **idempotente** (Fase C, para eventos `order/*`;
os eventos LGPD ainda não passam pelo dedup — ver §6).

## 1. Princípios

1. **Processamento assíncrono e idempotente.** O receiver continua respondendo
   rápido: registra a solicitação em `lgpd_requests` (já faz) e um **worker**
   (cron dedicado ou extensão do cron existente) processa a fila. Reprocessar a
   mesma solicitação não pode causar dano.
2. **Anonimizar > apagar**, quando houver base de retenção (auditoria/financeiro).
3. **Supressão persistente:** `optOut` e evidência LGPD sobrevivem à anonimização.
4. **Duas fases sempre:** (a) **desativar/cancelar** efeitos (jobs) imediatamente;
   (b) **purga/anonimização** após janela de retenção.
5. **Confirmação humana no início:** a purga real só liga após aprovação + um
   *dry-run* que apenas conta o que seria afetado (sem escrever).

## 2. `store/redact` — remoção da loja inteira

Gatilho: a Nuvemshop sinaliza que **todos os dados da loja** devem ser removidos.

**Escopo:** apagar toda a subárvore `stores/{storeId}/*` **e** o documento
`stores/{storeId}`.

**Ordem proposta:**
1. `stores/{storeId}.status = "redacting"` (trava novos disparos).
2. Cancelar jobs `scheduled`/`processing` (evita envio durante a purga).
3. Apagar subcoleções em lote: `jobs`, `enrollments`, `carts`, `orders`,
   `contacts`, `products`, `flows`, `templates`, `logs`, `webhook_events`.
4. **Preservar evidência**: mover `lgpd_requests` (ou um resumo) para um espaço
   de conformidade **fora do tenant** antes de apagar o resto (prova de atendimento).
5. Revogar/remover tokens: `accessToken` (Nuvemshop) e `whatsapp.accessToken` (Meta).
6. Apagar o documento `stores/{storeId}`.

**Retenção:** executar dentro do prazo exigido pela Nuvemshop/LGPD (definir SLA,
ex.: até 30 dias). Registrar `completedAt` na evidência.

**Riscos:** dado financeiro é derivado (fonte primária = Nuvemshop), então a
exclusão total é aceitável aqui; garantir a evidência antes de apagar.

## 3. `customers/redact` — remoção de UM titular

Gatilho: um **consumidor específico** pediu remoção. **Não pode afetar outros.**

### 3.1 Localização SEGURA do titular (crítico)

Prioridade de matching (do mais forte ao mais fraco):
1. **`nsCustomerId`** vindo do `payload` do webhook — **chave preferencial**
   (id oficial da Nuvemshop, sem ambiguidade).
2. `email` exato (case-insensitive) — fallback.
3. `phone` **normalizado completo** (com DDI) — fallback.

> ⚠️ **Não** usar "últimos 8 dígitos" para redact (o `markOptOut` atual usa esse
> atalho e pode casar o contato errado — aceitável para opt-out, **inaceitável**
> para exclusão). Para redact, exigir match forte; em ambiguidade (>1 contato ou
> nenhum id confiável), **marcar a solicitação como `needs_review`** e não apagar.

### 3.2 Ações por coleção (ver mapa)
- `contacts/{id}` do titular: **anonimizar** `name/email/phone → null`, `nsCustomerId
  → hash opaco`; **preservar `optOut=true`** (supressão).
- `enrollments` do `contactId`: **excluir** e **cancelar** seus jobs.
- `jobs` `scheduled`/`processing` do titular: **cancelar** (não enviar).
- `orders`/`carts` do titular: **anonimizar o vínculo** (`contactId → id opaco`);
  `carts` podem ser excluídos (efêmeros, `recoveryUrl` sensível).
- `logs` cujo `error` contenha PII do titular: **anonimizar** o campo `error`.
- `lgpd_requests`: **preservar** (evidência).

### 3.3 Garantia
Após o processo: nenhum `job` futuro para o titular; nenhum campo `name/email/phone`
recuperável; `optOut` mantido. Operação **idempotente** (rodar 2× = mesmo efeito).

## 4. `customers/data_request` — portabilidade/acesso

Gatilho: o titular quer **saber/receber** os dados que mantemos sobre ele.

**Compilar (somente leitura):**
- `contacts/{id}`: name, email, phone, tags, ordersCount, totalSpent, optOut, lastOrderAt.
- `orders` do `contactId`: nsOrderId, total, items, status, datas, rastreio.
- `carts` do `contactId`: total, items, status, datas.
- `enrollments` do `contactId`: fluxos em que entrou + status.
- `logs`/`jobs`: histórico de mensagens enviadas ao titular (canal, data, status).

**Produto:** gerar um **JSON** (e opcionalmente um resumo legível) com esses dados,
gravado em local seguro e disponibilizado ao lojista/titular pelo canal que a
Nuvemshop especificar. Registrar em `lgpd_requests` (`status:"fulfilled"`,
`generatedAt`). **Sem** expor dados de outros titulares.

**Segurança:** matching do titular idêntico ao §3.1 (id forte).

## 5. `app/uninstalled` — política pós-desinstalação

Desinstalar **não** é o mesmo que `store/redact`, mas inicia a contagem de retenção.

**Imediato (no webhook):**
1. `stores/{storeId}.status = "uninstalled"` (já feito hoje).
2. **Cancelar** todos os jobs `scheduled`/`processing` da loja (parar disparos).
3. **Revogar/remover tokens** (`accessToken` Nuvemshop, `whatsapp.accessToken`) —
   não devemos reter credenciais de uma loja que nos desinstalou.

**Janela de retenção (proposta): 30 dias** (permite reinstalação sem perda total;
ajustar ao que a Nuvemshop exigir).

**Purga posterior (worker, após a janela):**
- Se não houve reinstalação: aplicar `store/redact` (§2) na loja.
- Registrar evidência de purga.

> **Observação:** a purga posterior exige um cron/worker que varra lojas
> `uninstalled` com `uninstalledAt` além da janela. Não existe hoje — é parte
> desta implementação (futura, sob aprovação).

## 6. Infra necessária (a construir, sob aprovação)

1. **Campo `uninstalledAt`** em `stores` (registrar no `app/uninstalled`).
2. **Idempotência dos eventos LGPD**: reutilizar `webhook_events` (Fase C) para
   `store/redact`/`customers/redact`/`data_request` também (evitar processar 2×).
3. **Worker de LGPD**: cron dedicado (`/api/cron/lgpd`) que consome
   `lgpd_requests` `pending` → executa a ação → marca `done`/`needs_review`.
   Protegido por `CRON_SECRET`, fail-closed (mesmo padrão do dispatch).
4. **Dry-run obrigatório**: primeira versão apenas **conta e loga** o que seria
   afetado, sem escrever. Só após revisão liga o modo destrutivo.
5. **Exclusão em lote segura**: paginação/batched deletes (evitar timeouts).
6. **Evidência de conformidade** fora do tenant (coleção `compliance_log` ou
   bucket), com id da solicitação, escopo, contagem afetada, timestamps.

## 7. O que NÃO fazer nesta fase (respeitado)

- ❌ Não apagar/anonimizar dados reais.
- ❌ Não criar endpoints destrutivos.
- ❌ Não alterar Firestore.
- ❌ Não ligar worker de purga.

## 8. Sequência sugerida (quando aprovado)

1. `data_request` (somente leitura — risco zero, valor de conformidade imediato).
2. `app/uninstalled`: cancelar jobs + revogar tokens + `uninstalledAt` (não destrutivo além de tokens).
3. Idempotência LGPD + worker em **dry-run**.
4. `customers/redact` (matching forte + anonimização) — com dry-run antes.
5. `store/redact` + purga pós-janela — por último, com evidência.
