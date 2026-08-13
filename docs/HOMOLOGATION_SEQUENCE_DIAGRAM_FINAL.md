# Diagrama de sequência — arquitetura atual

Base: `main` @ `b03908379b802a2f20e57a4ef2a3a44e3c7c5bdc`.

```mermaid
sequenceDiagram
    actor L as Lojista
    participant NS as Admin/API Nuvemshop
    participant OAuth as Callback Nuvem Rush
    participant DB as Firestore
    participant UI as App incorporado
    participant Nexo
    participant Hook as Webhook Nuvemshop
    participant Rules as Motor de regras atual
    participant CartCron as Cron de carrinhos
    participant DispatchCron as Cron de dispatch
    participant Channel as WhatsApp/E-mail

    L->>NS: Abre /apps/34663/authorize
    NS->>OAuth: Redireciona com code
    OAuth->>NS: Troca code por access_token
    OAuth->>DB: Upsert da loja/plano/cotas
    OAuth->>NS: Registra webhooks operacionais
    Note over OAuth,NS: Promise.allSettled não bloqueia instalação se algum registro falhar
    OAuth-->>L: Redireciona para /instalado

    L->>NS: Abre Nuvem Rush no Admin
    NS->>UI: Carrega URL em iframe
    UI->>Nexo: create / iAmReady / connect
    UI->>Nexo: getSessionToken
    Nexo-->>UI: JWT da loja
    UI->>DB: APIs internas listam/salvam fluxos
    DB-->>UI: Estado do painel

    NS->>Hook: order/created, paid, fulfilled ou cancelled
    Hook->>Hook: Valida HMAC
    Hook->>Rules: handleOrderEvent
    Rules->>NS: Busca pedido/produto quando necessário
    Rules->>DB: Contato, pedido, enrollment e jobs

    CartCron->>NS: GET checkouts (poll; não há webhook de carrinho)
    NS-->>CartCron: Checkouts recentes
    CartCron->>DB: Dedup e grava carrinho/contato
    CartCron->>Rules: Inscreve em fluxos cart_abandoned
    Rules->>DB: Jobs do carrinho

    DispatchCron->>DB: Consulta jobs vencidos
    DispatchCron->>Channel: Executa ação configurada
    Channel-->>DispatchCron: Resultado
    DispatchCron->>DB: Status/log do job

    L->>NS: Desinstala app
    NS->>Hook: app/uninstalled
    Hook->>DB: Marca loja como uninstalled
    Note over Hook,DB: Purga completa permanece fora desta missão

    Note over NS,UI: PENDING_CLAUDE_NUBESDK_IMPLEMENTATION
```

## Ponto reservado para Claude

Após revisão da implementação, inserir somente o fluxo NubeSDK confirmado: evento(s), Web Worker, state/API, ausência/presença de UI Slot e relação com o backend. Não inferir antes.

## Riscos evidenciados

- Falha individual ao registrar webhook não impede instalação e não é apresentada ao lojista.
- `APP_BASE_URL` é essencial para callback/webhooks.
- Carrinho abandonado depende de polling diário configurado em `vercel.json`.
- Desinstalação marca status; a política pública foi corrigida para não prometer purga imediata.
