# {{NOME_DO_PROJETO}}

## Plataforma de Projetos CSC

Este projeto e acompanhado na Plataforma CSC (slug: `{{SLUG}}`) pelo servidor MCP `csc`.
As etapas ficam declaradas em `csc.project.json` — essa e a fonte da verdade da sequencia de trabalho.

**Ao concluir uma etapa ou uma tarefa dela, chame `csc_atualizar_etapa`** com o titulo exato da etapa,
o status novo e uma nota curta do que foi feito. Exemplo: ao terminar a API, chame
`csc_atualizar_etapa` com `etapa: "Implementacao"`, `tarefa: "Backend / API"`, `status: "Fechado"`.

Publicacao:

- `csc_sync_projeto` — publica etapas, documentacao e grafo de uma vez. Rode depois de mudancas grandes.
- `csc_registrar_doc` — publica um documento markdown especifico.
- `csc_enviar_grafo` — publica o grafo de arquitetura depois de rodar `/graphify`.
- `csc_ver_projeto` — le o estado atual na plataforma para saber onde o trabalho parou.
- `csc_status` — diagnostica a conexao quando algo falhar.

Ao criar ou alterar uma etapa do plano de trabalho, edite `csc.project.json` e rode `csc_sync_projeto`
para que a plataforma reflita a nova sequencia.

### Este projeto nao esta sozinho

Todo sistema da CSC publica documentacao e arquitetura na mesma plataforma. Antes de decidir
arquitetura, escolher biblioteca, montar deploy ou resolver um problema de infraestrutura,
**consulte o que os outros projetos ja fizeram** — quase sempre alguem da casa ja passou por isso:

- `csc_buscar` — procura um assunto na documentacao de todos os outros projetos.
  Ex: `csc_buscar q="autenticacao com supabase"`, `csc_buscar q="deploy em swarm"`.
- `csc_ler_doc` — abre o documento inteiro que a busca encontrou.
- `csc_ver_grafo` — mostra a arquitetura de outro sistema, util antes de integrar com ele.
- `csc_listar_projetos` — lista os sistemas existentes e o progresso de cada um.

A contrapartida: **o que voce decidir aqui tem que virar documento**. Registre decisoes de
arquitetura, integracoes e pegadinhas de operacao em `docs/` — e isso que o proximo projeto
vai encontrar quando pesquisar. Um problema resolvido e nao documentado sera resolvido de novo.
