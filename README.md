# Nuvem Rush

Camada de automacao avancada de pos-venda para **Nuvemshop** (App ID **34663**).
App **incorporado** ao admin (Nimbus + Nexo) com backend **Firebase** e agendamento via **Google Cloud Tasks**.

## Por que esta arquitetura

- **App incorporado** (nao externo): roda dentro do admin via iframe usando Nimbus + Nexo
  conforme exigido para aprovacao na App Store da Nuvemshop.
- **Webhook responde 200 rapido**; o processamento pesado e assincrono (Pub/Sub em producao).
- **Cloud Tasks** agenda 1 disparo por step ("apos X dias") sem polling no banco.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend (admin) | Next.js 16 + Nimbus + Nexo (iframe) |
| Frontend (landing) | Next.js + Tailwind/shadcn |
| Backend | Next.js API Routes + Firebase Admin |
| Banco | Firestore (multi-tenant por storeId) |
| Auth | Firebase Auth + sessao Nexo |
| Agendamento | Google Cloud Tasks |
| E-mail | Resend |
| WhatsApp | Evolution API / Meta WA Cloud |
| IA | OpenAI |

## Estrutura

```
app/
  api/auth/nuvemshop/callback   # OAuth: troca code -> token, cria loja, registra webhooks
  api/webhooks/nuvemshop        # receiver (HMAC + LGPD + enfileira pedidos)
  api/dispatch/[jobId]          # callback do Cloud Tasks no horario do disparo
  dashboard/                    # app incorporado (Nimbus + Nexo)
lib/
  nuvemshop/{oauth,client,webhooks}.ts
  firebase/admin.ts
  rules/{evaluate,process}.ts   # motor SE -> ENTAO
  scheduler.ts                  # Cloud Tasks
  channels/email.ts
  ai/openai.ts
  nexo.ts
types/index.ts
firestore.rules                 # isolamento multi-tenant
```

## Setup

1. `cp .env.example .env.local` e preencha (Client Secret do App 34663, Firebase, GCP, Resend).
2. `npm install`
3. Crie a fila do Cloud Tasks: `gcloud tasks queues create dispatch-queue --location=southamerica-east1`
4. `npm run dev`
5. No painel de Parceiros, ative o **Developer Mode** e aponte a URL do app para testar no admin.

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
