#!/usr/bin/env node
// ==========================================================
// BOOTSTRAP  —  transforma um clone do modelo num projeto
// ----------------------------------------------------------
// Rode uma vez, logo depois de clonar:
//
//   node bootstrap.cjs "Portal do Fornecedor"
//
// O que ele faz:
//   1. da nome e slug ao projeto no csc.project.json
//   2. troca os marcadores do CLAUDE.md e do README.md
//   3. tira o "origin" do modelo do caminho, para um push
//      distraido nunca acertar o repositorio-modelo
//   4. diz o que falta para a plataforma comecar a receber
//
// Opcoes:
//   --slug=meu-projeto     slug explicito (padrao: derivado do nome)
//   --repo=<url>           ja aponta o origin para o repo novo
//   --resumo="..."         resumo curto exibido na plataforma
//   --sync                 publica na plataforma ao terminar
//
// Extensao .cjs de proposito: o projeto pode declarar
// "type": "module" no package.json dele, e este arquivo
// precisa continuar carregando do mesmo jeito.
// ==========================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = __dirname;
const REPO_MODELO = /cscdevs\/one(\.git)?$/i;

// RegExp montada assim para o arquivo continuar em ASCII puro.
const ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

function slugificar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(ACENTOS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}

function substituirMarcadores(arquivo, valores) {
  const completo = path.join(RAIZ, arquivo);
  if (!fs.existsSync(completo)) return false;
  let texto = fs.readFileSync(completo, 'utf-8');
  const antes = texto;
  for (const [marcador, valor] of Object.entries(valores)) {
    texto = texto.split('{{' + marcador + '}}').join(valor);
  }
  if (texto === antes) return false;
  fs.writeFileSync(completo, texto, 'utf-8');
  return true;
}

// O README do clone explica o MODELO. Depois do bootstrap ele tem que
// explicar o PROJETO — quem chega no repositorio novo nao quer ler
// instrucoes de como clonar o modelo de novo.
function readmeDoProjeto(nome, slug, resumo) {
  return [
    '# ' + nome,
    '',
    resumo || '<!-- Um parágrafo: o que este sistema faz e para quem. -->',
    '',
    '## Acompanhamento',
    '',
    'Este projeto é acompanhado na [Plataforma de Projetos CSC](https://csc.pportz.com.br)',
    'sob o slug `' + slug + '`. As etapas ficam em [`csc.project.json`](csc.project.json) e a',
    'documentação de [`docs/`](docs/) sobe sozinha a cada sessão do Claude Code.',
    '',
    'Como a integração funciona: [docs/PLATAFORMA-CSC.md](docs/PLATAFORMA-CSC.md).',
    '',
    '## Rodando o projeto',
    '',
    '<!-- Pré-requisitos, instalação e como subir localmente. -->',
    '',
    '## Documentação',
    '',
    '- [Arquitetura](docs/ARQUITETURA.md) — como o sistema está montado e por quê',
    '- [Decisões](docs/DECISOES.md) — o que foi decidido e o que foi descartado',
    ''
  ].join('\n');
}

function principal() {
  const argv = process.argv.slice(2);
  const posicionais = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else {
      posicionais.push(a);
    }
  }

  const nome = posicionais.join(' ').trim() || path.basename(RAIZ);
  const slug = slugificar(flags.slug || nome);
  if (!slug) throw new Error('Nao consegui derivar um slug de "' + nome + '". Use --slug=meu-projeto.');

  const feito = [];

  // --- 1. Manifesto ---
  const arquivoManifesto = path.join(RAIZ, 'csc.project.json');
  const manifesto = JSON.parse(fs.readFileSync(arquivoManifesto, 'utf-8'));
  if (manifesto.slug && manifesto.slug !== slug) {
    console.log('Atencao: este repositorio ja era o projeto "' + manifesto.slug + '".');
    console.log('Mudar o slug cria um projeto NOVO na plataforma; o antigo fica la, parado.\n');
  }
  manifesto.slug = slug;
  manifesto.nome = nome;
  if (flags.resumo) manifesto.resumo = flags.resumo;
  if (flags.repo) manifesto.repo = flags.repo;
  fs.writeFileSync(arquivoManifesto, JSON.stringify(manifesto, null, 2) + '\n', 'utf-8');
  feito.push('csc.project.json  (nome: "' + nome + '", slug: ' + slug + ')');

  // --- 2. Marcadores nos documentos ---
  const valores = { NOME_DO_PROJETO: nome, SLUG: slug };
  for (const arquivo of ['CLAUDE.md', 'docs/ARQUITETURA.md', 'docs/DECISOES.md']) {
    if (substituirMarcadores(arquivo, valores)) feito.push(arquivo + '  (nome e slug preenchidos)');
  }

  // --- 3. README: do modelo para o projeto ---
  // So troca se ainda for o README do modelo — um README ja escrito
  // pelo time nao pode ser apagado por um bootstrap rodado de novo.
  const arquivoReadme = path.join(RAIZ, 'README.md');
  const readmeAtual = fs.existsSync(arquivoReadme) ? fs.readFileSync(arquivoReadme, 'utf-8') : '';
  if (readmeAtual.includes('modelo de projeto CSC')) {
    fs.writeFileSync(arquivoReadme, readmeDoProjeto(nome, slug, flags.resumo), 'utf-8');
    feito.push('README.md  (agora descreve o projeto, nao o modelo)');
  }

  // --- 4. Origin do modelo fora do caminho ---
  // Vira "modelo": continua dando para trazer melhorias do template
  // com "git pull modelo main", mas "git push" nao tem mais para onde
  // ir sozinho — nao tem como empurrar seu projeto para o cscdevs/one.
  const origem = git(['config', '--get', 'remote.origin.url']);
  if (REPO_MODELO.test(origem)) {
    git(['remote', 'rename', 'origin', 'modelo']);
    feito.push('git remote  (origin do modelo renomeado para "modelo")');
  }
  if (flags.repo) {
    git(['remote', 'remove', 'origin']);
    const r = git(['remote', 'add', 'origin', String(flags.repo)]);
    if (r !== undefined) feito.push('git remote  (origin -> ' + flags.repo + ')');
  }

  // --- Relatorio ---
  console.log('Projeto configurado: ' + nome + '  (' + slug + ')\n');
  feito.forEach(f => console.log('  ' + f));

  console.log('\nFalta:');
  let passo = 1;
  if (!process.env.CSC_API_KEY) {
    console.log('  ' + (passo++) + '. Definir a chave de ingestao (uma vez por maquina):');
    console.log('       setx CSC_API_KEY "<a chave do backend>"');
    console.log('     Depois abra um terminal novo — setx so vale em processos novos.');
  }
  if (!flags.repo && REPO_MODELO.test(origem)) {
    console.log('  ' + (passo++) + '. Criar o repositorio no GitHub e apontar o origin:');
    console.log('       git remote add origin https://github.com/cscdevs/' + slug + '.git');
  }
  console.log('  ' + (passo++) + '. Ajustar as etapas em csc.project.json para o plano real deste projeto.');
  console.log('  ' + (passo++) + '. Publicar:  node .csc/cli.js sync');
  console.log('     (ou, dentro do Claude Code, a ferramenta csc_sync_projeto)');

  if (flags.sync) {
    console.log('\nPublicando...');
    try {
      const saida = execFileSync(process.execPath, [path.join(RAIZ, '.csc', 'cli.js'), 'sync'],
        { cwd: RAIZ, encoding: 'utf-8' });
      console.log(saida.trim());
    } catch (e) {
      console.error('Falhou: ' + ((e.stdout || '') + (e.stderr || '')).trim());
    }
  }
}

try {
  principal();
} catch (e) {
  console.error('Erro: ' + e.message);
  process.exit(1);
}
