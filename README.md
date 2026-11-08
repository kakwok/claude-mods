# claude-mods

Two [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview). Needs Claude Code v2.1.287 or later.

**[▶ Try the interactive demo](https://kakwok.github.io/claude-mods/)** to see both in color, with sample data.

## Mods

### [context-bar](context-bar)

A band above the prompt.

- How full the context window is, by category (like `/context`).
- Your 5-hour and weekly plan usage, with reset times.
- The model, with the band's frame in that model family's color, so a wrong model stands out.
- After each turn, how much context the turn added: blue, amber from 5k, red from 20k.

`/context-bar` hides or shows it.

### [lens](lens)

A pane beside the chat with three tabs (keys `1`–`3`):

- **Activity**: files changed (the last turn's marked `●`), commands with pass/fail, recent tool calls.
- **Agents**: the plan checklist, subagents, and a timeline of what each one did.
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

**v0.1.0**, the first release:

- `context-bar`: context window by category, plan usage with reset countdowns, the model name and frame colored by model family, and a colored per-turn summary (`▲ +2k context last turn → …`) under each turn's duration line.
- `lens`: Activity (changed files with last-turn marks, commands led by Claude's description with a shortened command, recent tool calls), Agents (plan, subagents, timeline) and Context (what Claude Code adds to the prompt, memory files, MCP and skills) tabs.
