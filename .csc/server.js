#!/usr/bin/env node
// ==========================================================
// ARQUIVO GERADO — NAO EDITE AQUI
// ----------------------------------------------------------
// Copia de Plataforma-csc/mcp-csc/server.js. Para alterar,
// edite o original e rode:  node scripts/gerar-template.cjs
// Editar esta copia faz o modelo divergir em silencio.
// ==========================================================
// ==========================================================
// SERVIDOR MCP  "csc"
// ----------------------------------------------------------
// Expoe a Plataforma de Projetos CSC como ferramentas para o
// Claude Code. Qualquer projeto que declare este servidor no
// .mcp.json passa a publicar etapas, documentacao e o grafo
// de arquitetura direto na plataforma.
//
// Transporte: stdio, JSON-RPC 2.0 delimitado por nova linha.
// Sem dependencias — nada de npm install para funcionar.
//
// IMPORTANTE: stdout e exclusivo do protocolo. Todo log vai
// para stderr, ou o Claude Code nao consegue falar com o server.
// ==========================================================

const nucleo = require('./sync-core');

const VERSAO_PROTOCOLO = '2025-06-18';
const INFO_SERVIDOR = { name: 'csc', title: 'Plataforma de Projetos CSC', version: '1.0.0' };

function log(msg) {
  process.stderr.write('[mcp-csc] ' + msg + '\n');
}

// ----------------------------------------------------------
// Definicao das ferramentas
// ----------------------------------------------------------

const FERRAMENTAS = [
  {
    name: 'csc_status',
    title: 'Status da conexao CSC',
    description: 'Verifica a conexao com a Plataforma CSC e mostra como este projeto esta configurado: '
      + 'URL da API, slug, etapas declaradas no csc.project.json e se existe grafo do graphify local. '
      + 'Use antes de qualquer publicacao quando algo parecer errado.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'csc_sync_projeto',
    title: 'Publicar projeto na plataforma',
    description: 'Publica o estado completo deste projeto na Plataforma CSC: etapas do csc.project.json, '
      + 'toda a documentacao markdown do repositorio e o grafo de arquitetura de graphify-out/graph.json. '
      + 'E idempotente — cria o projeto na primeira vez e atualiza nas seguintes. '
      + 'Preserva o progresso que foi ajustado a mao na plataforma.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Identificador do projeto. Padrao: o slug do csc.project.json.' },
        nome: { type: 'string', description: 'Nome exibido na plataforma. Padrao: o do manifesto.' },
        resumo: { type: 'string', description: 'Resumo curto do que o sistema faz.' },
        incluirDocs: { type: 'boolean', description: 'Enviar a documentacao markdown. Padrao: true.' },
        incluirGrafo: { type: 'boolean', description: 'Enviar o grafo do graphify. Padrao: true.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'csc_atualizar_etapa',
    title: 'Atualizar etapa ou tarefa',
    description: 'Marca o andamento de uma etapa (fase) ou de uma tarefa especifica do projeto na plataforma. '
      + 'Chame isto ao concluir uma etapa do trabalho, sem precisar reenviar o repositorio inteiro. '
      + 'Se a etapa nao existir, o erro lista as etapas disponiveis.',
    inputSchema: {
      type: 'object',
      properties: {
        etapa: { type: 'string', description: 'Titulo da etapa, como declarado no csc.project.json.' },
        tarefa: { type: 'string', description: 'Titulo da tarefa dentro da etapa. Omita para agir na etapa inteira.' },
        status: { type: 'string', description: 'Novo, Em Andamento, Fechado ou Bloqueado.' },
        progresso: { type: 'number', description: 'Percentual de 0 a 100.' },
        nota: { type: 'string', description: 'Comentario registrado junto da tarefa (o que foi feito).' },
        slug: { type: 'string', description: 'Projeto alvo. Padrao: o do manifesto.' }
      },
      required: ['etapa'],
      additionalProperties: false
    }
  },
  {
    name: 'csc_registrar_doc',
    title: 'Enviar um documento',
    description: 'Publica um documento markdown avulso na aba Documentacao do projeto. '
      + 'Passando so "path", o arquivo e lido do repositorio; passando "markdown", o conteudo e usado direto '
      + '(util para documentar algo que ainda nao virou arquivo).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do documento, ex: docs/arquitetura.md' },
        titulo: { type: 'string', description: 'Titulo exibido. Padrao: o primeiro heading do markdown.' },
        markdown: { type: 'string', description: 'Conteudo. Se omitido, le o arquivo em "path".' },
        slug: { type: 'string', description: 'Projeto alvo. Padrao: o do manifesto.' }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'csc_enviar_grafo',
    title: 'Enviar o grafo do graphify',
    description: 'Le graphify-out/graph.json e publica so o grafo de arquitetura, que aparece na aba '
      + 'Arquitetura do projeto. Use depois de rodar /graphify quando nao quiser um sync completo.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Projeto alvo. Padrao: o do manifesto.' } },
      additionalProperties: false
    }
  },
  {
    name: 'csc_listar_projetos',
    title: 'Listar projetos da plataforma',
    description: 'Lista todos os projetos da Plataforma CSC com slug, progresso, quantidade de etapas, '
      + 'documentos e se possuem grafo. Use para descobrir o slug certo antes de publicar.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'csc_ver_projeto',
    title: 'Ler um projeto da plataforma',
    description: 'Traz o estado atual de um projeto na plataforma — etapas, tarefas, progresso e documentos. '
      + 'Use para saber onde o trabalho parou antes de continuar.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Projeto alvo. Padrao: o do manifesto.' } },
      additionalProperties: false
    }
  },

  // --- Leitura cruzada: este projeto consultando os vizinhos ---
  {
    name: 'csc_buscar',
    title: 'Buscar no ecossistema CSC',
    description: 'Procura um assunto na documentacao de TODOS os outros projetos da plataforma e devolve '
      + 'os trechos que casam, com o projeto e o arquivo de origem. Use antes de decidir arquitetura, '
      + 'escolher biblioteca, montar deploy ou resolver um problema que outro sistema da casa provavelmente '
      + 'ja enfrentou — por exemplo "como autenticamos", "deploy em swarm", "padrao de erro da API". '
      + 'Por padrao NAO busca no proprio projeto, porque este repositorio ja esta aberto aqui.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'O que procurar. Frases funcionam melhor que palavras soltas.' },
        projeto: { type: 'string', description: 'Restringe a busca a um projeto (slug). Padrao: todos os outros.' },
        limite: { type: 'number', description: 'Quantos trechos trazer. Padrao 12, maximo 40.' },
        incluirProprio: { type: 'boolean', description: 'Incluir tambem este projeto na busca. Padrao: false.' }
      },
      required: ['q'],
      additionalProperties: false
    }
  },
  {
    name: 'csc_ler_doc',
    title: 'Ler um documento de outro projeto',
    description: 'Le o markdown completo de um documento publicado por qualquer projeto da plataforma. '
      + 'O caminho normalmente vem de um resultado do csc_buscar. Use quando o trecho da busca nao bastar '
      + 'e voce precisar do documento inteiro — a decisao registrada, o passo a passo, o contrato da API.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Slug do projeto dono do documento.' },
        path: { type: 'string', description: 'Caminho do documento, ex: docs/arquitetura.md' }
      },
      required: ['projeto', 'path'],
      additionalProperties: false
    }
  },
  {
    name: 'csc_ver_grafo',
    title: 'Ver a arquitetura de um projeto',
    description: 'Traz o grafo de arquitetura (graphify) de um projeto da plataforma: modulos, como se ligam '
      + 'e as comunidades detectadas. Use para entender a estrutura de outro sistema antes de integrar com ele. '
      + 'Sem "projeto", mostra o deste repositorio.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Slug do projeto. Padrao: o do manifesto local.' }
      },
      additionalProperties: false
    }
  }
];

// ----------------------------------------------------------
// Execucao das ferramentas
// ----------------------------------------------------------

// A config e relida a cada chamada: o manifesto pode ter sido
// editado durante a sessao (etapas novas, por exemplo).
function config() {
  return nucleo.carregarConfig();
}

async function executar(nome, args) {
  const a = args || {};
  switch (nome) {
    case 'csc_status': {
      const cfg = config();
      try {
        const s = await nucleo.status(cfg);
        return 'Conectado a ' + s.apiUrl + '\n'
          + 'Projeto local: ' + s.raiz + '\n'
          + 'Manifesto: ' + s.manifesto + (s.slug ? ' (slug: ' + s.slug + ')' : '') + '\n'
          + 'Etapas declaradas: ' + s.etapasDeclaradas + '\n'
          + 'Grafo do graphify local: ' + (s.grafoLocal ? 'sim' : 'nao (rode /graphify)');
      } catch (e) {
        return 'Sem conexao com ' + cfg.apiUrl + ': ' + e.message
          + '\nProjeto local: ' + cfg.raiz
          + '\nChave configurada: ' + (cfg.apiKey ? 'sim' : 'nao');
      }
    }

    case 'csc_sync_projeto': {
      const r = await nucleo.sincronizar(config(), a);
      return (r.criado ? 'Projeto CRIADO' : 'Projeto atualizado') + ' na plataforma (' + r.url + ')\n'
        + 'Slug: ' + r.projeto.slug + '  |  Progresso geral: ' + r.projeto.percentualGeral + '%\n'
        + 'Etapas: ' + r.projeto.fases + '  |  Documentos: ' + r.projeto.docs
        + '  |  Nos no grafo: ' + r.projeto.grafo + '\n'
        + 'Commit publicado: ' + r.enviado.commit;
    }

    case 'csc_atualizar_etapa': {
      const r = await nucleo.atualizarEtapa(config(), a);
      return 'Etapa "' + r.etapa.titulo + '" -> ' + r.etapa.status + ' (' + r.etapa.percentual + '%)\n'
        + 'Progresso geral do projeto: ' + r.percentualGeral + '%';
    }

    case 'csc_registrar_doc': {
      const r = await nucleo.registrarDoc(config(), a);
      return 'Documento publicado. O projeto tem agora ' + r.docs + ' documento(s) na aba Documentacao.';
    }

    case 'csc_enviar_grafo': {
      const r = await nucleo.enviarGrafo(config(), a);
      return 'Grafo publicado: ' + r.nodes + ' nos, ' + r.edges + ' arestas'
        + (r.truncado ? ' (grafo grande — truncado no limite da plataforma).' : '.');
    }

    case 'csc_listar_projetos': {
      const r = await nucleo.listarProjetos(config());
      if (!r.projetos.length) return 'Nenhum projeto na plataforma.';
      const linhas = r.projetos.map(p =>
        '- ' + p.slug + '  "' + p.nome + '"  ' + p.percentualGeral + '%  '
        + p.fases + ' etapas, ' + p.docs + ' docs' + (p.temGrafo ? ', com grafo' : '')
        + '  [' + p.origem + ']');
      return r.projetos.length + ' projeto(s):\n' + linhas.join('\n');
    }

    case 'csc_ver_projeto': {
      const r = await nucleo.verProjeto(config(), a);
      const p = r.projeto;
      const etapas = (p.fases || []).map(f =>
        '  - ' + f.titulo + ': ' + f.percentual + '% (' + f.status + ') — '
        + (f.tarefas || []).length + ' tarefa(s)');
      const caminhosDocs = (p.docs || []).map(d => d.path);
      return '"' + p.nome + '" (' + (p.slug || p.id) + ')\n'
        + 'Progresso geral: ' + (p.percentualGeral || 0) + '%  |  '
        + (p.horasConcluidas || 0) + 'h de ' + (p.horasTotaisEstimadas || 0) + 'h\n'
        + 'Ultimo sync: ' + (p.sincronizadoEm || 'nunca') + '\n'
        + 'Etapas:\n' + (etapas.length ? etapas.join('\n') : '  (nenhuma)') + '\n'
        + 'Documentos: ' + (caminhosDocs.length ? caminhosDocs.join(', ') : '(nenhum)');
    }

    case 'csc_buscar': {
      const r = await nucleo.buscar(config(), a);
      if (!r.resultados.length) {
        return 'Nenhum projeto da plataforma documentou "' + r.termo + '". '
          + 'Voce esta resolvendo isso primeiro — vale registrar em docs/ e publicar.';
      }
      const blocos = r.resultados.map(x =>
        '### ' + x.projeto + '  —  ' + x.path + (x.titulo ? '  (' + x.titulo + ')' : '') + '\n'
        + x.trecho + '\n'
        + '_ler completo: csc_ler_doc projeto="' + x.projeto + '" path="' + x.path + '"_');
      return r.total + ' resultado(s) para "' + r.termo + '", mostrando ' + r.resultados.length + ':\n\n'
        + blocos.join('\n\n');
    }

    case 'csc_ler_doc': {
      const r = await nucleo.lerDoc(config(), a);
      return '# ' + r.doc.titulo + '\n'
        + '_projeto ' + r.projeto + ' — ' + r.doc.path
        + (r.doc.atualizadoEm ? ', atualizado em ' + r.doc.atualizadoEm : '') + '_\n\n'
        + r.doc.markdown;
    }

    case 'csc_ver_grafo': {
      const r = await nucleo.verGrafo(config(), a);
      const g = r.grafo;
      const comunidades = (g.comunidades || []).map(c => '  - ' + c.titulo + (c.resumo ? ': ' + c.resumo : ''));

      // Amostra dos modulos mais conectados: o grafo inteiro nao cabe
      // numa resposta, e o que importa e o esqueleto do sistema.
      const grau = new Map();
      (g.edges || []).forEach(e => {
        grau.set(e.origem, (grau.get(e.origem) || 0) + 1);
        grau.set(e.destino, (grau.get(e.destino) || 0) + 1);
      });
      const centrais = (g.nodes || [])
        .map(n => ({ no: n, ligacoes: grau.get(n.id) || 0 }))
        .sort((x, y) => y.ligacoes - x.ligacoes)
        .slice(0, 15)
        .map(x => '  - ' + x.no.label + ' (' + x.no.tipo + ', ' + x.ligacoes + ' ligacoes)'
          + (x.no.arquivo ? '  ' + x.no.arquivo : ''));

      return 'Arquitetura de "' + r.projeto + '": '
        + (g.nodes || []).length + ' nos, ' + (g.edges || []).length + ' ligacoes'
        + (g.truncado ? ' (grafo truncado no limite da plataforma)' : '') + '\n\n'
        + 'Comunidades:\n' + (comunidades.length ? comunidades.join('\n') : '  (nenhuma detectada)') + '\n\n'
        + 'Modulos mais conectados:\n' + (centrais.length ? centrais.join('\n') : '  (nenhum)');
    }

    default:
      throw new Error('Ferramenta desconhecida: ' + nome);
  }
}

// ----------------------------------------------------------
// Camada JSON-RPC / MCP
// ----------------------------------------------------------

function enviar(mensagem) {
  process.stdout.write(JSON.stringify(mensagem) + '\n');
}

function responder(id, resultado) {
  enviar({ jsonrpc: '2.0', id, result: resultado });
}

function responderErro(id, codigo, mensagem) {
  enviar({ jsonrpc: '2.0', id, error: { code: codigo, message: mensagem } });
}

async function tratar(msg) {
  // Notificacoes (sem id) nunca recebem resposta.
  const ehNotificacao = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize': {
      const pedida = msg.params && msg.params.protocolVersion;
      responder(msg.id, {
        protocolVersion: pedida || VERSAO_PROTOCOLO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: INFO_SERVIDOR
      });
      return;
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;

    case 'ping':
      if (!ehNotificacao) responder(msg.id, {});
      return;

    case 'tools/list':
      responder(msg.id, { tools: FERRAMENTAS });
      return;

    case 'tools/call': {
      const nome = msg.params && msg.params.name;
      try {
        const texto = await executar(nome, msg.params && msg.params.arguments);
        responder(msg.id, { content: [{ type: 'text', text: texto }] });
      } catch (e) {
        // Erro de execucao volta como resultado com isError, nao como
        // erro de protocolo — assim o modelo le a mensagem e se corrige.
        responder(msg.id, {
          content: [{ type: 'text', text: 'Falhou: ' + e.message }],
          isError: true
        });
      }
      return;
    }

    default:
      if (!ehNotificacao) responderErro(msg.id, -32601, 'Metodo nao suportado: ' + msg.method);
  }
}

let buffer = '';
// Chamadas em voo. O stdin pode fechar enquanto uma publicacao ainda
// esta na rede; sair na hora perderia a resposta.
let pendentes = 0;
let stdinFechado = false;

function talvezEncerrar() {
  if (stdinFechado && pendentes === 0) process.exit(0);
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (pedaco) => {
  buffer += pedaco;
  let quebra;
  while ((quebra = buffer.indexOf('\n')) !== -1) {
    const linha = buffer.slice(0, quebra).trim();
    buffer = buffer.slice(quebra + 1);
    if (!linha) continue;
    let msg;
    try {
      msg = JSON.parse(linha);
    } catch (e) {
      log('linha invalida ignorada: ' + linha.slice(0, 120));
      continue;
    }
    pendentes++;
    Promise.resolve(tratar(msg))
      .catch(e => {
        log('erro inesperado: ' + (e && e.stack ? e.stack : e));
        if (msg.id !== undefined && msg.id !== null) {
          responderErro(msg.id, -32603, 'Erro interno: ' + (e && e.message ? e.message : String(e)));
        }
      })
      .finally(() => { pendentes--; talvezEncerrar(); });
  }
});

process.stdin.on('end', () => { stdinFechado = true; talvezEncerrar(); });
log('servidor pronto (API: ' + nucleo.carregarConfig().apiUrl + ')');
