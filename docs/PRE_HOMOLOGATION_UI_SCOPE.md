# Escopo seguro de UI pré-homologação

Nimbus prevalece dentro do app incorporado. A referência rush-interface-spark deve orientar hierarquia e densidade, não trocar a stack.

## PORTAR AGORA

- Hierarquia mais clara no cabeçalho, status do WhatsApp e ações primárias.
- Layout responsivo da toolbar do construtor, com quebra/empilhamento.
- Estados de loading, erro, vazio e sucesso consistentes.
- Shell Nimbus para /dashboard/flows/[id].
- Mensagens de feedback visualmente distintas e acessíveis.
- Rótulos/instruções persistentes nos formulários.
- Tratamento de overflow e canvas em iframe estreito.
- Aplicação visual consistente nas telas /connect-whatsapp e /instalado se entrarem na jornada.

## PORTAR DEPOIS

- Refinamentos de dashboard analítico.
- Cards mais densos, filtros e busca.
- Animações e microinterações.
- Navegação secundária avançada.
- Reorganização ampla do construtor visual.

## NÃO PORTAR

- TanStack Start ou Router, Vite, Bun.
- shadcn ou Radix como base do app incorporado.
- Tokens/componentes que substituam Nimbus dentro do iframe.
- Migração integral da UI antes da homologação.
- Qualquer alteração no motor, serialização ou backend.

Telas do homologador: instalação/instalado, entrada pelo Admin, dashboard vazio/com fluxos, conexão WhatsApp, criação/edição/salvamento/ativação e estados de erro.
