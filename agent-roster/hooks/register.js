// Subagents in a pane: a plan checklist, a roster, and a timeline with one lane per agent.
// The pane opens by itself when agents are deployed, and a few seconds after the last
// one finishes it folds into a one-line band above the prompt; the band's "expand"
// (or /agent-roster) brings the full pane back. The tabs switch views (hotkeys 1 and 2).

const PANE = 'agent-roster'
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

// Claude's todo list, from its TodoWrite calls: [{ content, status, activeForm }]
let plan = []
let planIsDemo = false

let isOpen = false
// True once the person opened the pane themselves: then it stays until they close it
let pinned = false
// Whether any agent was live at the last look, and when the last one stopped
let hadLive = false
let finishedAt = undefined
let view = 'roster'
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
    $.ui.log('agent-roster: ' + text, { to: 'debug' })
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

// A made-up session for /agent-roster demo, so the views can be looked at without real agents
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

async function openPane($, focus) {
  try {
    const pane = { id: PANE, title: 'Agents', closeOnEscape: true }
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
      pinned = false
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

export function register(on) {
  on('session.start', async ($, e, next) => {
    // Elapsed times only move with the clock, and agents appear on their own, so poll
    $.clock.every(1000, async () => {
      await sync($)
    })
    // Register last: a name Claude Code already uses throws and would skip the rest
    try {
      await $.command.register({
        name: 'agent-roster',
        description: 'Show or hide the plan, subagent roster and timeline',
        argumentHint: '[demo | demo off]',
        immediate: true,
      })
    } catch {}
    return next(e)
  })

  // Count each subagent's tool calls and remember what it is doing now
  on('tool.call', async ($, e, next) => {
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
    return next(e)
  })

  on('command.run', { command: 'agent-roster' }, async ($, e) => {
    if (e.args.trim() === 'demo') {
      loadDemo(await $.clock.now())
      pinned = true
      if (!isOpen) await openPane($, true)
      $.ui.invalidate('ui.render')
      return { text: 'demo loaded: run /agent-roster demo off to clear it' }
    }
    if (e.args.trim() === 'demo off') {
      clearDemo()
      $.ui.invalidate('ui.render')
      return { text: 'demo cleared' }
    }
    if (isOpen) {
      await closePane($)
    } else {
      pinned = true
      await openPane($, true)
      await sync($)
    }
    return {}
  })

  // Esc or the pane's own close mark
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isOpen = false
      pinned = false
    }
    return next(e)
  })

  // /clear, /resume and exit start the roster over
  on('session.end', async ($, e, next) => {
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

    const tab = (name, label, hotkey) =>
      Button({
        key: 'tab-' + name,
        label,
        hotkey,
        plain: true,
        dimColor: view !== name,
        onPress: () => {
          view = name
          redraw()
        },
      })
    const tabs = Box({ flexDirection: 'row', columnGap: 3, children: [tab('roster', 'Roster', '1'), tab('timeline', 'Timeline', '2')] })

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

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [...planBlock, header, tabs, ...body],
    })
  })
}
