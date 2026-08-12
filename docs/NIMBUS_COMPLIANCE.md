# Conformidade Nimbus

Base: main @ b03908379b802a2f20e57a4ef2a3a44e3c7c5bdc. Status geral: **AMARELO**.

Fonte oficial: https://dev.nuvemshop.com.br/docs/homologation/checklist

| Requisito | Estado atual / evidência | Status | Correção necessária |
|---|---|---|---|
| Nimbus Components/Icons/Styles | Dependências presentes; CSS global importado em app/layout.tsx | VERDE | Manter |
| Página inicial/vazia | EmptyState em app/dashboard/page.tsx usa Card, Box, Title, Text, Button e Icons Nimbus | VERDE | Validar visualmente |
| Página de erro | ErrorState + ErrorBoundary Nexo no dashboard | VERDE | Validar erro real |
| Loading | Spinner Nimbus no handshake e lista | VERDE | Manter |
| Formulários | FlowBuilder/nodes usam Input, Select, Button e IconButton Nimbus | VERDE | Associar labels visíveis aos controles |
| Status | Tags de ativo/pausado/rascunho e WhatsApp | VERDE | Manter |
| Página do construtor | Toolbar Nimbus, mas wrapper/loading usam main + estilo inline | AMARELO | Uniformizar shell e loading com Nimbus |
| Conexão WhatsApp | Página standalone usa HTML/CSS inline | AMARELO | Aplicar Nimbus se esta tela fizer parte da jornada filmada/homologada |
| Pós-instalação | HTML/CSS inline | AMARELO | Aplicar padrão visual consistente |
| Responsividade | Muitos flex rows sem wrap; nós fixos de 340/360px | VERMELHO | Testar/ajustar antes da submissão |
| Foco/teclado | Controles nativos/Nimbus e aria-label em remoção | AMARELO | Testar navegação completa e React Flow |
| Contraste | Tokens Nimbus no embed; cores manuais nas páginas públicas | AMARELO | Verificar WCAG visualmente |
| Feedback | Mensagens existem, mas sucesso/erro do save compartilham cor neutra | AMARELO | Diferenciar estados e tornar feedback anunciado |
| Confirmações | Remoção de ação ocorre sem confirmação | AMARELO | Avaliar modal Nimbus quando houver risco de perda |
| Ações externas | window.open direto para Meta | AMARELO | Confirmar helper Nexo/abertura externa oficial |

Conclusão: o dashboard principal é majoritariamente Nimbus e cobre estados obrigatórios, mas não está pronto para selo verde sem QA visual e correções de responsividade/acessibilidade.
