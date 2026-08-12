# Master pré-homologação — frontend Nuvem Rush

**Base:** `main` @ `b03908379b802a2f20e57a4ef2a3a44e3c7c5bdc`  
**Auditoria:** 12/08/2026  
**Escopo:** frontend incorporado, homologação e materiais. Nenhuma correção implementada.

## Resumo

| Item | Status | Gravidade | Evidência | Ação | Responsável | Depende de Claude? |
|---|---|---:|---|---|---|---|
| NubeSDK | REQUIRES_OFFICIAL_CONFIRMATION | P0 | Checklist geral versus docs de embedded/NubeSDK | Obter resposta escrita da Nuvemshop | Produto/Parceiros | NÃO |
| Nexo | AMARELO | P1 | lib/nexo.ts e dashboard | Validar ordem do handshake, timeout e abertura externa | Frontend | NÃO |
| Nimbus | AMARELO | P1 | dashboard/FlowBuilder Nimbus; telas auxiliares inline | QA visual e ajustes pontuais | Frontend/UI | NÃO |
| Iframe/responsividade | VERMELHO até teste | P1 | flex rows, nós 340/360px, editor 80vh | Executar matriz real e corrigir overflow | Frontend/UI | NÃO |
| User-Agent | VERMELHO no fallback | P1 | client.ts usa fallback "Nuvem Rush" sem e-mail | Garantir env e fallback no formato nome + e-mail | Backend/config | SIM |
| Pricing/trial | AMARELO | P1 | plans.ts: 39,90/89,90/149,90; FAQ: 14 dias | Confirmar Portal/LP e decisão comercial | Produto | NÃO |
| Conta demo | PENDENTE | P1 | Não há credenciais/execução comprovada | Preparar por canal seguro | Operações | SIM |
| Diagrama | CRIADO | P2 | HOMOLOGATION_SEQUENCE_DIAGRAM.md | Validar backend com agente responsável | Engenharia | SIM |
| Roteiro do vídeo | CRIADO | P2 | HOMOLOGATION_VIDEO_SCRIPT.md | Gravar após P0/P1 | Produto/QA | SIM |
| Privacidade | AMARELO | P1 | /privacidade existe | Revisar alegações contra processamento real | Jurídico/backend | SIM |
| Suporte | VERDE documental | P2 | /suporte com e-mail, horário e SLA | Confirmar contatos no Portal | Suporte | NÃO |
| Termos | VERMELHO | P1 | rota /termos ausente | Definir necessidade e publicar texto aprovado | Jurídico | NÃO |
| Marketplace | PENDENTE | P1 | assets/Portal não comprovados | Completar checklist | Marketing/Produto | NÃO |

## Nexo — status AMARELO

Pontos positivos:

- `@tiendanube/nexo ^1.3.1`;
- singleton por `create`, App ID público, log desativado em produção;
- `connect`, `iAmReady`, `getSessionToken`;
- ErrorBoundary obrigatório presente;
- chamadas internas com Bearer session token.

Riscos:

- `iAmReady` é enviado antes de `connect`, enquanto o exemplo oficial conecta e depois sinaliza pronto;
- não existe timeout explícito/estado degradado no `connect`;
- erro de `connect` é capturado e a função resolve, fazendo o dashboard marcar conexão como pronta;
- abertura da Meta usa `window.open` direto; confirmar helper oficial e política de navegação;
- session token vai na query string da nova aba, com risco de exposição em histórico/log/referrer;
- não há renovação/retry explícito do session token;
- CSP cobre raiz/dashboard, mas precisa ser testada nos domínios reais do Admin.

## User-Agent

A documentação oficial exige nome do app + e-mail. `.env.example` está correto: `Nuvem Rush (email)`. O fallback em `lib/nuvemshop/client.ts` é apenas `Nuvem Rush` e, portanto, não atende. Não editar produção nesta missão; tratar antes da homologação.

Fonte: https://dev.nuvemshop.com.br/docs/homologation/guidelines

## Termos, suporte e privacidade

- `/privacidade`: existe e descreve coleta, operadores, retenção e direitos. A afirmação de remoção/anominização deve ser validada pela trilha LGPD.
- `/suporte`: existe com e-mail, horário e SLA.
- `/termos`: ausente.
- Portal não foi acessado; conferir se URLs e contatos são idênticos.

## Prioridades

### P0

1. Resolver oficialmente aplicabilidade do NubeSDK.

### P1

1. Confirmar e corrigir riscos Nexo/session token.
2. Executar QA responsivo real no iframe.
3. Garantir User-Agent com nome + e-mail mesmo sem env.
4. Confirmar pricing/trial em todas as superfícies.
5. Preparar conta demo e execução controlada.
6. Revisar política de privacidade com a trilha LGPD.
7. Definir/publicar termos.
8. Completar assets e Portal.

### P2

1. Refinar consistência Nimbus nas telas auxiliares.
2. Validar diagrama com a trilha backend.
3. Gravar vídeo após fechar P0/P1.
4. Completar screenshots e materiais finais.

## Decisão de envio

**NÃO SOLICITAR HOMOLOGAÇÃO AINDA.** A documentação foi preparada, mas permanecem um P0 e múltiplos P1. Nenhuma correção foi implementada conforme a missão.
