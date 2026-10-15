# claude-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview).
Each directory is a complete plugin. Needs Claude Code v2.1.287 or later.

## Mods

| Mod | What it does |
|---|---|
| [`context-bar`](context-bar) | Band above the prompt: context window stacked by category (like `/context`), current model, 5h and weekly plan usage with reset countdowns, and a per-turn summary line. Hidden until you run `/context-bar`. |
| [`lens`](lens) | One pane for the session, tabs switched with `1`–`4`. **Agents / Timeline**: plan checklist, subagents with status, runtime and tokens, and a lane per agent colored by what it was doing; it opens by itself when agents start and folds into a one-line band when they finish. **Activity**: changed files as a tree, commands (pass/fail) and recent tool calls. **Context**: what Claude Code added to the prompt (reminders, notes, hook output, tagged by who added it), instruction files, memory, MCP and skill lists. `/lens` toggles it; `/lens agents\|timeline\|activity\|context` opens a tab; `/lens demo` shows sample data. Everything stays in memory. |

## Screens

Plain-text renders of each mod's demo data (`/lens demo`, and a sample reading for the context bar).
The real panes use color: in the bar below each category gets its own color, and in the timeline `█▓▒░` stand
for read/search, edit, shell and web.

### context-bar

```text
╭────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ◆ context · claude-opus-5-5          187k of 1M · 19%  │  5h ███ ░░░ 42% ⏱ 2h05m  ·  wk █████ ░ 78% ⏱ 3d4h │
│ ███████████████████████▒▒▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ■ messages 141k 14%  ■ tools 14k 1%  ■ system prompt 9.8k 1%  ■ skills 8.3k 1%  ■ mcp tools 6.4k 1%        │
│ ■ memory files 3.6k 0%  ■ agents 2.1k 0%  ■ mcp instructions 1.9k 0%  ■ autocompact buffer 45k 5%          │
│ ■ free 768k                                                                                                │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### lens

**Agents** (`1`): plan checklist and subagents with status, runtime and tokens.

```text
1: Agents   2: Timeline   3: Activity   4: Context

◆ plan                                                    2 of 5
✔ Map the auth flow
✔ Write parser tests
▶ Reviewing the diff
○ Fix flagged issues
○ Update the README

◆ agents                 1 running · 2 done · 1 failed · 22k tok

✔ map auth flow Explore                         00:25 · 4.1k tok
  Read ~/proj/src/session.py · 5 tools

✔ write parser tests general-purpose            01:22 · 9.6k tok
  Bash pytest tests/test_parser.py -q · 9 tools

  ✖ find fixtures Explore                         00:22 · 1.4k …
    Grep fixture · 2 tools

● review the diff code-reviewer                 00:32 · 6.7k tok
  Grep TODO · 4 tools
```

**Timeline** (`2`): a lane per agent, colored by what it was doing.

```text
1: Agents   2: Timeline   3: Activity   4: Context

◆ plan                                                    2 of 5
✔ Map the auth flow
✔ Write parser tests
▶ Reviewing the diff
○ Fix flagged issues
○ Update the README

◆ agents                 1 running · 2 done · 1 failed · 22k tok

✔ map auth flow  ███████░░███·
✔ write parser…    ██████·▓▓▓▓▓▓▒▒▒·▓▓▓·▒▒▒·▓▓▓·▒▒▒·········
✖  find fixtur…                 ·█████······
● review the d…                                 ▒▒▒·██████··███·

                 00:00                                     01:37

█ read/search  ▓ edit  ▒ shell  ░ web  ◆ agent  ▪ other
· thinking
```

**Activity** (`3`): changed files as a tree, commands, recent tool calls.

```text
1: Agents   2: Timeline   3: Activity   4: Context

◆ files changed  6 · 4 read                        r: show reads
├─ src/
│  ├─ api/
│  │  ├─ routes/
│  │  │  └─ ✎ users.py                              ×1 · 57s ago
│  │  └─ ✎ models.py                              ×1 ↳ · 22s ago
│  ├─ ✎ auth.py                                      ×3 · 5s ago
│  └─ ✎ session.py                                  ×1 · 27s ago
└─ tests/
   ├─ unit/
   │  └─ ✎ test_users.py                            ×1 · 52s ago
   └─ ✎ test_auth.py                                 ×1 · 1m ago

◆ commands                                          3 · 1 failed
✔ git diff --stat
✔ pytest tests/test_auth.py -q
✖ pytest tests/test_auth.py -q
    exit 1: 2 failed

◆ recent activity                                       18 calls
▓ Edit src/auth.py                                        5s ago
▓ Edit src/api/models.py                               ↳ 22s ago
█ Read src/api/routes/orders.py                          47s ago
▓ Write tests/unit/test_users.py                         52s ago
▓ Edit src/api/routes/users.py                           57s ago
▒ Bash git diff --stat                                   14s ago
  … 12 more
```

**Context** (`4`): what Claude Code added to the prompt, instruction files, memory, MCP and skills.

```text
1: Agents   2: Timeline   3: Activity   4: Context

◆ added to the prompt                                3 this turn
▸ edited_text_file ×2 engine
    Note: /Users/kkwok/proj/src/session.py was modified, either…
▸ context ×1 hook SessionStart
    Branch: feature/auth-fix. 3 uncommitted files. Last commit:…
▸ todo_reminder ×2 engine
    The TodoWrite tool has not been used recently. Consider usi…
▸ nested_memory ×1 engine
    Contents of /Users/kkwok/proj/src/CLAUDE.md: Auth code live…
▸ skill_listing ×1 engine
    The following skills are available for use with the Skill t…
▸ instructions ×1 engine
    Contents of /Users/kkwok/proj/CLAUDE.md (project instructio…

◆ instruction files                                            2
user ~/.claude/CLAUDE.md
project CLAUDE.md

◆ memory files                                       2 · 672 tok
AutoMem ~/.claude/projects/proj/memory/MEMORY.md 262
Project CLAUDE.md 410

◆ mcp tools                                  33 across 2 servers
claude_ai_Docs                                    3 of 12 loaded
claude-in-chrome                                  0 of 21 loaded

◆ skills                              47 of 47 listed · 8.3k tok
```

## Use a mod

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
