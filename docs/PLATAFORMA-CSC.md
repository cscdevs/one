# Como este projeto conversa com a Plataforma CSC

Este documento descreve o arnês que veio do repositório-modelo `cscdevs/one`. Ele é igual em
todos os projetos da casa — se você entendeu aqui, entendeu em todos.

## O caminho dos dados

```
  este repositório                       Plataforma CSC
  ────────────────                       ──────────────
  csc.project.json  ─┐
  README.md, docs/   ├──►  .csc/cli.js  ──►  POST /api/ingest/projeto
  graphify-out/      ┘     (ou o MCP)              │
                                                   ├─► etapas + tarefas → Lista, Kanban, Gantt
                                                   ├─► documentação     → aba Documentação
                                                   └─► grafo            → aba Arquitetura
```

A publicação usa uma **chave de serviço** no header `X-CSC-Key`, não o login de usuário: quem
publica é a máquina. A chave vive na variável de ambiente `CSC_API_KEY` e nunca entra no
repositório.

## Quando o sync dispara

São dois hooks, com papéis diferentes:

| Hook | Quando | O que faz |
| --- | --- | --- |
| `PostToolUse` | Depois de cada `Edit`, `Write`, `NotebookEdit` ou `Bash` | Sync **incremental** |
| `Stop` | Ao encerrar a sessão do Claude | Sync **completo**, com grafo |

O hook incremental é chamado dezenas de vezes por sessão, então ele é barato de propósito:

1. Calcula uma **assinatura** do que a plataforma exibe — manifesto, documentação, grafo e o
   ponteiro do git. São alguns `stat()`, nada de ler arquivo.
2. Se a assinatura não mudou, **não faz nada**. Mudança em código-fonte não conta: ela não
   altera nada publicado até o `/graphify` rodar de novo.
3. Se mudou mas o último envio foi há menos de **45 segundos**, adia. O próximo gatilho ou o
   hook de encerramento pegam.
4. Se for publicar, solta a chamada num **processo desanexado** e devolve o controle na hora —
   o Claude não fica esperando a rede entre uma ferramenta e outra.

O envio incremental manda **só os documentos que mudaram**, e só carrega o grafo quando o
`/graphify` gerou um novo. O estado que sustenta isso fica no temp do sistema, indexado pelo
caminho do repositório: não suja o projeto e não precisa de `.gitignore`. Perder esse arquivo
não quebra nada — custa um sync a mais.

Qualquer falha aqui é silenciosa e sai com código 0: **uma rede caindo nunca interrompe a
sessão do Claude Code.**

## O manifesto

`csc.project.json` é a fonte da verdade do plano de trabalho:

```jsonc
{
  "slug": "portal-fornecedor",     // identificador estável na plataforma
  "nome": "Portal do Fornecedor",
  "tipo": "Sistema",
  "resumo": "O que este sistema faz",
  "docs": [],                      // vazio = README + tudo em docs/; ou liste arquivos/pastas
  "etapas": [
    {
      "titulo": "Implementacao",
      "descricao": "Construção do sistema",
      "tarefas": [
        { "titulo": "Backend / API", "tempo": "24h", "prioridade": "Alta" }
      ]
    }
  ]
}
```

As **etapas viram fases** e as **tarefas viram tarefas** no mesmo modelo que a plataforma já
usava antes do MCP existir — por isso Kanban, Gantt, horas e percentuais funcionam sem
adaptação. O campo `tempo` alimenta o cálculo de horas.

## O que o sync não destrói

O sync é idempotente e não destrutivo. Rodar duas vezes não duplica nada, e o acompanhamento
feito à mão na plataforma sobrevive:

- Etapas e tarefas casam **pelo título**, ignorando acentos e maiúsculas.
- O payload manda no que declara. O que ele **omite** (status, progresso) fica como está.
- Etapa que existe na plataforma mas não no manifesto **não é apagada** — vai para o fim.
- Documentos casam pelo `path`: republicar atualiza, não duplica.
- O grafo é substituído inteiro a cada envio: é sempre um retrato do commit atual.

Um progresso parcial enviado sem status promove a tarefa para *Em Andamento* automaticamente,
porque o recálculo da plataforma zera o progresso de tarefas marcadas como *Novo*.

## Consultando os outros sistemas

Todo projeto da CSC publica na mesma plataforma, e isso vale nos dois sentidos: dá para
**perguntar aos vizinhos**.

| Ferramenta | O que faz |
| --- | --- |
| `csc_buscar` | Procura um assunto na documentação de todos os **outros** projetos |
| `csc_ler_doc` | Abre o documento inteiro que a busca encontrou |
| `csc_ver_grafo` | Mostra a arquitetura de outro sistema, antes de integrar com ele |
| `csc_listar_projetos` | Lista os sistemas e o progresso de cada um |

Pela linha de comando:

```bash
node .csc/cli.js buscar "deploy em swarm"
node .csc/cli.js ler plataforma-csc docs/deploy.md
```

A busca ignora este projeto por padrão — quem pergunta já está com este repositório aberto.

**A contrapartida é registrar o que você decidir.** O que não estiver em `docs/` não existe
para o próximo projeto, e o problema vai ser resolvido de novo do zero.

## Limites

Um repositório grande gera um grafo enorme, e o banco inteiro vai para o Supabase a cada
gravação. Por isso a ingestão corta em 4.000 nós, 12.000 arestas, 200 documentos e 200 mil
caracteres por documento. Quando corta, a aba Arquitetura avisa na tela.

## Quando algo falha

Rode `node .csc/cli.js status` — ou a ferramenta `csc_status` dentro do Claude Code.

| Sintoma | Causa provável |
| --- | --- |
| `Ingestao desabilitada` (503) | `CSC_INGEST_KEY` não está no `.env` do backend |
| `Chave de ingestao invalida` (401) | `CSC_API_KEY` diferente da chave do servidor |
| `Projeto sem slug` | O `bootstrap.cjs` não rodou neste clone |
| `Projeto "x" nao encontrado` | Rode o sync completo antes de atualizar etapas |
| `Etapa "x" nao encontrada` | O erro lista as etapas válidas — use o título exato |
| As ferramentas `csc_*` não aparecem | Terminal aberto antes do `setx`, ou `.mcp.json` não aprovado na sessão |
