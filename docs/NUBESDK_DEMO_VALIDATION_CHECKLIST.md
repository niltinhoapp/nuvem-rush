# NubeSDK — Checklist de Validação em Loja Demo (tag SDK)

> Roteiro para validar a integração NubeSDK numa loja de teste com a **tag SDK**
> solicitada à Nuvemshop. **Planejamento** — nada implementado ainda.

## 0. Pré-requisitos ANTES de solicitar a tag SDK

- [ ] Módulo NubeSDK de storefront **mínimo e real** implementado (não "para
      constar"): escuta `checkout:ready` / `cart:update` / `customer:update` /
      `order:update` e emite sinal.
- [ ] Endpoint `POST /api/storefront/cart-signal` no backend (autenticado, dedup).
- [ ] Autenticação de origem definida e testada (token assinado da Nuvemshop ou
      HMAC + reconferência via `GET /checkouts`).
- [ ] Fallback: cron diário de `GET /checkouts` continua ativo.
- [ ] Flag **"Uses NubeSDK"** pronta para ser marcada no app.
- [ ] Build do worker sem uso de `window`/`document`/DOM/React/jQuery (roda em
      Web Worker) — validado.
- [ ] LGPD: sinal envia PII mínima; PII resolvida no backend; opt-out respeitado.

## 1. O que precisa estar pronto (resumo)

| Item | Estado esperado |
|---|---|
| Worker NubeSDK (storefront) | funcional, sem DOM |
| UI via slots (se houver) | mínima ou nenhuma (produto não tem UI de vitrine) |
| Endpoint de ingestão | responde 200 rápido, idempotente |
| Autenticação | valida origem, rejeita forjado |
| Dedup por `cartId` | sinal + poll = 1 enrollment |
| Fallback poll | ativo |

## 2. Fluxo a ser testado na loja demo

1. **Adicionar produto ao carrinho** → confirmar `cart:update` recebido pelo worker.
2. **Entrar no checkout** → confirmar `checkout:ready`.
3. **Preencher contato** → confirmar `customer:update` (contato disponível).
4. **Abandonar** (sair/inatividade) → após a janela, o worker emite o sinal.
5. **Backend recebe** o sinal em `/api/storefront/cart-signal` (verificar log).
6. **Backend confirma** via `GET /checkouts` e grava `carts/{cartId}` +
   `enrollCartInFlows` (gatilho `cart_abandoned`).
7. **Completar uma compra** em outro carrinho → confirmar `order:update` e que a
   recuperação **é cancelada** (não perseguir quem comprou).

## 3. Como provar que a integração funciona

- [ ] Log do worker mostrando os eventos capturados (com dados mínimos).
- [ ] Log do backend recebendo o sinal autenticado (e **rejeitando** um sinal
      forjado sem assinatura válida).
- [ ] Documento/`carts/{cartId}` criado a partir do **sinal do SDK** (não do poll).
- [ ] Enrollment em fluxo `cart_abandoned` disparado pelo sinal.
- [ ] **Dedup:** rodar o poll depois — **não** cria segundo enrollment.
- [ ] **Fallback:** desligar o SDK e confirmar que o poll ainda detecta.
- [ ] **Opt-out:** contato com `optOut=true` **não** é inscrito.

## 4. O que o homologador poderá validar

- [ ] Flag "Uses NubeSDK" ativa e o app carregando o worker no storefront/checkout.
- [ ] Worker **sem** acesso a `window`/`document`/DOM.
- [ ] Comunicação por **eventos/state** (não manipulação direta de página).
- [ ] Nenhuma captura excessiva de PII no browser (minimização/LGPD).
- [ ] Comportamento coerente: sinal → backend → fluxo, sem duplicidade.
- [ ] O Admin embedado (React+Nimbus+Nexo) **continua** funcionando normalmente.

## 5. Critérios de aprovação (definição de pronto)

- [ ] Sinal de abandono chega ao backend em **tempo quase real** (minutos).
- [ ] Origem autenticada; sinal forjado rejeitado.
- [ ] Sem duplicidade entre sinal do SDK e poll.
- [ ] Fallback comprovado.
- [ ] LGPD: PII mínima, opt-out respeitado.
- [ ] Nenhuma regressão no Admin/Nexo/Nimbus nem no motor de jobs.

## 6. Observações

- O produto **não tem UI de vitrine** hoje; o uso do SDK é de **sinalização de
  checkout**, não de renderização de slots. Se o homologador exigir uma prova
  visual de slot, avaliar um slot mínimo/no-op apenas para evidência — decidir
  com base no que a documentação oficial exigir no momento do teste.
