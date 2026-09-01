---
description: Procura como os outros projetos da CSC resolveram um assunto
argument-hint: [assunto]
---

O usuario quer saber como o ecossistema CSC ja tratou: **$ARGUMENTS**

1. Chame `csc_buscar` com esse assunto. Se vier vazio, tente sinonimos e termos mais
   gerais antes de desistir (ex: "login" -> "autenticacao" -> "sessao").
2. Para os resultados que importarem, chame `csc_ler_doc` e leia o documento inteiro —
   o trecho da busca costuma nao trazer o motivo da decisao.
3. Se for questao de estrutura de codigo, complemente com `csc_ver_grafo` do projeto citado.
4. Responda dizendo **qual projeto** resolveu, **como**, e o que se aplica ou nao aqui.
   Cite o projeto e o arquivo de origem em cada afirmacao.
5. Se nada existir na plataforma, diga isso claramente: este projeto vai ser o primeiro,
   e a decisao precisa ser documentada em `docs/` para os proximos.
