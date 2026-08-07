# Nuvem Rush

Camada de automacao avancada de pos-venda para **Nuvemshop** (App ID **34663**).
App **incorporado** ao admin (Nimbus + Nexo) com backend **Firebase** e agendamento via **Vercel Cron**.

## Por que esta arquitetura

- **App incorporado** (nao externo): roda dentro do admin via iframe usando Nimbus + Nexo
  conforme exigido para aprovacao na App Store da Nuvemshop.
- **Webhook responde 200 rapido**; o processamento e feito no motor de regras.
- **Vercel Cron** (`/api/cron/dispatch`) coleta os jobs vencidos (`runAt <= agora`) e dispara.
  Cada step vira um job com `runAt` no Firestore; o cron o pega quando vence.
  > Nota: no plano Hobby da Vercel o cron roda **1x/dia** — para precisao de minutos/horas,
  > use um cron externo (cron-job.org) batendo em `/api/cron/dispatch` ou o plano Pro.
  > O `lib/scheduler.ts` (Google Cloud Tasks) existe para migracao futura em escala,
  > mas **nao esta em uso** no runtime atual.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend (admin) | Next.js 16 + Nimbus + Nexo (iframe) |
| Frontend (landing) | Next.js + Tailwind/shadcn |
| Backend | Next.js API Routes + Firebase Admin |
| Banco | Firestore (multi-tenant por storeId) |
| Auth | Firebase Auth + sessao Nexo |
| Agendamento | Vercel Cron (Cloud Tasks só como base futura) |
| E-mail | Resend |
| WhatsApp | Evolution API / Meta WA Cloud |
| IA | OpenAI |

## Estrutura

```
app/
  api/auth/nuvemshop/callback   # OAuth: troca code -> token, cria loja, registra webhooks
  api/webhooks/nuvemshop        # receiver (HMAC + LGPD + enfileira pedidos)
  api/cron/dispatch             # Vercel Cron: coleta jobs vencidos e dispara
  api/dispatch/[jobId]          # disparo manual/externo de um job
  dashboard/                    # app incorporado (Nimbus + Nexo)
lib/
  nuvemshop/{oauth,client,webhooks}.ts
  firebase/admin.ts
  rules/{evaluate,process}.ts   # motor SE -> ENTAO
  dispatch.ts                   # logica de disparo de um job (canais + quota)
  scheduler.ts                  # Cloud Tasks (NAO usado; base para migracao futura)
  channels/email.ts
  ai/openai.ts
  nexo.ts
types/index.ts
firestore.rules                 # isolamento multi-tenant
```

## Setup

1. `cp .env.example .env.local` e preencha (Client Secret do App 34663, Firebase, Meta/WhatsApp, Resend).
2. `npm install`
3. `npm run dev`
4. No painel de Parceiros, ative o **Developer Mode** e aponte a URL do app para testar no admin.

> Agendamento: nao precisa de fila do Cloud Tasks. Os crons sao declarados em `vercel.json`
> e disparam em producao. Para testar localmente, chame `/api/cron/dispatch` com o header
> `Authorization: Bearer <CRON_SECRET>`.

## Checklist de homologacao Nuvemshop

- [ ] OAuth funcionando (install -> token -> redirect ao admin)
- [ ] Webhooks `app/uninstalled`, `store/redact`, `customers/redact` tratados (LGPD)
- [ ] UI 100% em Nimbus dentro do iframe
- [ ] Nexo `connect()` + `iAmReady()`
- [ ] Politica de privacidade e termos publicos
- [ ] CSP com `frame-ancestors` dos dominios da Nuvemshop

## Pendencias marcadas como TODO no codigo

- Criptografia do `accessToken` em repouso (KMS)
- Pub/Sub entre webhook e motor (hoje chamada direta)
- Sincronizacao em lote de produtos/categorias na instalacao (hoje produtos sao
  buscados sob demanda e cacheados ao processar o 1o pedido que os usa)
- Cancelamento de jobs em `order/cancelled`
- Canais WhatsApp / tag / webhook / task no dispatcher
- Reset mensal de `quotas.dispatchesMonthUsed`
