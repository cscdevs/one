# one — modelo de projeto CSC

Este é o repositório que a gente **clona a cada projeto novo**. Ele não traz código de
aplicação: traz o arnês que liga um projeto à [Plataforma de Projetos CSC](https://spark.csc.dev.br)
e ao ecossistema dos outros sistemas da casa. Serve para qualquer stack — Node, Python,
PHP, o que for.

O que um clone ganha de graça:

- **as etapas do projeto aparecem na plataforma** — Lista, Kanban, Gantt, horas e percentual;
- **a documentação sobe sozinha** conforme você escreve, sem ninguém lembrar de publicar;
- **a arquitetura vira grafo** na aba Arquitetura, a partir do `/graphify`;
- **o Claude consegue perguntar aos outros projetos** como eles resolveram um problema
  antes de você resolver de novo.

---

## Começando um projeto

```bash
git clone https://github.com/cscdevs/one.git portal-fornecedor
cd portal-fornecedor
node bootstrap.cjs "Portal do Fornecedor"
```

O `bootstrap` dá nome e slug ao projeto, preenche os documentos e **tira o `origin` do modelo
do caminho** — renomeia para `modelo`, de forma que um `git push` distraído não tenha como
acertar o `cscdevs/one`. Depois é só apontar para o repositório de verdade:

```bash
git remote add origin https://github.com/cscdevs/portal-fornecedor.git
git push -u origin main
```

Opções úteis: `--slug=`, `--repo=<url>` (já configura o origin), `--resumo="..."`, `--sync`
(publica na plataforma no fim).

## Uma vez por máquina

A publicação usa uma **chave de serviço**, não o seu login — quem publica é a máquina.
Ela nunca entra no repositório.

Peça a chave a um administrador da plataforma. Ele gera em
**[spark.csc.dev.br](https://spark.csc.dev.br) → Admin → Chaves MCP**: dá um nome à chave
(normalmente o do projeto) e entrega o valor. A chave aparece **uma única vez** — a
plataforma guarda só o hash dela. Se você perder, peça outra; a antiga é revogada.

```powershell
setx CSC_API_KEY "csc_..."
```

`setx` só vale em processos novos: abra um terminal novo depois. Para apontar para um
backend local em vez de produção, `setx CSC_API_URL "http://localhost:3002"`.

Uma chave por projeto é o padrão: assim dá para revogar a de um repositório sem derrubar
a publicação dos outros. E o log de auditoria da plataforma passa a mostrar qual chave
publicou o quê.

## Depois disso

Abra o Claude Code na pasta e trabalhe normalmente. A partir daí:

| Quando | O que acontece |
| --- | --- |
| Você edita um `.md`, o manifesto, ou faz um commit | O hook publica em segundo plano (no máximo a cada 45s) |
| A sessão do Claude termina | Sync completo, incluindo o grafo |
| Você fecha uma etapa | O Claude chama `csc_atualizar_etapa` e a plataforma recalcula o progresso |
| Você quer saber como outro sistema resolveu algo | `/csc-buscar autenticação com supabase` |

Nada disso trava a sessão: se a rede cair, o hook falha em silêncio e o próximo sync recupera.

---

## O que tem dentro

| Caminho | Para que serve |
| --- | --- |
| `csc.project.json` | Manifesto: slug, nome e a **sequência de etapas**. É a fonte da verdade do plano. |
| `.csc/` | Runtime do MCP, **gerado** — cópia de `Plataforma-csc/mcp-csc/`. Não edite aqui. |
| `.mcp.json` | Registra o servidor MCP `csc` para o Claude Code (caminho relativo, funciona em qualquer máquina). |
| `.claude/settings.json` | Os dois hooks de sync: durante a sessão e ao encerrar. |
| `.claude/commands/` | `/csc-sync` e `/csc-buscar`. |
| `CLAUDE.md` | Instrui o Claude a fechar etapas e a consultar os outros projetos. |
| `docs/` | Onde a documentação do projeto mora. **Tudo aqui vai para a plataforma.** |
| `bootstrap.cjs` | O passo único de configuração, logo depois do clone. |

Detalhes de como a integração funciona por dentro: [docs/PLATAFORMA-CSC.md](docs/PLATAFORMA-CSC.md).

## Trazendo melhorias do modelo

O `bootstrap` guarda o modelo como remoto `modelo`. Quando o arnês evoluir:

```bash
git pull modelo main
```

## Mantendo o modelo (só quem mexe no arnês)

O `.csc/` é **gerado** a partir de `Plataforma-csc/mcp-csc/` — a fonte da verdade. Depois de
mexer no servidor MCP:

```bash
cd Plataforma-csc
node scripts/gerar-template.cjs ../one
cd ../one && git commit -am "chore: atualiza runtime do modelo" && git push
```

O resto do arnês (`.mcp.json`, hooks, comandos, `CLAUDE.md`) sai do próprio `init.js` em modo
`--relativo`, então também não tem como divergir do que os projetos antigos usam.
