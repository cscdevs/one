// ==========================================================
// ARQUIVO GERADO — NAO EDITE AQUI
// ----------------------------------------------------------
// Copia de Plataforma-csc/mcp-csc/sync-core.js. Para alterar,
// edite o original e rode:  node scripts/gerar-template.cjs
// Editar esta copia faz o modelo divergir em silencio.
// ==========================================================
// ==========================================================
// NUCLEO DE SINCRONIZACAO
// ----------------------------------------------------------
// Le um repositorio local (manifesto + documentacao + grafo do
// graphify) e publica em /api/ingest da Plataforma CSC.
//
// Compartilhado por:
//   - server.js  (servidor MCP, usado pelo Claude Code)
//   - cli.js     (comando csc-sync, usado pelo hook e por voce)
//
// Sem dependencias externas: Node 20+ ja tem fetch global.
// ==========================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const API_URL_PADRAO = 'https://spark.csc.dev.br';
const MANIFESTO = 'csc.project.json';

// Pastas que nunca entram na coleta de documentacao.
const IGNORAR = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'coverage', 'vendor', '.venv', '__pycache__', 'uploads', '.claude'
]);

const MAX_DOCS = 100;
const MAX_DOC_BYTES = 180 * 1024;

// ----------------------------------------------------------
// Configuracao
// ----------------------------------------------------------

// Sobe a arvore de diretorios procurando o manifesto — assim o
// sync funciona mesmo chamado de dentro de uma subpasta do repo.
function acharRaiz(inicio) {
  let dir = path.resolve(inicio);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, MANIFESTO))) return dir;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return null;
}

function lerManifesto(raiz) {
  const arquivo = path.join(raiz, MANIFESTO);
  if (!fs.existsSync(arquivo)) return null;
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  } catch (e) {
    throw new Error('O ' + MANIFESTO + ' esta com JSON invalido: ' + e.message);
  }
}

function carregarConfig(dirInformado) {
  const base = dirInformado || process.env.CSC_PROJECT_DIR || process.cwd();
  const raiz = acharRaiz(base);
  const manifesto = raiz ? lerManifesto(raiz) : null;

  // Precedencia: variavel de ambiente > manifesto > padrao (producao).
  const apiUrl = (process.env.CSC_API_URL
    || (manifesto && manifesto.apiUrl)
    || API_URL_PADRAO).replace(/\/+$/, '');

  return {
    raiz: raiz || path.resolve(base),
    temManifesto: !!raiz,
    manifesto: manifesto || {},
    apiUrl,
    apiKey: process.env.CSC_API_KEY || (manifesto && manifesto.apiKey) || ''
  };
}

// ----------------------------------------------------------
// Coleta no repositorio
// ----------------------------------------------------------

function infoGit(raiz) {
  const rodar = (args) => {
    try {
      return execFileSync('git', args, { cwd: raiz, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
      return '';
    }
  };
  return {
    repo: rodar(['config', '--get', 'remote.origin.url']),
    commit: rodar(['rev-parse', '--short', 'HEAD']),
    branch: rodar(['rev-parse', '--abbrev-ref', 'HEAD'])
  };
}

function listarMarkdown(dir, raiz, profundidade, saida) {
  if (profundidade < 0 || saida.length >= MAX_DOCS) return;
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entradas) {
    if (saida.length >= MAX_DOCS) return;
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORAR.has(e.name)) continue;
      listarMarkdown(completo, raiz, profundidade - 1, saida);
    } else if (/\.(md|markdown)$/i.test(e.name)) {
      saida.push(completo);
    }
  }
}

// Monta a lista de documentos. Se o manifesto declara "docs",
// respeita exatamente essa lista (arquivos ou pastas); senao usa
// o padrao: markdown da raiz + tudo dentro de docs/.
function listarAlvosDocs(raiz, manifesto) {
  const alvos = [];

  if (Array.isArray(manifesto.docs) && manifesto.docs.length > 0) {
    for (const entrada of manifesto.docs) {
      const completo = path.resolve(raiz, entrada);
      if (!completo.startsWith(path.resolve(raiz))) continue; // nao escapa do repo
      if (!fs.existsSync(completo)) continue;
      if (fs.statSync(completo).isDirectory()) {
        listarMarkdown(completo, raiz, 4, alvos);
      } else {
        alvos.push(completo);
      }
    }
  } else {
    listarMarkdown(raiz, raiz, 0, alvos);
    const pastaDocs = path.join(raiz, 'docs');
    if (fs.existsSync(pastaDocs)) listarMarkdown(pastaDocs, raiz, 4, alvos);
  }

  // O relatorio do graphify e documentacao de arquitetura de primeira classe.
  const relatorio = path.join(raiz, 'graphify-out', 'GRAPH_REPORT.md');
  if (fs.existsSync(relatorio)) alvos.push(relatorio);

  return alvos;
}

// Le os documentos. O "filtro" opcional recebe (caminho, assinatura) e
// decide se o documento entra no envio — e assim que o sync incremental
// manda so o que mudou, em vez do repositorio inteiro a cada gatilho.
function coletarDocs(raiz, manifesto, filtro) {
  const alvos = listarAlvosDocs(raiz, manifesto);
  const assinaturas = {};
  const vistos = new Set();
  const docs = [];
  for (const arquivo of alvos) {
    const rel = path.relative(raiz, arquivo).split(path.sep).join('/');
    if (vistos.has(rel)) continue;
    vistos.add(rel);
    let conteudo;
    try {
      const st = fs.statSync(arquivo);
      // Tamanho + mtime bastam para saber se o arquivo mudou, e custam
      // um stat — o hook roda entre ferramentas e nao pode ler tudo.
      const assinatura = st.size + ':' + Math.floor(st.mtimeMs);
      assinaturas[rel] = assinatura;
      if (filtro && !filtro(rel, assinatura)) continue;
      if (st.size > MAX_DOC_BYTES) {
        conteudo = fs.readFileSync(arquivo, 'utf-8').slice(0, MAX_DOC_BYTES)
          + '\n\n> _(arquivo grande — truncado no envio)_';
      } else {
        conteudo = fs.readFileSync(arquivo, 'utf-8');
      }
    } catch (e) {
      delete assinaturas[rel];
      continue;
    }
    // Titulo: primeiro heading do markdown, com o nome do arquivo como reserva.
    const heading = conteudo.match(/^#\s+(.+)$/m);
    docs.push({
      path: rel,
      titulo: heading ? heading[1].trim() : path.basename(arquivo),
      markdown: conteudo
    });
  }
  return { docs, assinaturas };
}

function lerGrafo(raiz) {
  const arquivo = path.join(raiz, 'graphify-out', 'graph.json');
  if (!fs.existsSync(arquivo)) return null;
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------------
// Estado local  —  o que sustenta o sync incremental
// ----------------------------------------------------------
// O hook PostToolUse dispara entre uma ferramenta e outra do
// Claude Code, ou seja: muitas vezes por minuto. Publicar em
// todas seria absurdo. Entao guardamos, FORA do repositorio,
// uma assinatura do que ja foi publicado e o instante do
// ultimo envio; o hook so chama a rede quando algo que a
// plataforma exibe realmente mudou, e no maximo a cada 45s.
//
// O estado vive no temp do sistema, indexado pelo caminho do
// repositorio: nada de sujar o projeto nem de pedir gitignore.
// Perder esse arquivo nao quebra nada — custa um sync extra.

const INTERVALO_MINIMO_MS = 45 * 1000;

function arquivoEstado(raiz) {
  const chave = crypto.createHash('sha1')
    .update(path.resolve(raiz).toLowerCase())
    .digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'csc-sync', chave + '.json');
}

function lerEstado(raiz) {
  try {
    return JSON.parse(fs.readFileSync(arquivoEstado(raiz), 'utf-8'));
  } catch (e) {
    return {};
  }
}

function salvarEstado(raiz, estado) {
  try {
    const arquivo = arquivoEstado(raiz);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, JSON.stringify(estado), 'utf-8');
  } catch (e) {
    // Estado e otimizacao, nunca requisito: falhar aqui e silencioso.
  }
}

function assinaturaArquivo(arquivo) {
  try {
    const st = fs.statSync(arquivo);
    return st.size + ':' + Math.floor(st.mtimeMs);
  } catch (e) {
    return '';
  }
}

function assinaturaGrafo(raiz) {
  return assinaturaArquivo(path.join(raiz, 'graphify-out', 'graph.json'));
}

// HEAD muda ao trocar de branch; o arquivo da ref muda a cada commit.
// Ler dois arquivos e muito mais barato que abrir um processo git.
function assinaturaGit(raiz) {
  const head = path.join(raiz, '.git', 'HEAD');
  let assinatura = assinaturaArquivo(head);
  try {
    const conteudo = fs.readFileSync(head, 'utf-8').trim();
    const ref = conteudo.startsWith('ref:') ? conteudo.slice(4).trim() : null;
    if (ref) assinatura += '/' + assinaturaArquivo(path.join(raiz, '.git', ref));
    else assinatura += '/' + conteudo.slice(0, 12);
  } catch (e) {
    // Sem git no projeto: fica so a assinatura vazia.
  }
  return assinatura;
}

// Assinatura do que a plataforma mostra: manifesto, documentacao,
// grafo e o ponteiro do git (commit e branch aparecem na ficha do
// projeto). Mudanca em codigo-fonte NAO conta — ela nao altera
// nada que esteja publicado ate o graphify rodar de novo.
function assinaturaRepo(config) {
  const raiz = config.raiz;
  const partes = [
    'manifesto=' + assinaturaArquivo(path.join(raiz, MANIFESTO)),
    'grafo=' + assinaturaGrafo(raiz),
    'git=' + assinaturaGit(raiz)
  ];
  for (const arquivo of listarAlvosDocs(raiz, config.manifesto)) {
    partes.push(path.relative(raiz, arquivo).split(path.sep).join('/')
      + '=' + assinaturaArquivo(arquivo));
  }
  return crypto.createHash('sha1').update(partes.join('|')).digest('hex');
}

// Decide se o gatilho vira publicacao. Nao grava nada: quem grava
// e quem de fato conseguiu publicar.
function avaliarIncremental(config, agora) {
  const estado = lerEstado(config.raiz);
  const assinatura = assinaturaRepo(config);
  const grafoAtual = assinaturaGrafo(config.raiz);

  if (estado.assinatura === assinatura) {
    return { sincronizar: false, motivo: 'nada mudou desde o ultimo envio', assinatura };
  }
  const desde = agora - (estado.ultimoSyncEm || 0);
  if (desde < INTERVALO_MINIMO_MS) {
    return {
      sincronizar: false,
      adiado: true,
      motivo: 'ultimo envio ha ' + Math.round(desde / 1000) + 's (minimo '
        + (INTERVALO_MINIMO_MS / 1000) + 's) — vai no proximo gatilho ou no fim da sessao',
      assinatura
    };
  }
  return {
    sincronizar: true,
    motivo: 'manifesto, documentacao ou grafo mudaram',
    assinatura,
    // Grafo grande nao viaja a toa: so quando o graphify rodou de novo.
    grafoMudou: grafoAtual !== '' && grafoAtual !== estado.assinaturaGrafo
  };
}

// ----------------------------------------------------------
// Comunicacao com a plataforma
// ----------------------------------------------------------

async function chamar(config, metodo, rota, corpo) {
  if (!config.apiKey) {
    throw new Error('CSC_API_KEY nao definida. Configure a chave de ingestao no .mcp.json ou no ambiente.');
  }
  const resposta = await fetch(config.apiUrl + '/api/ingest' + rota, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'X-CSC-Key': config.apiKey,
      'X-CSC-Origem': 'claude-code'
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });

  const texto = await resposta.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch (e) {
    throw new Error('Resposta nao-JSON de ' + config.apiUrl + ' (HTTP ' + resposta.status + '): ' + texto.slice(0, 200));
  }
  if (!resposta.ok) {
    const detalhe = dados.etapasDisponiveis
      ? ' Etapas disponiveis: ' + dados.etapasDisponiveis.join(', ')
      : (dados.tarefasDisponiveis ? ' Tarefas disponiveis: ' + dados.tarefasDisponiveis.join(', ') : '');
    throw new Error((dados.erro || 'HTTP ' + resposta.status) + detalhe);
  }
  return dados;
}

// ----------------------------------------------------------
// Operacoes
// ----------------------------------------------------------

function slugDoProjeto(config, slugInformado) {
  const slug = slugInformado || config.manifesto.slug;
  if (!slug) {
    throw new Error('Projeto sem slug em ' + MANIFESTO + '.'
      + ' Se este repositorio veio do modelo, rode:  node bootstrap.cjs "Nome do Projeto"'
      + ' Se e um repositorio antigo, rode o init do mcp-csc.');
  }
  return slug;
}

// Sync completo: manifesto + etapas + docs + grafo.
async function sincronizar(config, opcoes) {
  const op = opcoes || {};
  if (!config.temManifesto && !op.slug && !op.nome) {
    throw new Error('Nenhum ' + MANIFESTO + ' encontrado em ' + config.raiz
      + '. Rode o init para criar a base de integracao deste projeto.');
  }

  const m = config.manifesto;
  const git = infoGit(config.raiz);
  const incluirDocs = op.incluirDocs !== false;
  const incluirGrafo = op.incluirGrafo !== false;

  const payload = {
    slug: slugDoProjeto(config, op.slug),
    nome: op.nome || m.nome || path.basename(config.raiz),
    tipo: m.tipo || 'Sistema',
    resumo: op.resumo || m.resumo || '',
    repo: m.repo || git.repo,
    commit: git.commit,
    branch: git.branch
  };

  if (Array.isArray(m.etapas) && m.etapas.length > 0) payload.etapas = m.etapas;

  const coleta = incluirDocs
    ? coletarDocs(config.raiz, m, op.docsConhecidos
        ? (rel, assinatura) => op.docsConhecidos[rel] !== assinatura
        : null)
    : { docs: [], assinaturas: {} };
  if (coleta.docs.length > 0) payload.docs = coleta.docs;

  const grafo = incluirGrafo ? lerGrafo(config.raiz) : null;
  if (grafo) payload.grafo = grafo;

  const resultado = await chamar(config, 'POST', '/projeto', payload);
  return {
    ...resultado,
    enviado: {
      etapas: (payload.etapas || []).length,
      docs: coleta.docs.length,
      grafo: grafo ? (grafo.nodes || []).length : 0,
      commit: git.commit || '(sem git)'
    },
    assinaturasDocs: coleta.assinaturas,
    url: config.apiUrl
  };
}

async function atualizarEtapa(config, args) {
  const slug = slugDoProjeto(config, args.slug);
  return chamar(config, 'PATCH', '/projeto/' + encodeURIComponent(slug) + '/etapa', {
    etapa: args.etapa,
    tarefa: args.tarefa,
    status: args.status,
    progresso: args.progresso,
    nota: args.nota
  });
}

async function registrarDoc(config, args) {
  const slug = slugDoProjeto(config, args.slug);
  let markdown = args.markdown;
  let caminho = args.path;

  // Se veio so o caminho, le o arquivo do repo.
  if (markdown === undefined && caminho) {
    const completo = path.resolve(config.raiz, caminho);
    if (!completo.startsWith(path.resolve(config.raiz))) {
      throw new Error('Caminho fora do repositorio: ' + caminho);
    }
    if (!fs.existsSync(completo)) throw new Error('Arquivo nao encontrado: ' + caminho);
    markdown = fs.readFileSync(completo, 'utf-8');
    caminho = path.relative(config.raiz, completo).split(path.sep).join('/');
  }
  if (!caminho || markdown === undefined) throw new Error('Informe "path" (e opcionalmente "markdown").');

  return chamar(config, 'POST', '/projeto/' + encodeURIComponent(slug) + '/doc', {
    path: caminho, titulo: args.titulo, markdown
  });
}

async function enviarGrafo(config, args) {
  const slug = slugDoProjeto(config, args && args.slug);
  const grafo = lerGrafo(config.raiz);
  if (!grafo) {
    throw new Error('graphify-out/graph.json nao encontrado em ' + config.raiz + '. Rode /graphify neste projeto primeiro.');
  }
  return chamar(config, 'POST', '/projeto/' + encodeURIComponent(slug) + '/grafo', { grafo });
}

// ----------------------------------------------------------
// Leitura cruzada  —  consultar os outros sistemas
// ----------------------------------------------------------

// Busca na documentacao de todos os projetos da plataforma.
// Por padrao ignora o proprio projeto: quem pergunta ja esta com
// este repositorio aberto — o que interessa e o que os vizinhos
// ja resolveram.
async function buscar(config, args) {
  const a = args || {};
  const termo = String(a.q || a.termo || '').trim();
  if (termo.length < 2) throw new Error('Informe "q" com pelo menos 2 caracteres.');

  const params = new URLSearchParams({ q: termo });
  if (a.limite) params.set('limite', String(a.limite));
  if (a.projeto) params.set('projeto', a.projeto);
  const proprio = config.manifesto && config.manifesto.slug;
  if (proprio && !a.projeto && a.incluirProprio !== true) params.set('excluir', proprio);

  return chamar(config, 'GET', '/buscar?' + params.toString());
}

async function lerDoc(config, args) {
  const a = args || {};
  if (!a.projeto) throw new Error('Informe "projeto" (o slug do projeto dono do documento).');
  if (!a.path) throw new Error('Informe "path" do documento.');
  return chamar(config, 'GET', '/projeto/' + encodeURIComponent(a.projeto)
    + '/doc?path=' + encodeURIComponent(a.path));
}

async function verGrafo(config, args) {
  const slug = slugDoProjeto(config, args && args.projeto);
  return chamar(config, 'GET', '/projeto/' + encodeURIComponent(slug) + '/grafo');
}

async function listarProjetos(config) {
  return chamar(config, 'GET', '/projetos');
}

async function verProjeto(config, args) {
  const slug = slugDoProjeto(config, args && args.slug);
  return chamar(config, 'GET', '/projeto/' + encodeURIComponent(slug));
}

async function status(config) {
  const ping = await chamar(config, 'GET', '/ping');
  return {
    conectado: ping.sucesso === true,
    apiUrl: config.apiUrl,
    raiz: config.raiz,
    manifesto: config.temManifesto ? MANIFESTO + ' encontrado' : 'sem ' + MANIFESTO,
    slug: config.manifesto.slug || null,
    etapasDeclaradas: (config.manifesto.etapas || []).length,
    grafoLocal: !!lerGrafo(config.raiz),
    chaveConfigurada: !!config.apiKey
  };
}

module.exports = {
  API_URL_PADRAO, MANIFESTO,
  carregarConfig, lerManifesto, acharRaiz,
  coletarDocs, listarAlvosDocs, lerGrafo, infoGit,
  sincronizar, atualizarEtapa, registrarDoc, enviarGrafo,
  listarProjetos, verProjeto, status,
  buscar, lerDoc, verGrafo,
  lerEstado, salvarEstado, assinaturaRepo, assinaturaGrafo, avaliarIncremental,
  INTERVALO_MINIMO_MS
};
