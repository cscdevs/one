---
description: Publica etapas, documentacao e grafo deste projeto na Plataforma CSC
---

Sincronize este projeto com a Plataforma de Projetos CSC:

1. Se `graphify-out/graph.json` nao existir e o usuario tiver pedido o grafo, rode `/graphify` antes.
2. Chame `csc_sync_projeto` para publicar etapas, documentacao e grafo.
3. Compare o resultado com o estado real do trabalho. Se alguma etapa concluida ainda aparecer
   em aberto, corrija com `csc_atualizar_etapa`.
4. Informe ao usuario o que foi publicado e o progresso geral resultante.
