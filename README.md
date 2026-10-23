# claude-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview).
Each directory is a complete plugin. Needs Claude Code v2.1.287 or later.

## Mods

| Mod | What it does |
|---|---|
| [`context-bar`](context-bar) | Band above the prompt: context window stacked by category (like `/context`), current model, 5h and weekly plan usage with reset countdowns, and what the last turn added to the context: colored by size at the head of the legend (blue, amber from 5k, red from 20k) and leading the summary line after each turn. Shown by default; `/context-bar` hides or shows it. |
| [`lens`](lens) | One pane for the session, tabs switched with `1`–`4`. **Activity**: changed files as a tree, with the files changed since your latest prompt marked `● last turn`, commands (pass/fail) and recent tool calls; each list's `▸ n more` expands it and `▴ show less` folds it. **Agents / Timeline**: plan checklist, subagents with status, runtime and tokens, and a lane per agent colored by what it was doing; it opens by itself when agents start and folds into a one-line band when they finish. **Context**: what Claude Code added to the prompt (reminders, notes, hook output, tagged by who added it), memory files (CLAUDE.md included), MCP and skill lists. `/lens` toggles it; `/lens agents\|timeline\|activity\|context` opens a tab; `/lens demo` shows sample data. Everything stays in memory. Where an organization's managed plugin keeps `prompt.attachment` from installed plugins (you see "its prompt.attachment hook was skipped"), press `a: turn off` on the Context tab (or turn off **Show what Claude Code adds to the prompt** for `lens` in `/config`); the setting is kept per profile, and changing it reloads Lens, which clears what the pane had recorded. |

## Screens

Plain-text renders of each mod's demo data (`/lens demo`, and a sample reading for the context bar).
The real panes use color: in the bar below each category gets its own color and `▲ +2k last turn` is blue, amber or red by size, and in the timeline `█▓▒░` stand
for read/search, edit, shell and web.

### context-bar

```text
╭────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ◆ context · claude-opus-5-5          187k of 1M · 19%  │  5h ███ ░░░ 42% ⏱ 2h05m  ·  wk █████ ░ 78% ⏱ 3d4h │
│ ███████████████████████▒▒▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ▲ +2k last turn  ■ messages 141k 14%  ■ tools 14k 1%  ■ system prompt 9.8k 1%  ■ skills 8.3k 1%            │
│ ■ mcp tools 6.4k 1%  ■ memory files 3.6k 0%  ■ agents 2.1k 0%  ■ mcp instructions 1.9k 0%                  │
│ ■ autocompact buffer 45k 5%  ■ free 768k                                                                   │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

After each turn, in the transcript:

```text
⏺ context-bar: ▲ +2k context last turn → 187k · out 1.3k · session 16k · cache 99%
```

### lens

**Activity** (`1`): changed files as a tree (`●` marks the ones changed since your latest prompt), commands and recent tool calls. Press `▸ n more` to expand a list, `▴ show less` to fold it.

```text
1: Activity   2: Agents   3: Timeline   4: Context

◆ files changed  6 · 4 read · ● 3 last turn    r: show reads
├─ src/
│  ├─ api/
│  │  ├─ routes/
│  │  │  └─ ✎ users.py                          ×1 · 55s ago
│  │  └─ ✎ models.py ●                      ×1 ↳ · last turn
│  ├─ ✎ auth.py ●                             ×3 · last turn
│  └─ ✎ session.py ●                          ×1 · last turn
└─ tests/
   ├─ unit/
   │  └─ ✎ test_users.py                        ×1 · 50s ago
   └─ ✎ test_auth.py                             ×1 · 1m ago

◆ commands                                      7 · 1 failed
✔ git diff --stat
✔ ruff check src
✔ pytest tests/unit -q
✔ pytest tests/test_auth.py -q
✖ pytest tests/test_auth.py -q
    exit 1: 2 failed
  ▸ 2 more

◆ recent activity                                   22 calls
▓ Edit src/auth.py                                    3s ago
▒ Bash git diff --stat                               12s ago
▓ Edit src/api/models.py                           ↳ 20s ago
▓ Edit src/session.py                                25s ago
▒ Bash ruff check src                                35s ago
░ WebFetch https://example.com/oauth/flows           40s ago
  ▸ 16 more
```

**Agents** (`2`): plan checklist and subagents with status, runtime and tokens.

```text
1: Activity   2: Agents   3: Timeline   4: Context

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

**Timeline** (`3`): a lane per agent, colored by what it was doing.

```text
1: Activity   2: Agents   3: Timeline   4: Context

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

**Context** (`4`): what Claude Code added to the prompt, memory files, MCP and skills.

```text
1: Activity   2: Agents   3: Timeline   4: Context

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
