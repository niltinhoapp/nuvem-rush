# Checklist final de homologação

Legenda: GREEN concluído por evidência; YELLOW depende de validação/decisão; RED bloqueia submissão.

## A) Código

| Requisito | Status | Evidência | Ação | Bloqueador? | Responsável |
|---|---|---|---|---|---|
| /privacidade | GREEN | Rota existe; texto alinhado ao comportamento atual | Revisão jurídica final | Não | Proprietário/Jurídico |
| /suporte | GREEN | E-mail, horário e SLA públicos | Confirmar dados no Portal | Não | Proprietário |
| /termos | GREEN | Rota criada nesta branch | Revisão jurídica final | Não | Proprietário/Jurídico |
| User-Agent | GREEN | Fallback agora inclui nome + e-mail | Garantir env em produção | Não | Infra |
| OAuth/instalação | YELLOW | Callback troca token, grava loja e registra webhooks | Teste E2E; verificar falhas de webhook/APP_BASE_URL | Sim | Backend/QA |
| Desinstalação | YELLOW | app/uninstalled marca status | Validar resultado e trilha LGPD | Sim | Claude/Backend |
| Nimbus | YELLOW | Dashboard/FlowBuilder usam Nimbus; auxiliares têm HTML inline | QA visual; só corrigir gaps comprovados | Sim | Frontend/QA |
| Nexo | YELLOW | create/connect/iAmReady/token/ErrorBoundary | Teste real; revisar ordem/erro e token em query | Sim | Frontend/Segurança |
| Carrinho abandonado | YELLOW | Poll em cron diário | Validar timing real no vídeo | Sim | Backend/QA |
| Gates | RED | Não executados: checkout local indisponível nesta sessão | Rodar test/typecheck/build/lint no checkout | Sim | Engenharia |

## B) Infra

| Requisito | Status | Evidência | Ação | Bloqueador? | Responsável |
|---|---|---|---|---|---|
| Variáveis obrigatórias | YELLOW | .env.example mapeia integrações | Conferir produção sem expor valores | Sim | Infra |
| Cron/precisão | YELLOW | vercel.json agenda rotinas diárias | Confirmar compatibilidade com promessa do produto | Sim | Claude/Infra |
| Domínio/CSP/iframe | YELLOW | frame-ancestors configurado | Testar domínios reais | Sim | Infra/QA |
| Conta WhatsApp/teste | YELLOW | Fluxo existe | Preparar Meta/número/modelo antes do teste | Sim | Operações |

## C) Portal Nuvemshop

| Requisito | Status | Evidência | Ação | Bloqueador? | Responsável |
|---|---|---|---|---|---|
| URLs públicas/contato | YELLOW | Rotas no código | Preencher/conferir Portal | Sim | Proprietário |
| Pricing/trial | RED | OWNER_DECISION_REQUIRED | Decidir e uniformizar | Sim | Proprietário |
| Escopos/webhooks | YELLOW | Código lista eventos | Conferir Portal e diagrama | Sim | Backend/Proprietário |
| País/idioma/handle | YELLOW | Não auditado no Portal | Configurar | Sim | Proprietário |

## D) Material de homologação

| Requisito | Status | Evidência | Ação | Bloqueador? | Responsável |
|---|---|---|---|---|---|
| Diagrama | YELLOW | Documento atualizado | Inserir fluxo final NubeSDK e validar backend | Sim | Claude/Engenharia |
| Roteiro do vídeo | YELLOW | Documento sequencial criado | Completar NubeSDK e gravar | Sim | Claude/Produto |
| Conta demo | YELLOW | Especificação criada | Criar manualmente e ensaiar | Sim | Operações |
| Screenshots/ícone/ficha | RED | Não comprovados | Produzir e conferir dimensões/descrições | Sim | Marketing/Produto |

## E) Teste manual

| Requisito | Status | Evidência | Ação | Bloqueador? | Responsável |
|---|---|---|---|---|---|
| Instalação/reinstalação | RED | Não testada nesta sessão | E2E em loja demo | Sim | QA |
| Novo/existente | RED | Não testado | Demonstrar identidade por loja/Nexo | Sim | QA |
| Responsividade | RED | Apenas auditoria estática | Matriz desktop/tablet/mobile/iframe | Sim | QA/UI |
| Automação e canais | RED | Não houve execução real | Teste controlado completo | Sim | QA/Claude |

## F) NubeSDK pendente do Claude

| Requisito | Status | Evidência | Ação | Bloqueador? | Responsável |
|---|---|---|---|---|---|
| Implementação NubeSDK | RED | PENDING_CLAUDE_NUBESDK_IMPLEMENTATION | Aguardar e revisar | Sim | Claude |
| Diagrama NubeSDK | RED | Placeholder explícito | Inserir após código final | Sim | Claude/Codex |
| Vídeo NubeSDK | RED | Passo reservado | Gravar após validação | Sim | Claude/QA |
