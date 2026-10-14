// A ledger of the session in a pane: what Claude did to your machine (Activity tab) and what
// Claude Code fed it (Context tab). /ledger opens and closes it; /ledger demo shows sample data.
// Everything is kept in memory only: nothing is written to disk, and /clear starts it over.

const PANE = 'session-ledger'
const ACCENT = '#d97757'
const OK = '#5fb878'
const BAD = '#e5534b'
const BLUE = '#4f8bf0'
const AMBER = '#e3b341'

// Same kinds and colors as the agent timeline
const KINDS = {
  look: '#4f8bf0',
  change: '#e3b341',
  run: '#8b7cf6',
  web: '#6bbfc6',
  spawn: '#f472b6',
  other: '#9ca3af',
}
const CHANGE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_CALLS = 500
const MAX_ATTACHMENTS = 300
const PREVIEW = 400
const ROWS = 12

// Per tool call, oldest first: { id, t, agentId, tool, target, kind, status, ms, error }
const calls = new Map()
const order = []
// What Claude Code added to the prompt: { t, type, origin, agentId, text }
let attachments = []
// How many attachments there were when the last prompt was submitted
let turnMark = 0
// The instruction files behind CLAUDE.md, from prompt.context
let instructionFiles = []
// The latest usage breakdown, for the memory, MCP and skill lists
let items = null
let itemsAreDemo = false

let cwd = ''
let isOpen = false
let tab = 'activity'
let sub = 'files'
// Attachment types the person expanded
const expanded = new Set()

function kindOf(tool) {
  if (['Read', 'Grep', 'Glob', 'LS'].includes(tool)) return 'look'
  if (CHANGE.has(tool)) return 'change'
  if (tool === 'Bash') return 'run'
  if (/^Web|^ToolSearch/.test(tool)) return 'web'
  if (tool === 'Agent' || tool === 'Task') return 'spawn'
  return 'other'
}

// What a call was about: the path, command, pattern, address or task
function targetOf(e) {
  const t = e.tool
  if (t === 'Bash') return String(e.command ?? '')
  if (t === 'WebFetch') return String(e.url ?? '')
  if (t === 'WebSearch') return String(e.query ?? '')
  if (t === 'Grep' || t === 'Glob') return String(e.pattern ?? '')
  if (t === 'Agent' || t === 'Task') return String(e.description ?? '')
  return String(e.file_path ?? e.notebook_path ?? e.path ?? '')
}

function clip(text, n) {
  const one = String(text).replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

function shortPath(p) {
  let out = p
  if (cwd && out.startsWith(cwd + '/')) out = out.slice(cwd.length + 1)
  return out.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
}

function fmt(n) {
  if (n >= 1e4) return Math.round(n / 1e3) + 'k'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

// Where it came from: the engine, a settings hook, or another mod
function originLabel(o) {
  if (!o || o.kind === 'engine') return 'engine'
  if (o.kind === 'hook') return 'hook ' + (o.event ?? '')
  return 'mod ' + (o.event ?? '')
}

// The tool-call log is a ring: the oldest call drops out first
function addCall(c) {
  calls.set(c.id, c)
  order.push(c.id)
  while (order.length > MAX_CALLS) calls.delete(order.shift())
}

function wipe(demoOnly) {
  for (const id of [...order]) {
    if (!demoOnly || id.startsWith('demo-')) calls.delete(id)
  }
  const keep = order.filter((id) => calls.has(id))
  order.length = 0
  order.push(...keep)
  attachments = demoOnly ? attachments.filter((a) => !a.demo) : []
  if (!demoOnly || itemsAreDemo) items = null
  itemsAreDemo = false
  if (!demoOnly) instructionFiles = []
  else instructionFiles = instructionFiles.filter((f) => !f.demo)
  turnMark = Math.min(turnMark, attachments.length)
}

function loadDemo(now) {
  cwd = '/Users/kkwok/proj'
  const call = (n, ago_s, agentId, tool, args, status, ms, error) => {
    const e = { tool, ...args }
    addCall({ id: 'demo-' + n, t: now - ago_s * 1000, agentId, tool, target: targetOf(e), kind: kindOf(tool), status, ms, error })
  }
  call(1, 170, undefined, 'Read', { file_path: '/Users/kkwok/proj/src/auth.py' }, 'ok', 12)
  call(2, 160, undefined, 'Grep', { pattern: 'login' }, 'ok', 40)
  call(3, 150, undefined, 'Read', { file_path: '/Users/kkwok/proj/src/session.py' }, 'ok', 9)
  call(4, 120, undefined, 'Edit', { file_path: '/Users/kkwok/proj/src/auth.py' }, 'ok', 15)
  call(5, 110, undefined, 'Bash', { command: 'pytest tests/test_auth.py -q' }, 'failed', 2100, 'exit 1: 2 failed')
  call(6, 95, undefined, 'Edit', { file_path: '/Users/kkwok/proj/src/auth.py' }, 'ok', 11)
  call(7, 90, undefined, 'Write', { file_path: '/Users/kkwok/proj/tests/test_auth.py' }, 'ok', 8)
  call(8, 80, undefined, 'Bash', { command: 'pytest tests/test_auth.py -q' }, 'ok', 1900)
  call(9, 70, 'a1', 'Grep', { pattern: 'TODO' }, 'ok', 30)
  call(10, 60, 'a1', 'Read', { file_path: '/Users/kkwok/proj/README.md' }, 'ok', 7)
  call(11, 40, undefined, 'WebFetch', { url: 'https://example.com/oauth/flows' }, 'ok', 800)
  call(12, 25, undefined, 'Edit', { file_path: '/Users/kkwok/proj/src/session.py' }, 'ok', 13)
  call(13, 12, undefined, 'Bash', { command: 'git diff --stat' }, 'ok', 90)
  call(14, 3, undefined, 'Edit', { file_path: '/Users/kkwok/proj/src/auth.py' }, 'running')
  const att = (ago_s, type, origin, text) => attachments.push({ t: now - ago_s * 1000, type, origin, text, demo: true })
  att(172, 'instructions', { kind: 'engine' }, 'Contents of /Users/kkwok/proj/CLAUDE.md (project instructions): Use pytest. Keep functions short.')
  att(171, 'skill_listing', { kind: 'engine' }, 'The following skills are available for use with the Skill tool: code-review, simplify, loop, schedule')
  att(125, 'edited_text_file', { kind: 'engine' }, 'Note: /Users/kkwok/proj/src/auth.py was modified, either by the user or by a linter.')
  att(100, 'todo_reminder', { kind: 'engine' }, 'The TodoWrite tool has not been used recently. Consider using it to track progress.')
  att(75, 'nested_memory', { kind: 'engine' }, 'Contents of /Users/kkwok/proj/src/CLAUDE.md: Auth code lives here; never log tokens.')
  att(40, 'todo_reminder', { kind: 'engine' }, 'The TodoWrite tool has not been used recently. Consider using it to track progress.')
  att(30, 'context', { kind: 'hook', event: 'SessionStart' }, 'Branch: feature/auth-fix. 3 uncommitted files. Last commit: "wip oauth".')
  att(8, 'edited_text_file', { kind: 'engine' }, 'Note: /Users/kkwok/proj/src/session.py was modified, either by the user or by a linter.')
  turnMark = attachments.length - 3
  instructionFiles = [
    { path: '/Users/kkwok/.claude/CLAUDE.md', kind: 'user', demo: true },
    { path: '/Users/kkwok/proj/CLAUDE.md', kind: 'project', demo: true },
  ]
  items = {
    memoryFiles: [
      { path: '/Users/kkwok/.claude/projects/proj/memory/MEMORY.md', type: 'AutoMem', tokens: 262 },
      { path: '/Users/kkwok/proj/CLAUDE.md', type: 'Project', tokens: 410 },
    ],
    mcpTools: [
      ...Array.from({ length: 12 }, (_, i) => ({ name: 'mcp__docs__t' + i, serverName: 'claude_ai_Docs', tokens: 220, isLoaded: i < 3 })),
      ...Array.from({ length: 21 }, (_, i) => ({ name: 'mcp__chrome__t' + i, serverName: 'claude-in-chrome', tokens: 400, isLoaded: false })),
    ],
    skills: { totalSkills: 47, includedSkills: 47, tokens: 8300 },
    agents: [],
  }
  itemsAreDemo = true
}

async function loadItems($) {
  if (itemsAreDemo) return
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    items = usage.context.breakdown ?? null
  } catch {
    items = null
  }
}

function openPane($) {
  return $.ui.open({ id: PANE, title: 'Ledger', focus: true, closeOnEscape: true })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      cwd = await $.session.cwd()
    } catch {}
    // "12s ago" only moves with the clock
    $.clock.every(2000, () => {
      if (isOpen) $.ui.invalidate('ui.render')
    })
    // Register last: a name Claude Code already uses throws and would skip the rest
    try {
      await $.command.register({
        name: 'ledger',
        description: 'Show or hide what Claude did and what Claude Code added to the prompt',
        argumentHint: '[demo | demo off]',
        immediate: true,
      })
    } catch {}
    return next(e)
  })

  // Observers: a failure here must never get in the way of the tool call
  on('tool.call', async ($, e, next) => {
    try {
      addCall({
        id: e.tool_use_id,
        t: await $.clock.now(),
        agentId: e.agentId,
        tool: e.tool,
        target: targetOf(e),
        kind: kindOf(e.tool),
        status: 'running',
      })
      if (isOpen) $.ui.invalidate('ui.render')
    } catch {}
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    try {
      const c = calls.get(e.tool_use_id)
      if (c) {
        c.status = 'ok'
        c.ms = e.duration_ms
      }
      if (isOpen) $.ui.invalidate('ui.render')
    } catch {}
    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    try {
      const c = calls.get(e.tool_use_id)
      if (c) {
        c.status = 'failed'
        c.ms = e.duration_ms
        c.error = clip(e.error ?? '', 120)
      }
      if (isOpen) $.ui.invalidate('ui.render')
    } catch {}
    return next(e)
  })

  // What Claude Code adds to the prompt. This hook only watches; it never rewrites the text.
  on('prompt.attachment', async ($, e, next) => {
    try {
      attachments.push({ t: await $.clock.now(), type: e.type, origin: e.origin, agentId: e.agentId, text: String(e.text ?? '').slice(0, PREVIEW) })
      if (attachments.length > MAX_ATTACHMENTS) attachments.shift()
      if (isOpen) $.ui.invalidate('ui.render')
    } catch {}
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    try {
      instructionFiles = (e.instructionFiles ?? []).map((f) => ({ path: f.path, kind: f.kind }))
    } catch {}
    return next(e)
  })

  // A new prompt starts a new "this turn"
  on('prompt.submit', async ($, e, next) => {
    turnMark = attachments.length
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && isOpen && tab === 'context') {
      await loadItems($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'demo') {
      loadDemo(await $.clock.now())
      if (!isOpen) {
        isOpen = true
        await openPane($)
      }
      $.ui.invalidate('ui.render')
      return { text: 'demo loaded: run /ledger demo off to clear it' }
    }
    if (arg === 'demo off') {
      wipe(true)
      $.ui.invalidate('ui.render')
      return { text: 'demo cleared' }
    }
    if (isOpen) {
      isOpen = false
      await $.ui.close({ id: PANE })
    } else {
      isOpen = true
      await openPane($)
      await loadItems($)
      $.ui.invalidate('ui.render')
    }
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isOpen = false
    return next(e)
  })

  // /clear, /resume and exit start the ledger over
  on('session.end', async ($, e, next) => {
    wipe(false)
    turnMark = 0
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const redraw = () => $.ui.invalidate('ui.render')

    const pick = (key, label, hotkey, active, onPress) =>
      Button({ key, label, hotkey, plain: true, dimColor: !active, onPress })
    const row = (children, extra) => Box({ flexDirection: 'row', columnGap: 1, ...(extra ?? {}), children })
    const title = (left, right) =>
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [Text({ bold: true, color: ACCENT, children: [left] }), Text({ dimColor: true, children: [right] })],
      })
    const dim = (text) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })

    const tabs = Box({
      flexDirection: 'row',
      columnGap: 3,
      children: [
        pick('tab-activity', 'Activity', '1', tab === 'activity', () => {
          tab = 'activity'
          redraw()
        }),
        pick('tab-context', 'Context', '2', tab === 'context', async () => {
          tab = 'context'
          await loadItems($)
          redraw()
        }),
      ],
    })

    let body
    if (tab === 'activity') {
      const list = order.map((id) => calls.get(id))

      // Files Claude changed, newest first; files it only read are a count
      const changed = new Map()
      for (const c of list) {
        if (!CHANGE.has(c.tool) || !c.target) continue
        const f = changed.get(c.target) ?? { edits: 0, failed: 0, last: 0, sub: false }
        if (c.status === 'failed') f.failed += 1
        else f.edits += 1
        f.last = c.t
        f.sub = f.sub || Boolean(c.agentId)
        changed.set(c.target, f)
      }
      const files = [...changed.entries()].sort((a, b) => b[1].last - a[1].last)
      const reads = new Set(list.filter((c) => c.tool === 'Read' && c.target).map((c) => c.target)).size
      const cmds = list.filter((c) => c.tool === 'Bash').reverse()
      const cmdFailed = cmds.filter((c) => c.status === 'failed').length

      const summary =
        files.length + ' changed · ' + reads + ' read · ' + cmds.length + ' cmds' + (cmdFailed ? ' (' + cmdFailed + ' failed)' : '')
      const subs = Box({
        flexDirection: 'row',
        columnGap: 3,
        children: [
          ['files', 'f'],
          ['commands', 'c'],
          ['feed', 'l'],
        ].map(([name, key]) =>
          pick('sub-' + name, name, key, sub === name, () => {
            sub = name
            redraw()
          }),
        ),
      })

      const more = (n) => (n > 0 ? [dim('  … ' + n + ' more')] : [])
      let rows
      if (list.length === 0) rows = [dim('Nothing yet. Tool calls show up here as Claude makes them.')]
      else if (sub === 'files') {
        rows = files.length
          ? [
              ...files.slice(0, ROWS).map(([path, f], i) =>
                row(
                  [
                    Text({ color: f.edits ? KINDS.change : BAD, children: [f.edits ? '✎' : '✖'] }),
                    Text({ wrap: 'truncate-start', children: [shortPath(path)] }),
                    Text({ dimColor: true, children: ['×' + (f.edits + f.failed) + (f.sub ? ' ↳' : '') + ' · ' + ago(now - f.last)] }),
                  ],
                  { key: 'file-' + i, justifyContent: 'space-between' },
                ),
              ),
              ...more(files.length - ROWS),
            ]
          : [dim('No files changed yet.')]
      } else if (sub === 'commands') {
        rows = cmds.length
          ? [
              ...cmds.slice(0, ROWS).map((c, i) =>
                Box({
                  key: 'cmd-' + i,
                  flexDirection: 'column',
                  children: [
                    row([
                      Text({ color: c.status === 'failed' ? BAD : c.status === 'running' ? BLUE : OK, children: [c.status === 'failed' ? '✖' : c.status === 'running' ? '●' : '✔'] }),
                      Text({ wrap: 'truncate-end', children: [clip(c.target, 80)] }),
                    ]),
                    ...(c.status === 'failed' && c.error ? [dim('    ' + c.error)] : []),
                  ],
                }),
              ),
              ...more(cmds.length - ROWS),
            ]
          : [dim('No commands run yet.')]
      } else {
        const recent = [...list].reverse()
        rows = [
          ...recent.slice(0, ROWS).map((c, i) =>
            row(
              [
                Text({ color: KINDS[c.kind], children: ['█'] }),
                Text({ bold: true, children: [c.tool] }),
                Text({ dimColor: true, wrap: 'truncate-start', children: [c.kind === 'run' ? clip(c.target, 60) : shortPath(c.target)] }),
                Text({ color: c.status === 'failed' ? BAD : undefined, dimColor: c.status !== 'failed', children: [(c.agentId ? '↳ ' : '') + ago(now - c.t)] }),
              ],
              { key: 'feed-' + i, justifyContent: 'space-between' },
            ),
          ),
          ...more(recent.length - ROWS),
        ]
      }
      body = [Box({ flexDirection: 'column', children: [title('◆ activity', summary), subs] }), Box({ flexDirection: 'column', children: rows })]
    } else {
      // What Claude Code added to the prompt, by kind
      const tally = new Map()
      for (const a of attachments) {
        const t = tally.get(a.type) ?? { n: 0, last: a, odd: false }
        t.n += 1
        t.last = a
        t.odd = t.odd || (a.origin && a.origin.kind !== 'engine')
        tally.set(a.type, t)
      }
      const added = attachments.length - turnMark
      const kinds = [...tally.entries()].sort((a, b) => b[1].last.t - a[1].last.t)

      const rows = kinds.length
        ? kinds.map(([type, t], i) => {
            const open = expanded.has(type)
            return Box({
              key: 'att-' + i,
              flexDirection: 'column',
              children: [
                row([
                  Button({
                    key: 'att-' + type,
                    label: (open ? '▾ ' : '▸ ') + type,
                    plain: true,
                    onPress: () => {
                      if (expanded.has(type)) expanded.delete(type)
                      else expanded.add(type)
                      redraw()
                    },
                  }),
                  Text({ dimColor: true, children: ['×' + t.n] }),
                  Text({ color: t.odd ? AMBER : undefined, dimColor: !t.odd, children: [originLabel(t.last.origin)] }),
                ]),
                ...(open ? [Text({ dimColor: true, wrap: 'wrap', children: ['    ' + clip(t.last.text, PREVIEW)] })] : [dim('    ' + clip(t.last.text, 70))]),
              ],
            })
          })
        : [dim('Nothing added yet. Reminders and notes show up here as Claude Code adds them.')]

      const instRows = instructionFiles.length
        ? instructionFiles.map((f, i) => row([Text({ dimColor: true, children: [f.kind] }), Text({ wrap: 'truncate-start', children: [shortPath(f.path)] })], { key: 'inst-' + i }))
        : [dim('None reported.')]

      // A title with its rows right under it; the gap only goes between sections
      const section = (head, list) => Box({ flexDirection: 'column', children: [head, ...list] })

      const lists = []
      if (items) {
        const mem = items.memoryFiles ?? []
        lists.push(
          section(
            title('◆ memory files', mem.length + ' · ' + fmt(mem.reduce((n, m) => n + m.tokens, 0)) + ' tok'),
            mem.length
              ? mem.map((m, i) => row([Text({ dimColor: true, children: [m.type] }), Text({ wrap: 'truncate-start', children: [shortPath(m.path)] }), Text({ dimColor: true, children: [fmt(m.tokens)] })], { key: 'mem-' + i, justifyContent: 'space-between' }))
              : [dim('None.')],
          ),
        )
        const byServer = new Map()
        for (const t of items.mcpTools ?? []) {
          const s = byServer.get(t.serverName) ?? { n: 0, loaded: 0 }
          s.n += 1
          if (t.isLoaded) s.loaded += 1
          byServer.set(t.serverName, s)
        }
        lists.push(
          section(
            title('◆ mcp tools', (items.mcpTools ?? []).length + ' across ' + byServer.size + ' servers'),
            byServer.size
              ? [...byServer.entries()].map(([name, s], i) => row([Text({ wrap: 'truncate-end', children: [name] }), Text({ dimColor: true, children: [s.loaded + ' of ' + s.n + ' loaded'] })], { key: 'mcp-' + i, justifyContent: 'space-between' }))
              : [dim('None.')],
          ),
        )
        if (items.skills) {
          lists.push(title('◆ skills', items.skills.includedSkills + ' of ' + items.skills.totalSkills + ' listed · ' + fmt(items.skills.tokens) + ' tok'))
        }
        if ((items.agents ?? []).length) lists.push(title('◆ custom agents', String(items.agents.length)))
      }

      body = [
        section(title('◆ added to the prompt', added + ' this turn'), rows),
        section(title('◆ instruction files', String(instructionFiles.length)), instRows),
        ...lists,
      ]
    }

    return Box({ flexDirection: 'column', rowGap: 1, children: [tabs, ...body] })
  })
}
