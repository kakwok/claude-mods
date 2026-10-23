// Lens: one pane for the session: a plan checklist, subagents (roster and timeline), and a ledger of
// what Claude did (Activity) and what Claude Code added to the prompt (Context).
// Digits 1-4 switch tabs while the pane has the keyboard. /lens opens it; /lens <view> picks a tab.
// The pane opens by itself when agents are deployed, and a few seconds after the last
// one finishes it folds into a one-line band above the prompt; the band's "expand"
// (or /lens) brings the full pane back.

const PANE = 'lens'
const ACCENT = '#d97757'

// Dot and color by the engine's task status
const STATUS = {
  running: { dot: '●', color: '#4f8bf0' },
  pending: { dot: '○', color: '#9ca3af' },
  waiting: { dot: '◐', color: '#e3b341' },
  idle: { dot: '◐', color: '#e3b341' },
  completed: { dot: '✔', color: '#5fb878' },
  failed: { dot: '✖', color: '#e5534b' },
  killed: { dot: '■', color: '#9ca3af' },
}
const OK = '#5fb878'
const BAD = '#e5534b'
const BLUE = '#4f8bf0'
const AMBER = '#e3b341'
const FALLBACK = { dot: '?', color: '#9ca3af' }
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

// What an agent is doing, by tool; the timeline colors its blocks by these
const KINDS = {
  look: { color: '#4f8bf0', label: 'read/search' },
  change: { color: '#e3b341', label: 'edit' },
  run: { color: '#8b7cf6', label: 'shell' },
  web: { color: '#6bbfc6', label: 'web' },
  spawn: { color: '#f472b6', label: 'agent' },
  other: { color: '#9ca3af', label: 'other' },
}
// A tool call has no end event here, so a block is this long, or until the next call
const ACTIVE_MS = 4000
const LABEL = 16
const MAX_EVENTS = 400
// How long the finished pane stays up before it folds into the band
const MINIMIZE_MS = 8000
const CHANGE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_CALLS = 500
const MAX_ATTACHMENTS = 300
const PREVIEW = 400
const TREE_ROWS = 14
const CMD_ROWS = 5
const FEED_ROWS = 6
// How many rows a section shows once its "more" is expanded
const OPEN_ROWS = 100
// The tabs, in the order the bar shows them; each one's hotkey is its place
const TABS = { activity: 'Activity', roster: 'Agents', timeline: 'Timeline', context: 'Context' }
const TAB_ORDER = ['activity', 'roster', 'timeline', 'context']

// Claude's todo list, from its TodoWrite calls: [{ content, status, activeForm }]
let plan = []
let planIsDemo = false

let isOpen = false
// True once the person opened the pane themselves: then it stays until they close it
let pinned = false
// Whether any agent was live at the last look, and when the last one stopped
let hadLive = false
let finishedAt = undefined
let view = TAB_ORDER[0]
// Sections whose "more" the person expanded: files, commands, feed
const openMore = new Set()
// When the latest prompt was submitted: files changed since then are the last turn's
let turnAt = undefined

// The ledger, in memory only. Per tool call, oldest first: { id, t, agentId, tool, target, kind, status, ms, error }
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
// Whether the file tree also lists files Claude only read
let showReads = false
// Attachment types the person expanded
const expanded = new Set()
// Every agent seen this session, kept even if Claude Code later drops it from its list
const known = new Map()
// known, as an array
let agents = []
// What the band last decided, so the debug log only gets a line when that changes
let bandState = ''
// Per agent id: first seen, stopped, tool calls, latest call, tokens, and the call log
const seen = new Map()

function entry(id, now) {
  let s = seen.get(id)
  if (!s) {
    s = { startedAt: now, endedAt: undefined, tools: 0, last: '', tokens: 0, events: [] }
    seen.set(id, s)
  }
  return s
}

function kindOf(tool) {
  if (['Read', 'Grep', 'Glob', 'LS'].includes(tool)) return 'look'
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return 'change'
  if (tool === 'Bash') return 'run'
  if (/^Web|^ToolSearch/.test(tool)) return 'web'
  if (tool === 'Agent' || tool === 'Task') return 'spawn'
  return 'other'
}

// "Grep login", "Read ~/proj/src/auth.py", "Bash npm test"
function describeTool(e) {
  const arg = e.file_path ?? e.path ?? e.command ?? e.pattern ?? e.query ?? e.url ?? e.description ?? ''
  const text = String(arg).replace(/^\/Users\/[^/]+/, '~').replace(/\s+/g, ' ').slice(0, 80)
  return e.tool + (text ? ' ' + text : '')
}

function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return Math.round(n / 1e3) + 'k'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

// Parents first, each followed by its children, with the depth to indent by
function ordered(list) {
  const ids = new Set(list.map((a) => a.id))
  const out = []
  const walk = (a, depth) => {
    out.push({ a, depth })
    for (const c of list) if (c.parentId === a.id) walk(c, depth + 1)
  }
  for (const a of list) if (!a.parentId || !ids.has(a.parentId)) walk(a, 0)
  return out
}

// One lane as runs of [kind | 'idle' | null, cells]; null is outside the agent's life.
// Each cell takes the call that covers most of its slice of time.
function lane(s, t0, t1, width, now) {
  const dt = (t1 - t0) / width
  const end = s.endedAt ?? now
  const cells = []
  for (let i = 0; i < width; i++) {
    const a = t0 + i * dt
    const b = a + dt
    if (b <= s.startedAt || a >= end) {
      cells.push(null)
      continue
    }
    let mark = 'idle'
    let best = 0
    for (let k = 0; k < s.events.length; k++) {
      const ev = s.events[k]
      const stop = Math.min(k + 1 < s.events.length ? s.events[k + 1].t : Infinity, ev.t + ACTIVE_MS)
      const overlap = Math.min(stop, b) - Math.max(ev.t, a)
      if (overlap > best) {
        best = overlap
        mark = ev.kind
      }
    }
    cells.push(mark)
  }
  const runs = []
  for (const c of cells) {
    if (runs.length && runs[runs.length - 1][0] === c) runs[runs.length - 1][1] += 1
    else runs.push([c, 1])
  }
  return runs
}

// Lines for `claude --debug`; the transcript stays quiet
function trace($, text) {
  try {
    $.ui.log('lens: ' + text, { to: 'debug' })
  } catch {}
}

const PLAN_ROWS = 7
const PLAN_MARK = {
  completed: { dot: '✔', color: '#5fb878' },
  in_progress: { dot: '▶', color: '#4f8bf0' },
  pending: { dot: '○', color: '#9ca3af' },
}

// The steps to show: the current one, a little before it, and what comes next
function planWindow(todos) {
  let at = todos.findIndex((t) => t.status === 'in_progress')
  if (at < 0) at = todos.findIndex((t) => t.status !== 'completed')
  if (at < 0) at = todos.length - 1
  const from = Math.max(0, Math.min(at - 2, todos.length - PLAN_ROWS))
  const to = Math.min(todos.length, from + PLAN_ROWS)
  return { rows: todos.slice(from, to), above: from, below: todos.length - to }
}

// A made-up session for /lens demo, so the views can be looked at without real agents
const DEMO_PLAN = [
  { content: 'Map the auth flow', status: 'completed', activeForm: 'Mapping the auth flow' },
  { content: 'Write parser tests', status: 'completed', activeForm: 'Writing parser tests' },
  { content: 'Review the diff', status: 'in_progress', activeForm: 'Reviewing the diff' },
  { content: 'Fix flagged issues', status: 'pending', activeForm: 'Fixing flagged issues' },
  { content: 'Update the README', status: 'pending', activeForm: 'Updating the README' },
]

function loadDemo(now) {
  const add = (id, description, type, status, parentId, ago, took, last, tokens, calls) => {
    known.set('demo-' + id, { id: 'demo-' + id, description, type, status, ...(parentId ? { parentId: 'demo-' + parentId } : {}) })
    const startedAt = now - ago * 1000
    seen.set('demo-' + id, {
      startedAt,
      endedAt: took === null ? undefined : startedAt + took * 1000,
      tools: calls.length,
      last,
      tokens,
      events: calls.map(([sec, tool]) => ({ t: startedAt + sec * 1000, kind: kindOf(tool) })),
    })
  }
  add('1', 'map auth flow', 'Explore', 'completed', undefined, 95, 25, 'Read ~/proj/src/session.py', 4100, [[1, 'Grep'], [4, 'Read'], [9, 'Read'], [14, 'WebFetch'], [19, 'Read']])
  add('2', 'write parser tests', 'general-purpose', 'completed', undefined, 90, 82, 'Bash pytest tests/test_parser.py -q', 9600, [[1, 'Read'], [6, 'Read'], [14, 'Write'], [20, 'Edit'], [27, 'Bash'], [36, 'Edit'], [44, 'Bash'], [52, 'Edit'], [60, 'Bash']])
  add('3', 'find fixtures', 'Explore', 'failed', '2', 62, 22, 'Grep fixture', 1400, [[1, 'Glob'], [5, 'Grep']])
  add('4', 'review the diff', 'code-reviewer', 'running', undefined, 30, null, 'Grep TODO', 6700, [[1, 'Bash'], [8, 'Read'], [15, 'Read'], [24, 'Grep']])
  plan = DEMO_PLAN
  planIsDemo = true
  agents = [...known.values()]
}

function clearDemo() {
  for (const id of [...known.keys()]) if (id.startsWith('demo-')) known.delete(id)
  for (const id of [...seen.keys()]) if (id.startsWith('demo-')) seen.delete(id)
  if (planIsDemo) plan = []
  planIsDemo = false
  agents = [...known.values()]
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

// Files as a tree of folders. A chain of folders with one child each shows as one line (src/api/routes/).
function buildTree(entries) {
  const root = { dirs: new Map(), files: [] }
  for (const en of entries) {
    const parts = en.path.split('/').filter(Boolean)
    if (en.path.startsWith('/')) parts.unshift('/')
    const name = parts.pop()
    let node = root
    for (const part of parts) {
      let next = node.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        node.dirs.set(part, next)
      }
      node = next
    }
    node.files.push({ name, en })
  }
  return root
}

function treeLines(node, prefix, out) {
  // Folders of the project first; paths outside it (/ and ~) go last
  const outside = (n) => (n === '/' || n === '~' ? 1 : 0)
  const dirs = [...node.dirs.entries()].sort((a, b) => outside(a[0]) - outside(b[0]) || a[0].localeCompare(b[0]))
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
  const total = dirs.length + files.length
  let i = 0
  for (const [first, firstChild] of dirs) {
    i += 1
    let name = first
    let child = firstChild
    while (child.files.length === 0 && child.dirs.size === 1) {
      const [n, c] = [...child.dirs.entries()][0]
      name = name === '/' ? '/' + n : name + '/' + n
      child = c
    }
    const last = i === total
    out.push({ prefix: prefix + (last ? '└─ ' : '├─ '), text: name.endsWith('/') ? name : name + '/', dir: true })
    treeLines(child, prefix + (last ? '   ' : '│  '), out)
  }
  for (const f of files) {
    i += 1
    out.push({ prefix: prefix + (i === total ? '└─ ' : '├─ '), text: f.name, en: f.en })
  }
}

// The tool-call log is a ring: the oldest call drops out first
function addCall(c) {
  calls.set(c.id, c)
  order.push(c.id)
  while (order.length > MAX_CALLS) calls.delete(order.shift())
}

function wipeLedger(demoOnly) {
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

function loadLedgerDemo(now) {
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
  call(19, 175, undefined, 'Bash', { command: 'git status --short' }, 'ok', 40)
  call(20, 140, undefined, 'Bash', { command: 'ruff check src' }, 'ok', 300)
  call(21, 65, undefined, 'Bash', { command: 'pytest tests/unit -q' }, 'ok', 2400)
  call(22, 35, undefined, 'Bash', { command: 'ruff check src' }, 'ok', 280)
  call(15, 55, undefined, 'Edit', { file_path: '/Users/kkwok/proj/src/api/routes/users.py' }, 'ok', 14)
  call(16, 50, undefined, 'Write', { file_path: '/Users/kkwok/proj/tests/unit/test_users.py' }, 'ok', 9)
  call(17, 45, undefined, 'Read', { file_path: '/Users/kkwok/proj/src/api/routes/orders.py' }, 'ok', 8)
  call(18, 20, 'a1', 'Edit', { file_path: '/Users/kkwok/proj/src/api/models.py' }, 'ok', 12)
  call(14, 3, undefined, 'Edit', { file_path: '/Users/kkwok/proj/src/auth.py' }, 'running')
  // The sample calls above are listed by number, not by time; the views read them in time order
  order.sort((a, b) => calls.get(a).t - calls.get(b).t)
  // The last turn began half a minute ago: its edits (auth.py, session.py, models.py) are marked
  turnAt = now - 30 * 1000
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

async function openPane($, focus) {
  try {
    const pane = { id: PANE, title: 'Lens', closeOnEscape: true }
    const placed = await $.ui.open(focus ? { ...pane, focus: true } : pane)
    // A pane Claude Code can't place yet (a narrow terminal) leaves the band to show the state
    isOpen = placed.isPlaced !== false
  } catch {
    isOpen = false
  }
}

async function closePane($) {
  isOpen = false
  pinned = false
  try {
    await $.ui.close({ id: PANE })
  } catch {}
}

async function sync($) {
  try {
    const now = await $.clock.now()
    let list = null
    try {
      list = await $.agent.list()
    } catch (error) {
      trace($, 'agent.list failed: ' + String(error))
    }
    if (list) {
      const ids = new Set(list.map((a) => a.id))
      for (const a of list) known.set(a.id, a)
      // One that left the list while live finished without us seeing how
      for (const [id, a] of known) {
        if (!ids.has(id) && !id.startsWith('demo-') && LIVE.has(a.status)) {
          trace($, id + ' left the list while ' + a.status + '; counting it as completed')
          known.set(id, { ...a, status: 'completed' })
        }
      }
    }
    agents = [...known.values()]
    for (const a of agents) {
      const s = entry(a.id, now)
      if (LIVE.has(a.status)) s.endedAt = undefined
      else if (s.endedAt === undefined) s.endedAt = now
    }
    const live = agents.some((a) => LIVE.has(a.status))
    if (live && !hadLive) {
      // A new deployment: show the pane, unless the person already has it up
      hadLive = true
      finishedAt = undefined
      trace($, 'agents deployed (' + agents.filter((a) => LIVE.has(a.status)).length + ' live); pane open: ' + isOpen)
      if (!isOpen) await openPane($, false)
      trace($, 'auto-open done; pane open: ' + isOpen)
    } else if (!live && hadLive) {
      hadLive = false
      finishedAt = now
      trace($, 'all ' + agents.length + ' agents finished; folding in ' + MINIMIZE_MS / 1000 + 's unless pinned')
    }
    if (!live && finishedAt !== undefined && !pinned && isOpen && now - finishedAt >= MINIMIZE_MS) {
      trace($, 'folding the pane into the band')
      await closePane($)
    }
  } catch (error) {
    trace($, 'sync failed: ' + String(error))
  }
  if (agents.length > 0 || isOpen) $.ui.invalidate('ui.render')
}

// The ledger's record of a tool call. An observer: it must never get in the way of the call.
async function recordCall($, e) {
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
}

// An observer: a failure here must never get in the way of the tool call
async function note($, e) {
  try {
    const now = await $.clock.now()
    const s = entry(e.agentId, now)
    s.tools += 1
    s.last = describeTool(e)
    s.events.push({ t: now, kind: kindOf(e.tool) })
    if (s.events.length > MAX_EVENTS) s.events.shift()
    await sync($)
  } catch {}
}

// Tokens a subagent's turn spent, not counting what it read back from the prompt cache
async function spend($, e) {
  try {
    const u = e.usage
    const s = entry(e.agentId, await $.clock.now())
    s.tokens += u.input_tokens + u.cache_creation_input_tokens + u.output_tokens
    if (isOpen) $.ui.invalidate('ui.render')
  } catch {}
}

async function selectView($, name) {
  view = name
  // Looking at the ledger is a choice to stay, so the pane must not fold away
  if (name === 'activity' || name === 'context') pinned = true
  if (name === 'context') await loadItems($)
  $.ui.invalidate('ui.render')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    // Elapsed times only move with the clock, and agents appear on their own, so poll
    $.clock.every(1000, async () => {
      await sync($)
    })
    try {
      cwd = await $.session.cwd()
    } catch {}
    // Register last: a name Claude Code already uses throws and would skip the rest
    try {
      await $.command.register({
        name: 'lens',
        description: 'Show or hide the session pane: plan, agents, activity, context',
        argumentHint: '[agents | timeline | activity | context | demo | demo off]',
        immediate: true,
      })
    } catch {}
    return next(e)
  })

  // Count each subagent's tool calls and remember what it is doing now
  on('tool.call', async ($, e, next) => {
    await recordCall($, e)
    if (e.agentId) await note($, e)
    else if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) {
      plan = e.todos.map((t) => ({ content: String(t.content), status: t.status, activeForm: String(t.activeForm ?? t.content) }))
      planIsDemo = false
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId && e.usage) await spend($, e)
    if (!e.agentId && isOpen && view === 'context') {
      await loadItems($)
      $.ui.invalidate('ui.render')
    }
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
    try {
      turnAt = await $.clock.now()
    } catch {}
    return next(e)
  })

  // /lens toggles the pane; /lens <view> opens it on that tab (again, to close it)
  on('command.run', { command: 'lens' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const VIEWS = { agents: 'roster', roster: 'roster', timeline: 'timeline', activity: 'activity', context: 'context' }
    if (arg === 'demo') {
      const now = await $.clock.now()
      loadDemo(now)
      loadLedgerDemo(now)
      pinned = true
      if (!isOpen) await openPane($, true)
      $.ui.invalidate('ui.render')
      return { text: 'demo loaded: run /lens demo off to clear it' }
    }
    if (arg === 'demo off') {
      clearDemo()
      wipeLedger(true)
      $.ui.invalidate('ui.render')
      return { text: 'demo cleared' }
    }
    if (arg && !(arg in VIEWS)) {
      return { text: 'usage: /lens [agents | timeline | activity | context | demo | demo off]' }
    }
    // Asking for the tab already showing, or for no tab while open, closes the pane
    if (isOpen && (!arg || VIEWS[arg] === view)) {
      await closePane($)
      return {}
    }
    if (arg) view = VIEWS[arg]
    pinned = true
    if (!isOpen) await openPane($, true)
    if (view === 'context') await loadItems($)
    await sync($)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isOpen = false
      pinned = false
    }
    return next(e)
  })

  // /clear, /resume and exit start the roster over
  on('session.end', async ($, e, next) => {
    wipeLedger(false)
    turnMark = 0
    turnAt = undefined
    openMore.clear()
    agents = []
    plan = []
    planIsDemo = false
    known.clear()
    seen.clear()
    hadLive = false
    finishedAt = undefined
    pinned = false
    return next(e)
  })

  // The folded form: one line above the prompt while the pane is closed
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Other mods draw in this band too, so keep what they draw
    const others = await next(e)
    const why = isOpen ? 'pane is open' : agents.length === 0 ? 'no agents known' : e.props.hasSurvey ? 'survey holds the band' : ''
    const state = why ? 'hidden: ' + why : 'shown, others: ' + (others ? String(others.type) : 'none')
    if (state !== bandState) {
      bandState = state
      trace($, 'band ' + state)
    }
    if (why) return others
    const rest = others && others.type !== 'engine' ? [others] : []
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()

    const count = (test) => agents.filter(test).length
    const live = count((a) => LIVE.has(a.status))
    const failed = count((a) => a.status === 'failed')
    const done = agents.length - live - failed
    const spent = agents.reduce((n, a) => n + (seen.get(a.id)?.tokens ?? 0), 0)
    const first = agents.reduce((t, a) => Math.min(t, entry(a.id, now).startedAt), now)
    const last = agents.reduce((t, a) => Math.max(t, entry(a.id, now).endedAt ?? now), first)

    const bits = []
    const add = (n, status, word) => {
      if (!n) return
      const st = STATUS[status]
      bits.push(
        Box({
          key: 'bit-' + word,
          flexDirection: 'row',
          columnGap: 1,
          children: [Text({ color: st.color, children: [st.dot] }), Text({ children: [n + ' ' + word] })],
        }),
      )
    }
    const planDone = plan.filter((t) => t.status === 'completed').length
    if (plan.length) bits.push(Text({ key: 'bit-plan', dimColor: true, children: ['plan ' + planDone + '/' + plan.length] }))
    add(live, 'running', 'running')
    add(done, 'completed', 'done')
    add(failed, 'failed', 'failed')

    const line = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingX: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ bold: true, color: ACCENT, children: ['◆ agents'] }),
            ...bits,
            Text({ dimColor: true, children: [(spent ? fmt(spent) + ' tok · ' : '') + clock(last - first)] }),
          ],
        }),
        Button({
          key: 'expand',
          label: '▸ expand',
          plain: true,
          onPress: async () => {
            pinned = true
            await openPane($, true)
            $.ui.invalidate('ui.render')
          },
        }),
      ],
    })
    return Box({ flexDirection: 'column', children: [line, ...rest] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const redraw = () => $.ui.invalidate('ui.render')

    const live = agents.filter((a) => LIVE.has(a.status)).length
    const failed = agents.filter((a) => a.status === 'failed').length
    const done = agents.length - live - failed
    const spent = agents.reduce((n, a) => n + (seen.get(a.id)?.tokens ?? 0), 0)

    const header = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Text({ bold: true, color: ACCENT, children: ['◆ agents'] }),
        Text({
          dimColor: true,
          children: [
            live + ' running · ' + done + ' done' + (failed ? ' · ' + failed + ' failed' : '') + (spent ? ' · ' + fmt(spent) + ' tok' : ''),
          ],
        }),
      ],
    })

    const tabs = Box({
      flexDirection: 'row',
      columnGap: 3,
      children: TAB_ORDER.map((name, i) =>
        Button({
          key: 'tab-' + name,
          label: TABS[name],
          hotkey: String(i + 1),
          plain: true,
          dimColor: view !== name,
          onPress: () => selectView($, name),
        }),
      ),
    })

    const empty = Text({
      dimColor: true,
      children: ['No subagents yet. They show up here when Claude starts one.'],
    })

    // Roster: two lines per agent
    const roster = ordered(agents).map(({ a, depth }) => {
      const st = STATUS[a.status] ?? FALLBACK
      const s = entry(a.id, now)
      const elapsed = clock((s.endedAt ?? now) - s.startedAt) + (s.tokens ? ' · ' + fmt(s.tokens) + ' tok' : '')
      return Box({
        key: 'agent-' + a.id,
        flexDirection: 'column',
        paddingLeft: depth * 2,
        children: [
          Box({
            flexDirection: 'row',
            justifyContent: 'space-between',
            children: [
              Box({
                flexDirection: 'row',
                columnGap: 1,
                children: [
                  Text({ color: st.color, children: [st.dot] }),
                  Text({ bold: true, wrap: 'truncate-end', children: [a.description] }),
                  Text({ dimColor: true, children: [a.type] }),
                ],
              }),
              Text({ dimColor: true, children: [elapsed] }),
            ],
          }),
          Text({
            dimColor: true,
            wrap: 'truncate-end',
            children: ['  ' + (s.last || 'starting…') + ' · ' + s.tools + (s.tools === 1 ? ' tool' : ' tools')],
          }),
        ],
      })
    })

    // Timeline: one lane per agent over a shared clock, colored by what it was doing
    const barW = Math.max(10, e.props.bodyColumns - LABEL - 1)
    const first = agents.reduce((t, a) => Math.min(t, entry(a.id, now).startedAt), now)
    // A finished session ends where its last agent did, not at the clock
    const stillGoing = agents.some((a) => LIVE.has(a.status))
    const stop = stillGoing ? now : agents.reduce((t, a) => Math.max(t, entry(a.id, now).endedAt ?? now), first)
    const last = Math.max(stop, first + 10000)
    const lanes = ordered(agents).map(({ a, depth }) => {
      const st = STATUS[a.status] ?? FALLBACK
      const s = entry(a.id, now)
      const room = LABEL - 3 - depth
      const name = a.description.length > room ? a.description.slice(0, room - 1) + '…' : a.description
      return Box({
        key: 'lane-' + a.id,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Box({
            flexDirection: 'row',
            columnGap: 1,
            width: LABEL,
            children: [Text({ color: st.color, children: [st.dot] }), Text({ children: [' '.repeat(depth) + name] })],
          }),
          Box({
            flexDirection: 'row',
            children: lane(s, first, last, barW, now).map(([mark, n], i) =>
              mark === null
                ? Text({ key: 'g' + i, children: [' '.repeat(n)] })
                : mark === 'idle'
                  ? Text({ key: 'g' + i, dimColor: true, children: ['·'.repeat(n)] })
                  : Text({ key: 'g' + i, color: KINDS[mark].color, children: ['█'.repeat(n)] }),
            ),
          }),
        ],
      })
    })
    const axis = Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ children: [' '.repeat(LABEL)] }),
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: barW,
          children: [Text({ dimColor: true, children: ['00:00'] }), Text({ dimColor: true, children: [clock(last - first)] })],
        }),
      ],
    })
    const legend = Box({
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 2,
      children: Object.entries(KINDS).map(([k, v]) =>
        Box({
          key: 'key-' + k,
          flexDirection: 'row',
          columnGap: 1,
          children: [Text({ color: v.color, children: ['█'] }), Text({ dimColor: true, children: [v.label] })],
        }),
      ).concat([
        Box({ key: 'key-idle', flexDirection: 'row', columnGap: 1, children: [Text({ dimColor: true, children: ['·'] }), Text({ dimColor: true, children: ['thinking'] })] }),
      ]),
    })

    // Plan: Claude's checklist, the current step highlighted
    let planBlock = []
    if (plan.length) {
      const doneSteps = plan.filter((t) => t.status === 'completed').length
      const win = planWindow(plan)
      const more = (n, word) => Text({ dimColor: true, children: ['  … ' + n + ' ' + word] })
      planBlock = [
        Box({
          flexDirection: 'column',
          children: [
            Box({
              flexDirection: 'row',
              justifyContent: 'space-between',
              children: [
                Text({ bold: true, color: ACCENT, children: ['◆ plan'] }),
                Text({ dimColor: true, children: [doneSteps + ' of ' + plan.length] }),
              ],
            }),
            ...(win.above ? [more(win.above, 'earlier')] : []),
            ...win.rows.map((t, i) => {
              const mark = PLAN_MARK[t.status] ?? PLAN_MARK.pending
              const current = t.status === 'in_progress'
              return Box({
                key: 'step-' + win.above + '-' + i,
                flexDirection: 'row',
                columnGap: 1,
                children: [
                  Text({ color: mark.color, children: [mark.dot] }),
                  Text({
                    bold: current,
                    dimColor: t.status === 'completed',
                    wrap: 'truncate-end',
                    children: [current ? t.activeForm : t.content],
                  }),
                ],
              })
            }),
            ...(win.below ? [more(win.below, 'more')] : []),
          ],
        }),
      ]
    }

    const body =
      agents.length === 0 ? (plan.length ? [] : [empty]) : view === 'roster' ? roster : [Box({ flexDirection: 'column', children: lanes }), axis, legend]

    // The ledger tabs
    if (view === 'activity' || view === 'context') {
      const pick = (key, label, hotkey, active, onPress) => Button({ key, label, hotkey, plain: true, dimColor: !active, onPress })
      const row = (children, extra) => Box({ flexDirection: 'row', columnGap: 1, ...(extra ?? {}), children })
      const title = (left, right) =>
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [Text({ bold: true, color: ACCENT, children: [left] }), Text({ dimColor: true, children: [right] })],
        })
      const dim = (text) => Text({ dimColor: true, wrap: 'truncate-end', children: [text] })
      // A title with its rows right under it; the gap only goes between sections
      const section = (head, list) => Box({ flexDirection: 'column', children: [head, ...list] })
      const more = (n) => (n > 0 ? [dim('  … ' + n + ' more')] : [])
      // How many rows a section shows, and the "n more" / "show less" under it
      const limit = (name, rows) => (openMore.has(name) ? OPEN_ROWS : rows)
      const moreToggle = (name, total, rows) => {
        const open = openMore.has(name)
        const hidden = total - limit(name, rows)
        if (!open && hidden <= 0) return []
        return [
          Button({
            key: 'more-' + name,
            label: open ? '  ▴ show less' : '  ▸ ' + hidden + ' more',
            plain: true,
            dimColor: true,
            onPress: () => {
              if (openMore.has(name)) openMore.delete(name)
              else openMore.add(name)
              redraw()
            },
          }),
          ...(open ? more(hidden) : []),
        ]
      }

      let body
      if (view === 'activity') {
        const list = order.map((id) => calls.get(id))

        // Files Claude changed, newest first; files it only read are optional
        const changed = new Map()
        for (const c of list) {
          if (!CHANGE.has(c.tool) || !c.target) continue
          const f = changed.get(c.target) ?? { edits: 0, failed: 0, last: 0, sub: false, turn: false }
          if (c.status === 'failed') f.failed += 1
          else f.edits += 1
          f.last = c.t
          f.sub = f.sub || Boolean(c.agentId)
          f.turn = f.turn || (turnAt !== undefined && c.t >= turnAt)
          changed.set(c.target, f)
        }
        const turnCount = [...changed.values()].filter((f) => f.turn).length
        const readPaths = new Set(list.filter((c) => c.tool === 'Read' && c.target).map((c) => c.target))
        const readOnly = [...readPaths].filter((p) => !changed.has(p))
        const entries = [
          ...[...changed.entries()].map(([path, f]) => ({ path: shortPath(path), kind: 'changed', ...f })),
          ...(showReads ? readOnly.map((path) => ({ path: shortPath(path), kind: 'read' })) : []),
        ]
        const lines = []
        treeLines(buildTree(entries), '', lines)
        const shown = lines.slice(0, limit('files', TREE_ROWS))

        const treeRows = shown.length
          ? [
              ...shown.map((l, i) => {
                const en = l.en
                const icon = !en ? ' ' : en.kind === 'read' ? '○' : en.edits ? '✎' : '✖'
                const color = !en ? undefined : en.kind === 'read' ? undefined : en.edits ? KINDS.change.color : BAD
                const meta =
                  en && en.kind === 'changed'
                    ? '×' + (en.edits + en.failed) + (en.sub ? ' ↳' : '') + ' · ' + (en.turn ? 'last turn' : ago(now - en.last))
                    : ''
                return Box({
                  key: 'tree-' + i,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  children: [
                    Box({
                      flexDirection: 'row',
                      children: [
                        Text({ dimColor: true, children: [l.prefix] }),
                        ...(en ? [Text({ color, dimColor: en.kind === 'read', children: [icon + ' '] })] : []),
                        Text({ bold: Boolean(en) && en.kind === 'changed', dimColor: !en || en.kind === 'read', wrap: 'truncate-end', children: [l.text] }),
                        ...(en && en.turn ? [Text({ color: BLUE, children: [' ●'] })] : []),
                      ],
                    }),
                    Text({ color: en && en.turn ? BLUE : undefined, dimColor: !(en && en.turn), children: [meta || ' '] }),
                  ],
                })
              }),
              ...moreToggle('files', lines.length, TREE_ROWS),
            ]
          : [dim(list.length ? 'No files changed yet.' : 'Nothing yet. Tool calls show up here as Claude makes them.')]

        const filesHead = Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          children: [
            Box({
              flexDirection: 'row',
              children: [
                Text({ bold: true, color: ACCENT, children: ['◆ files changed  ' + changed.size + (readPaths.size ? ' · ' + readPaths.size + ' read' : '')] }),
                ...(turnCount ? [Text({ color: BLUE, children: [' · ● ' + turnCount + ' last turn'] })] : []),
              ],
            }),
            pick('toggle-reads', showReads ? 'hide reads' : 'show reads', 'r', showReads, () => {
              showReads = !showReads
              redraw()
            }),
          ],
        })

        // Commands: newest first, with the error under a failed one
        const cmds = list.filter((c) => c.tool === 'Bash').reverse()
        const cmdFailed = cmds.filter((c) => c.status === 'failed').length
        const cmdRows = cmds.length
          ? [
              ...cmds.slice(0, limit('commands', CMD_ROWS)).map((c, i) =>
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
              ...moreToggle('commands', cmds.length, CMD_ROWS),
            ]
          : [dim('No commands run yet.')]

        // Feed: every kind of tool call, newest first
        const recent = [...list].reverse()
        const feedRows = recent.length
          ? [
              ...recent.slice(0, limit('feed', FEED_ROWS)).map((c, i) =>
                row(
                  [
                    Box({
                      flexDirection: 'row',
                      columnGap: 1,
                      children: [
                        Text({ color: KINDS[c.kind].color, children: ['█'] }),
                        Text({ bold: true, children: [c.tool] }),
                        Text({ dimColor: true, wrap: 'truncate-start', children: [c.kind === 'run' ? clip(c.target, 40) : shortPath(c.target)] }),
                      ],
                    }),
                    Text({ color: c.status === 'failed' ? BAD : undefined, dimColor: c.status !== 'failed', children: [(c.agentId ? '↳ ' : '') + ago(now - c.t)] }),
                  ],
                  { key: 'feed-' + i, justifyContent: 'space-between' },
                ),
              ),
              ...moreToggle('feed', recent.length, FEED_ROWS),
            ]
          : [dim('No tool calls yet.')]

        body = [
          section(filesHead, treeRows),
          section(title('◆ commands', cmds.length + (cmdFailed ? ' · ' + cmdFailed + ' failed' : '')), cmdRows),
          section(title('◆ recent activity', recent.length + ' calls'), feedRows),
        ]
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
    }

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [tabs, ...planBlock, header, ...body],
    })
  })
}
