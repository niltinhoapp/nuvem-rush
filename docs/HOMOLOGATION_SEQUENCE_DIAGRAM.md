# Diagrama de sequência para homologação

Baseado no código existente. Scheduler/dispatch são mostrados apenas como componentes observados, sem inferir garantias operacionais.

```mermaid
sequenceDiagram
    actor Merchant as Lojista
    participant NS as Admin/API Nuvemshop
    participant App as Nuvem Rush
    participant Nexo
    participant DB as Firestore
    participant Hook as Webhook
    participant Engine as Motor existente
    participant Cron as Agendador existente
    participant Dispatch as Dispatch existente
    participant Channel as WhatsApp/E-mail

    Merchant->>NS: Instala pela URL oficial
    NS->>App: Callback OAuth com code
    App->>NS: Troca code por access token
    App->>DB: Registra loja/configuração
    App->>NS: Registra webhooks
    App-->>Merchant: Página de instalado

    Merchant->>NS: Abre app no Admin
    NS->>App: Carrega URL em iframe
    App->>Nexo: create + iAmReady + connect
    Nexo-->>App: Sessão do Admin
    App->>Nexo: getSessionToken
    App->>App: API interna com Bearer session token
    App->>DB: Lê/grava fluxos
    DB-->>App: Fluxos/estado
    App-->>Merchant: Dashboard/FlowBuilder

    NS->>Hook: Evento de comércio
    Hook->>Engine: Encaminha evento validado
    Engine->>DB: Enrollment/jobs conforme fluxo
    Cron->>DB: Consulta jobs vencidos
    Cron->>Dispatch: Solicita execução
    Dispatch->>Channel: Envia ação configurada
    Channel-->>Dispatch: Resultado
    Dispatch->>DB: Persiste retorno/log
```

Pontos a demonstrar: instalação, handshake Nexo, leitura/escrita de fluxo, evento, criação de job, execução controlada e evidência do resultado. A precisão/robustez do scheduler e dispatch pertence à trilha paralela e não foi certificada aqui.
