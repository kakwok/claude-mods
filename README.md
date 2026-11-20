# claude-mods

Two [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview). Needs Claude Code v2.1.287 or later.

**[▶ Try the interactive demo](https://kakwok.github.io/claude-mods/)** to see both in color, with sample data.

## Mods

### [context-bar](context-bar)

A band above the prompt.

- How full the context window is, by category (like `/context`), with Messages opened up by source (see below).
- Every category shows in its own color, under a short name (`sys prompt`, `tools`, `skills`, `mcp`, `mcp info`, `memory`, `agents`). The legend keeps to one line; only when it would need more at the terminal's width do the smallest categories fold into `other` (which shows their total), one at a time, until it fits. Messages and its parts, `compact` (the autocompact buffer) and free space never fold. To give the legend more room, set **Legend lines** for context-bar in `/config`.
- Your 5-hour and weekly plan usage, with reset times.
- The model, with the band's frame in that model family's color, so a wrong model stands out.
- After each turn, how much context the turn added: blue, amber from 5k, red from 20k.

#### How Messages is grouped

Messages is the conversation itself, usually the biggest category. The bar shows it as one block in shades of the
Messages color, with a part per source:

| Part | What it holds |
| --- | --- |
| `explore` | Results of reading and searching: Read, Grep, Glob, LS, NotebookRead |
| `actions` | Results of every other tool call: shell commands, edits, subagent calls, MCP tools, web |
| `replies` | What Claude wrote: answers and tool calls |
| `prompts` | What you sent, with what rides along (skill and tool listings, memory, git status). In a new session or after `/clear`, the first message counts here |
| `earlier` | Turns the mod never saw: a resumed session, or one it loaded into late |
| `summary` | The summary left by `/compact` |

The split is an estimate. After each turn the mod looks at how much Messages grew. The part up to the tokens Claude
generated goes to `replies`. The rest is shared between `explore` and `actions` by the size of what each one's tools
returned that turn, or goes to `prompts` if no tool ran. The parts are then scaled to add up to the real Messages total.
`/compact` and `/clear` start the split over. Until a turn adds a second part, Messages shows as one plain row.

`/context-bar` hides or shows it.

### [lens](lens)

A pane beside the chat with three tabs (keys `1`–`3`):

- **Activity**: files changed (the last turn's marked `●`), commands with pass/fail, recent tool calls.
- **Agents**: the plan checklist, how many tokens subagents spent outside your context (by agent type, with the biggest agents named; cache reads are not counted), subagents, and a timeline of what each one did.
- **Context**: what Claude Code added to the prompt, memory files, MCP servers and skills.

`/lens` opens or closes it, and `/lens demo` fills it with sample data. If an organization plugin
blocks the Context tab, turn off **Show what Claude Code adds to the prompt** for lens in `/config`.

## Install

This repository is a plugin marketplace. At the prompt of a terminal session:

```
/plugin install context-bar --marketplace kakwok/claude-mods
/plugin install lens --marketplace kakwok/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user loads it in every session). From a shell, use
`claude plugin install <mod> --marketplace kakwok/claude-mods`. In the desktop app, click + next to the
prompt box, then Plugins, Add marketplace with `kakwok/claude-mods`, then Add plugin.

To update after a new release: `/plugin marketplace update claude-mods`.

## Run from a clone

For developing, or to pin a release, load a mod from its folder instead (not both, or it loads twice):

```bash
git clone https://github.com/kakwok/claude-mods.git ~/mods
cd ~/mods && git checkout v0.1.0    # or stay on main for the latest
```

Try one for a session:

```bash
claude --plugin-dir ~/mods/context-bar
claude --plugin-dir ~/mods/lens
```

Pass `--plugin-dir` once per mod to load several.

Load it every session by adding it to `~/.claude/settings.json` (use an absolute path;
separate several mods with `:`):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/me/mods/context-bar:/Users/me/mods/lens" } }
```

For a second profile that sets `CLAUDE_CONFIG_DIR`, put the same entry in that profile's `settings.json`.

Check a mod before loading it. It runs with your permissions:

```bash
claude plugin validate ~/mods/context-bar
claude plugin validate ~/mods/lens
```

## Develop a mod

In auto mode, Claude can't edit a mod that its own session has loaded (through `--plugin-dir` or
`CLAUDE_CODE_PLUGIN_DIRS`): every Write or Edit in that folder fails with "the auto mode classifier gave
no verdict", and allow rules don't change that. Either switch to accept-edits mode (shift+tab) while
editing, or edit from a session started without the mod and try it in a second one:

```bash
env -u CLAUDE_CODE_PLUGIN_DIRS claude          # edit here
claude --plugin-dir ~/mods/lens                # try it here; /reload-plugins picks up edits
```

Run a mod's tests with `claude plugin test ~/mods/lens`.

## Releases

**v0.2.5**:

- `context-bar`: the legend keeps to one line by default, folding the smallest categories into `other` (their total) until it fits; a new **Legend lines** option in `/config` gives it more room.

**v0.2.4**:

- `context-bar`: every category keeps its own color under a short name (`sys prompt`, `tools`, `mcp`, `mcp info`, `memory`, `agents`); instead of folding under a share of the window, the smallest categories fold into `other` only when the legend would need more than two lines at the terminal's width; token counts under 1k no longer show float noise (`251.99999999999997`).

**v0.2.3**:

- `context-bar`: fixes the Messages split vanishing in a new session (it read Messages before the first message existed, so the whole first turn was one `prompts` lump); categories now fold into `other` under 1% of the window instead of 3%; the README explains how Messages is grouped.

**v0.2.2**:

- `context-bar`: a new session or `/clear` counts what is already in Messages (the first message) as `prompts`, so the split is just the four sources; `earlier` is left for turns the mod never saw (a resumed session, or loaded late). A one-part split shows as a plain `messages` row, and the legend is one line that wraps only when the terminal is too narrow.

**v0.2.1**:

- `context-bar`: the Messages split shows right after the mod loads or after `/compact` (the first reading is `earlier` or `summary`), not only after the next turn; `compact` and free space share the last legend line instead of taking one of their own.

**v0.2.0**:

- `context-bar`: Messages split by source (explore, actions, replies, prompts) as one grouped row; rows under 3% of the window fold into `other`; the autocompact buffer is labeled `compact`.
- `lens`: the Agents tab shows tokens spent outside your context, by subagent type, with the top agents.

**v0.1.0**, the first release:

- `context-bar`: context window by category, plan usage with reset countdowns, the model name and frame colored by model family, and a colored per-turn summary (`▲ +2k context last turn → …`) under each turn's duration line.
- `lens`: Activity (changed files with last-turn marks, commands led by Claude's description with a shortened command, recent tool calls), Agents (plan, subagents, timeline) and Context (what Claude Code adds to the prompt, memory files, MCP and skills) tabs.
