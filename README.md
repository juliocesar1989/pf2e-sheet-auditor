# PF2e Sheet Auditor

Módulo independente para Foundry VTT que adiciona um botão **Audit Feats** ao cabeçalho da ficha de personagem do sistema **Pathfinder 2e (Remaster)**. Ao clicar, o módulo:

1. lê a ficha (perícias, lores, atributos, proficiências, sentidos, traços, ancestralidade, herança, classe, divindade, conjuração e itens);
2. interpreta o texto de pré-requisito de cada talento (`system.prerequisites.value`) e monta uma árvore E/OU;
3. avalia cada condição contra a ficha com lógica de três valores (✔ atendido, ✖ não atendido, ? não verificável);
4. aplica regras estruturais:
   - nível do talento acima do nível do personagem;
   - nível do talento acima do nível em que ele foi pego;
   - talentos que só podem ser pegos no 1º nível;
   - talentos pegos mais vezes do que o permitido (`maxTakable`);
   - regra de dedicação de arquétipo (dois talentos do arquétipo antes da próxima dedicação);
   - conteúdo legado (pré-Remaster);
   - raridade incomum ou rara;
5. abre uma janela com um **relatório HTML**, que pode ser baixado como arquivo independente (botão *Download HTML*).

## Escopo

- **Somente o sistema `pf2e` 7.0.0 ou mais novo (Remaster)**, no Foundry v13. Fora disso o botão não aparece e o GM recebe um aviso.
- **Somente inglês.** Os textos de pré-requisito são interpretados em inglês. Se o idioma do Foundry não for `en`, o módulo se desativa.
- Talentos de conteúdo legado continuam sendo auditados, mas recebem um aviso no relatório.

## Instalação pelo manifest

Em *Add-on Modules → Install Module*, cole:

```
https://github.com/juliocesar1989/pf2e-sheet-auditor/releases/latest/download/module.json
```

Isso funciona depois que houver um release no GitHub com os arquivos `module.json` e `module.zip` anexados. O zip deve conter a pasta do módulo.

## Instalação manual

1. Copie a pasta `pf2e-sheet-auditor` para `Data/modules/` do Foundry. O nome da pasta precisa ser igual ao `id` no `module.json`.
2. Ative o módulo no mundo (*Manage Modules*).
3. Abra a ficha de um personagem e clique em **Audit Feats** no cabeçalho.

Configuração: *GM only*, que mostra o botão só para o mestre.

API para macros:

```js
const api = game.modules.get("pf2e-sheet-auditor").api;
await api.runAudit(game.user.character);           // abre o relatório
const { report, html } = await api.auditActor(actor); // dados brutos + HTML
```

## Como os pré-requisitos são interpretados

| Texto (exemplo) | Verificação |
|---|---|
| `trained in Medicine`, `master in either Arcana, Nature, Occultism, or Religion` | grau de perícia (com listas "ou") |
| `expert in Warfare Lore`, `trained in Lore` | lore específica ou qualquer lore |
| `trained in at least one skill`, `... a skill with the Recall Knowledge action` | melhor perícia que se qualifica |
| `expert in Perception`, `expert in Will`, `trained in light or medium armor`, `trained in all martial weapons` | proficiências |
| `Strength +2`, `Strength, Dexterity, or Constitution +2` | modificador de atributo |
| `Battle Medicine`, `Fighter Dedication`, `Cat Fall skill feat` | item com esse nome/slug na ficha |
| `flame order`, `enigma muse`, `weapon innovation` | característica de subclasse |
| `snow goblin heritage`, `elf ancestry` | herança / ancestralidade (inclusive por traço) |
| `low-light vision`, `darkvision` | sentidos (darkvision satisfaz low-light vision) |
| `worshipper of Torag or Angradd`, `you follow a deity`, `deity who grants heal divine font` | divindade |
| `holy or unholy`, `you are not holy` | traço de santificação |
| `focus pool`, `ability to cast spells from spell slots`, `able to cast 3rd-rank spells`, `ability to cast fireball` | conjuração |
| `any nephilim lineage feat`, `at least two stances` | talentos com determinados traços |
| `you can't already use the Rage action` | negação |
| `member of the Zephyr Guard`, `You have died at least once` | **?** revisão manual |

Quando um nome não é encontrado na ficha, o módulo procura nos compêndios do sistema PF2e. Se o nome existe lá, o pré-requisito fica como **✖ não atendido**. Se não existe (homebrew, texto livre), fica como **? revisão manual**.

Contra uma amostra de 533 textos distintos de pré-requisitos dos compêndios PF2e, cerca de 96% das condições foram reconhecidas. O restante são condições narrativas, que vão para revisão manual.

## Limitações

- Os pré-requisitos são avaliados contra a ficha **atual**, e não contra o estado do personagem no nível em que o talento foi pego. O relatório lembra disso quando o talento envolve graus de perícia ou atributos.
- Talentos concedidos por outra habilidade (`flags.pf2e.grantedBy`) aparecem como *waived* quando os pré-requisitos não são atendidos, porque normalmente eles ignoram pré-requisitos.
- A ordem das dedicações depende de `system.level.taken` ou do slot do talento. Sem essa informação, a regra de dedicação vira aviso.

## Desenvolvimento

O código não depende do Foundry, com exceção de `scripts/main.js` e `scripts/actor-state.js`. Os testes usam o test runner nativo do Node, sem dependências:

```bash
cd pf2e-sheet-auditor
npm test
```

| Arquivo | Função |
|---|---|
| `scripts/parser.js` | texto → árvore de requisitos |
| `scripts/evaluator.js` | avaliação com três valores |
| `scripts/actor-state.js` | ator PF2e → estado simples |
| `scripts/auditor.js` | regras por talento e resumo |
| `scripts/report-html.js` | relatório HTML independente (com escape de todo o texto) |
| `scripts/main.js` | hooks, botão, janela, índice de compêndios |

A abordagem (árvore E/OU de requisitos, verificação por tipo de condição, estado do personagem derivado do ator) segue a ideia do módulo [PF2e Leveler](https://github.com/roileaf/pf2e-leveler). O código foi escrito do zero, porque o repositório do Leveler não declara licença.
