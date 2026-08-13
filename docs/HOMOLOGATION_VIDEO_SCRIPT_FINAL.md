# Roteiro final do vídeo de homologação

Seguir em sequência, em português, sem expor tokens ou dados reais. Fonte: requisitos oficiais de homologação.

## Preparação

1. Mostrar brevemente data, ambiente demo, App ID 34663 e objetivo.
2. Confirmar que a loja demo está sem instalação e sem bloqueio de assinatura.
3. Ocultar console, URLs com tokens, credenciais Meta e dados pessoais.

## Gravação

1. Abrir `https://www.tiendanube.com/apps/34663/authorize`.
2. Mostrar a origem Nuvemshop, permissões solicitadas e aceite.
3. Mostrar callback e página `/instalado`.
4. Voltar ao Admin e abrir Nuvem Rush no menu; mostrar iframe carregando e painel.
5. **Usuário novo:** esclarecer que o app usa a identidade da loja via Nexo e não possui cadastro separado; mostrar loja nova/estado vazio. Se a Nuvemshop exigir formulário próprio, registrar como não aplicável e confirmar no ticket.
6. Conectar WhatsApp pela janela oficial Meta, sem revelar segredos; voltar e atualizar status.
7. Criar automação: nome, gatilho, condição, atraso e canal.
8. Salvar rascunho e mostrar confirmação.
9. Ativar e mostrar status na lista.
10. Gerar evento fictício de pedido criado/pago/enviado conforme os fluxos demonstrados.
11. Mostrar leitura do evento, enrollment/job e resultado/log disponível.
12. Confirmar recebimento no e-mail/WhatsApp consentido.
13. Demonstrar carrinho abandonado em cenário preparado; explicar que a leitura é por rotina periódica, não webhook.
14. **Usuário existente:** fechar e reabrir pelo Admin; mostrar sessão Nexo e fluxo persistido.
15. Mostrar páginas públicas `/privacidade`, `/termos` e `/suporte`.
16. Desinstalar no Admin; mostrar que o app deixa de operar para a loja.
17. Reinstalar novamente pela URL oficial e validar o primeiro acesso.
18. Repetir a abertura como loja já cadastrada após reinstalação.
19. Mostrar pricing/trial somente após `OWNER_DECISION_REQUIRED` ser resolvido.
20. Inserir o trecho `PENDING_CLAUDE_NUBESDK_IMPLEMENTATION` após revisão de Claude, cobrindo exatamente os eventos/fluxos implementados.
21. Encerrar com suporte, limitações conhecidas e resumo das funções.

## Critério de completude

O vídeo precisa corresponder ao diagrama final e mostrar todos os fluxos sem atalhos artificiais. Se qualquer etapa falhar, corrigir e regravar; não editar o erro para aparentar aprovação.
