#!/usr/bin/env node
// ==========================================================
// ARQUIVO GERADO — NAO EDITE AQUI
// ----------------------------------------------------------
// Copia de Plataforma-csc/mcp-csc/cli.js. Para alterar,
// edite o original e rode:  node scripts/gerar-template.cjs
// Editar esta copia faz o modelo divergir em silencio.
// ==========================================================
// ==========================================================
// CLI  csc-sync
// ----------------------------------------------------------
// Mesma sincronizacao do servidor MCP, mas por linha de comando.
// Usada pelo hook de fim de sessao e pelo comando /csc-sync.
//
//   node cli.js status
//   node cli.js sync                     publica tudo
//   node cli.js sync --incremental       publica SO se algo mudou (hook)
//   node cli.js sync --sem-grafo         pula o graphify
//   node cli.js grafo                    publica so o grafo
//   node cli.js etapa "Backend" --status=Fechado
//   node cli.js etapa "Backend" --tarefa="API" --progresso=60
//   node cli.js listar
//   node cli.js buscar "autenticacao"    procura nos OUTROS projetos
//   node cli.js ler <projeto> <doc.md>   le um documento de outro projeto
//
// Flag --quieto: nao imprime nada em caso de sucesso e sempre
// sai com codigo 0. E como o hook roda, para que uma falha de
// rede nunca interrompa a sessao do Claude Code.
// ==========================================================

const { spawn } = require('child_process');
const nucleo = require('./sync-core');

function parsearArgs(argv) {
  const posicionais = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [chave, valor] = arg.slice(2).split('=');
      flags[chave] = valor === undefined ? true : valor;
    } else {
      posicionais.push(arg);
    }
  }
  return { posicionais, flags };
}

async function principal() {
  const { posicionais, flags } = parsearArgs(process.argv.slice(2));
  const comando = posicionais[0] || 'sync';
  const quieto = !!(flags.quieto || flags.quiet);
  const dizer = (txt) => { if (!quieto) console.log(txt); };

  const config = nucleo.carregarConfig(flags.dir);

  switch (comando) {
    case 'status': {
      try {
        const s = await nucleo.status(config);
        dizer('Plataforma:  ' + s.apiUrl + '  (conectado)');
        dizer('Projeto:     ' + s.raiz);
        dizer('Manifesto:   ' + s.manifesto + (s.slug ? '  slug=' + s.slug : ''));
        dizer('Etapas:      ' + s.etapasDeclaradas);
        dizer('Grafo local: ' + (s.grafoLocal ? 'sim' : 'nao — rode /graphify'));
      } catch (e) {
        dizer('Plataforma:  ' + config.apiUrl + '  (FALHOU: ' + e.message + ')');
        dizer('Chave:       ' + (config.apiKey ? 'configurada' : 'AUSENTE — defina CSC_API_KEY'));
        if (!quieto) process.exitCode = 1;
      }
      return;
    }

    case 'sync': {
      // --- Modo incremental: e assim que o hook PostToolUse roda ---
      // Nao publica direto. Decide se vale a pena e, se valer, solta a
      // publicacao num processo desanexado e devolve o controle na
      // hora — o Claude Code nao pode ficar esperando a rede entre uma
      // ferramenta e outra.
      if (flags.incremental) {
        const agora = Date.now();
        const decisao = nucleo.avaliarIncremental(config, agora);
        if (!decisao.sincronizar) {
          dizer('sem publicar: ' + decisao.motivo);
          return;
        }

        // Reserva a janela ANTES de soltar o filho: dois gatilhos quase
        // simultaneos nao podem virar duas publicacoes.
        nucleo.salvarEstado(config.raiz,
          Object.assign(nucleo.lerEstado(config.raiz), { ultimoSyncEm: agora }));

        const argumentos = [
          __filename, 'sync', '--quieto',
          '--dir=' + config.raiz,
          '--assinatura=' + decisao.assinatura,
          '--docs-alterados'
        ];
        // Grafo so viaja quando o graphify rodou de novo.
        if (!decisao.grafoMudou) argumentos.push('--sem-grafo');

        // Array de argumentos, nao linha de comando: caminho com espaco
        // (o nosso tem) atravessa inteiro sem depender de aspas.
        const filho = spawn(process.execPath, argumentos, { detached: true, stdio: 'ignore' });
        filho.unref();
        dizer('publicando em segundo plano: ' + decisao.motivo);
        return;
      }

      const estado = nucleo.lerEstado(config.raiz);
      const semGrafo = !!(flags['sem-grafo'] || flags['no-graph']);
      const semDocs = !!(flags['sem-docs'] || flags['no-docs']);

      const r = await nucleo.sincronizar(config, {
        incluirGrafo: !semGrafo,
        incluirDocs: !semDocs,
        docsConhecidos: flags['docs-alterados'] ? (estado.docs || {}) : null
      });

      // So marca como "em dia" o que de fato foi publicado: um envio
      // parcial nao pode fazer o resto parecer sincronizado.
      nucleo.salvarEstado(config.raiz, {
        ultimoSyncEm: Date.now(),
        assinatura: flags.assinatura
          || (!semGrafo && !semDocs ? nucleo.assinaturaRepo(config) : (estado.assinatura || '')),
        assinaturaGrafo: r.enviado.grafo > 0
          ? nucleo.assinaturaGrafo(config.raiz)
          : (estado.assinaturaGrafo || ''),
        docs: Object.assign({}, estado.docs, r.assinaturasDocs)
      });

      dizer((r.criado ? 'Criado' : 'Atualizado') + ': ' + r.projeto.nome + ' (' + r.projeto.slug + ')');
      dizer('  ' + r.projeto.fases + ' etapas | ' + r.projeto.docs + ' docs | '
        + r.projeto.grafo + ' nos | ' + r.projeto.percentualGeral + '%');
      dizer('  ' + r.url + '  commit ' + r.enviado.commit
        + '  (' + r.enviado.docs + ' doc(s) neste envio)');
      return;
    }

    case 'grafo': {
      const r = await nucleo.enviarGrafo(config, {});
      dizer('Grafo publicado: ' + r.nodes + ' nos, ' + r.edges + ' arestas');
      return;
    }

    case 'etapa': {
      const titulo = posicionais[1];
      if (!titulo) throw new Error('Uso: node cli.js etapa "<titulo>" [--tarefa=..] [--status=..] [--progresso=..] [--nota=..]');
      const r = await nucleo.atualizarEtapa(config, {
        etapa: titulo,
        tarefa: flags.tarefa,
        status: flags.status,
        progresso: flags.progresso !== undefined ? Number(flags.progresso) : undefined,
        nota: flags.nota
      });
      dizer(r.etapa.titulo + ' -> ' + r.etapa.status + ' (' + r.etapa.percentual + '%) | geral: ' + r.percentualGeral + '%');
      return;
    }

    case 'doc': {
      const caminho = posicionais[1];
      if (!caminho) throw new Error('Uso: node cli.js doc <caminho.md>');
      const r = await nucleo.registrarDoc(config, { path: caminho, titulo: flags.titulo });
      dizer('Documento publicado. Total: ' + r.docs);
      return;
    }

    case 'listar': {
      const r = await nucleo.listarProjetos(config);
      r.projetos.forEach(p => dizer(
        String(p.percentualGeral).padStart(3) + '%  ' + p.slug.padEnd(28)
        + p.fases + ' etapas, ' + p.docs + ' docs' + (p.temGrafo ? ', grafo' : '')));
      return;
    }

    // --- Leitura cruzada: perguntar aos outros sistemas ---
    case 'buscar': {
      const termo = posicionais.slice(1).join(' ');
      if (!termo) throw new Error('Uso: node cli.js buscar "<termo>" [--projeto=slug] [--limite=N]');
      const r = await nucleo.buscar(config, {
        q: termo,
        limite: flags.limite,
        projeto: flags.projeto,
        incluirProprio: !!flags['incluir-proprio']
      });
      if (!r.resultados.length) {
        dizer('Nada encontrado para "' + termo + '".');
        return;
      }
      dizer(r.total + ' resultado(s) para "' + termo + '" — mostrando ' + r.resultados.length + ':');
      r.resultados.forEach(x => {
        dizer('');
        dizer('  ' + x.projeto + '  ' + x.path + (x.titulo ? '  — ' + x.titulo : ''));
        dizer('    ' + x.trecho);
      });
      return;
    }

    case 'ler': {
      const projeto = posicionais[1];
      const caminho = posicionais[2];
      if (!projeto || !caminho) throw new Error('Uso: node cli.js ler <slug-do-projeto> <caminho.md>');
      const r = await nucleo.lerDoc(config, { projeto, path: caminho });
      dizer('# ' + r.doc.titulo + '   [' + r.projeto + ' / ' + r.doc.path + ']');
      dizer('');
      dizer(r.doc.markdown);
      return;
    }

    default:
      throw new Error('Comando desconhecido: ' + comando
        + '. Use: status | sync | grafo | etapa | doc | listar | buscar | ler');
  }
}

principal().catch(e => {
  const quieto = process.argv.includes('--quieto') || process.argv.includes('--quiet');
  if (quieto) {
    // No hook, a falha nunca deve travar a sessao — so registra e sai limpo.
    process.stderr.write('[csc-sync] ' + e.message + '\n');
    process.exit(0);
  }
  console.error('Erro: ' + e.message);
  process.exit(1);
});
