# Preparação final não-NubeSDK — resumo executivo

**Base revalidada:** `main` @ `b03908379b802a2f20e57a4ef2a3a44e3c7c5bdc`  
**Branch:** `fix/homologation-non-nubesdk`  
**Data:** 12/08/2026

## Resultado

A preparação documental e três correções pequenas foram concluídas, mas o app **ainda não deve ser submetido**. Permanecem bloqueadores de teste manual, pricing/trial, materiais, infra e NubeSDK do Claude.

### GREEN

- `/privacidade`, `/suporte` e nova `/termos`.
- User-Agent com nome + e-mail mesmo no fallback.
- Stack React/Nimbus/Nexo instalada.
- Estados vazio, erro e loading no dashboard.
- Diagrama, roteiro, matriz comercial, conta demo e checklist preparados.

### YELLOW

- Nexo: uso correto dos elementos principais, mas ordem `iAmReady`/connect, captura de erro e session token na query da nova aba requerem teste/revisão.
- Nimbus: painel principal usa Nimbus; telas auxiliares e shell do editor não são uniformes.
- OAuth: fluxo existe; `Promise.allSettled` pode ocultar falha de registro de webhook.
- CSP/iframe e cron: configurados, ainda sem validação real.
- Privacidade: texto público agora é verdadeiro; processamento LGPD permanece na trilha backend.
- Carrinho abandonado: implementação por polling diário; validar contra a promessa comercial.

### RED

- NubeSDK pendente do Claude.
- Gates não executados nesta sessão.
- Responsividade sem teste visual real.
- Instalação, novo/existente, remoção e reinstalação sem teste E2E.
- Conta demo e materiais finais não criados.
- Pricing/trial aguardando decisão do proprietário.

## Auditoria de responsividade

| Área | Classificação | Evidência |
|---|---|---|
| Dashboard amplo | PASS_CODE_AUDIT | Componentes fluidos Nimbus e sem 100vw |
| Header/card WhatsApp/lista | NEEDS_VISUAL_TEST | Linhas flex sem wrap em pontos críticos |
| Flow Builder | FAIL | Toolbar horizontal, nós 340/360px e altura 80vh podem causar overflow/double scroll |
| Tablet/mobile | NEEDS_VISUAL_TEST | Sem breakpoints/testes comprovados |
| Iframe | NEEDS_VISUAL_TEST | CSP existe; dimensões/scroll não testados |
| Modais/dropdowns | NEEDS_VISUAL_TEST | Select/overlays precisam teste dentro do iframe |
| Páginas públicas | PASS_CODE_AUDIT | maxWidth e padding lateral; confirmar zoom/teclado |

Viewports obrigatórios: 1440x900, 1280x800, 1024x768, 768x1024, 600x800 (iframe estreito) e 390x844; testar também zoom 200%.

## Jornada de instalação

Fluxo atual: authorize oficial → callback → token → loja/cotas → webhooks → /instalado → abertura no Admin/iframe → Nexo/session token → painel.

Bloqueadores:

1. ausência de teste E2E;
2. falhas individuais de webhooks são silenciadas por `Promise.allSettled`;
3. dependência crítica de `APP_BASE_URL`;
4. o produto não possui cadastro/login separado — documentar como identidade por loja/Nexo e confirmar aceitação no roteiro oficial;
5. desinstalação não comprova purge;
6. reinstalação não foi testada.

## Nimbus/Nexo

**Nimbus: YELLOW.** Dashboard, cards, botões, inputs, tags, spinner, estado vazio e erro usam componentes/tokens oficiais. Flow editor e telas standalone têm partes inline. Não houve substituição estética.

**Nexo: YELLOW.** Há `create`, `connect`, `iAmReady`, `getSessionToken` e ErrorBoundary. Pontos de atenção: ready antes do connect, erro capturado como sucesso aparente, ausência de timeout explícito e token passado na query para /connect-whatsapp.

## Decisões do proprietário

- Pricing, periodicidade e trial.
- Oferta comercial e comportamento ao atingir cota.
- Dados finais de suporte/contato.
- Países, idiomas, handle e conteúdo do Portal.
- Aprovação jurídica dos textos públicos.
- Se o requisito “cadastro/login” será documentado como não aplicável à identidade via Nexo.

## Próxima ordem exata

1. Claude conclui NubeSDK.
2. Revisar diff de Claude e preencher placeholders.
3. Proprietário resolve pricing/trial.
4. Engenharia roda os quatro gates.
5. Corrigir qualquer falha de gate.
6. Preparar conta demo, Meta e dados fictícios.
7. Executar E2E de instalação/uso/remoção/reinstalação.
8. Executar matriz visual de iframe.
9. Fechar Portal e materiais.
10. Gravar vídeo seguindo o roteiro.
11. Revisar checklist; somente com zeros RED solicitar homologação.
