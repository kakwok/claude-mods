# claude-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview).
Each directory is a complete plugin. Needs Claude Code v2.1.287 or later.

## Mods

| Mod | What it does |
|---|---|
| [`context-bar`](context-bar) | Band above the prompt: context window stacked by category (like `/context`), current model, 5h and weekly plan usage with reset countdowns, and a per-turn summary line. Hidden until you run `/context-bar`. |

## Use a mod

Try one for a session:

```bash
claude --plugin-dir ~/mods/context-bar
```

Load it every session by adding it to `~/.claude/settings.json` (use an absolute path;
separate several mods with `:`):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/me/mods/context-bar" } }
```

For a second profile that sets `CLAUDE_CONFIG_DIR`, put the same entry in that profile's `settings.json`.

Check a mod before loading it. It runs with your permissions:

```bash
claude plugin validate ~/mods/context-bar
```
