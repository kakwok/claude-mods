// Subagents in a pane: a roster, and a timeline with one lane per agent.
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

let isOpen = false
// True once the person opened the pane themselves: then it stays until they close it
let pinned = false
// Whether any agent was live at the last look, and when the last one stopped
let hadLive = false
let finishedAt = undefined
let view = 'roster'
// The latest $.agent.list()
let agents = []
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
    try {
      agents = await $.agent.list()
    } catch {
      agents = []
    }
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
      if (!isOpen) await openPane($, false)
    } else if (!live && hadLive) {
      hadLive = false
      finishedAt = now
    }
    if (!live && finishedAt !== undefined && !pinned && isOpen && now - finishedAt >= MINIMIZE_MS) {
      await closePane($)
    }
  } catch {}
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
        description: 'Show or hide the subagent roster and timeline',
        immediate: true,
      })
    } catch {}
    return next(e)
  })

  // Count each subagent's tool calls and remember what it is doing now
  on('tool.call', async ($, e, next) => {
    if (e.agentId) await note($, e)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId && e.usage) await spend($, e)
    return next(e)
  })

  on('command.run', { command: 'agent-roster' }, async ($) => {
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
    if (isOpen || agents.length === 0 || e.props.hasSurvey) return others
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

    const body =
      agents.length === 0 ? [empty] : view === 'roster' ? roster : [Box({ flexDirection: 'column', children: lanes }), axis, legend]

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [header, tabs, ...body],
    })
  })
}
