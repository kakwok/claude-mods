// Context bar above the prompt: one stacked segment per /context category (Messages split by source, small ones folded),
// plan-limit usage in the header, and a summary under each turn's duration line.
// Shown by default; /context-bar toggles it.

// Colors by category name, as /context names them
const COLORS = {
  'system prompt': '#7b9fd8',
  'system tools': '#6bbfc6',
  'mcp tools': '#8b7cf6',
  'mcp server instructions': '#b4a9fa',
  'custom agents': '#9bc57a',
  'memory files': '#e3c26b',
  skills: '#e8a0bf',
  messages: '#d97757',
}
const FALLBACK = '#a0a0a0'
const FREE = '#2c3345'
const ACCENT = '#d97757'
const BLUE = '#4f8bf0'
const TRACK = '#2a3a5e'
const AMBER = '#e3b341'
const RED = '#e5534b'

// One color per model family, for the model name and the band's frame, so a session on another model stands out
const FAMILIES = {
  opus: '#a78bfa',
  sonnet: '#4ade80',
  haiku: '#38bdf8',
  fable: '#f472b6',
}

function familyColor(model) {
  const m = String(model ?? '').toLowerCase()
  for (const [family, color] of Object.entries(FAMILIES)) if (m.includes(family)) return color
  return undefined
}

// Shorter legend labels than /context prints
const LABELS = {
  'system tools': 'tools',
  'custom agents': 'agents',
  'mcp server instructions': 'mcp instructions',
}

// Share of the context window under which a row folds into "other". Messages, free space and the compact buffer never fold.
const FOLD = 0.03

// Messages is opened up by source: four parts, so it never needs folding. The shades stay close to the Messages color.
const MSG_COLORS = {
  explore: '#d97757',
  replies: '#e59a7d',
  actions: '#c9694a',
  prompts: '#f1bba6',
  earlier: '#9c6a58',
  summary: '#9c6a58',
  other: '#8a8f9c',
}

// Reading and searching is "explore"; everything else a tool does (shell, edits, subagent calls, MCP, web) is "actions"
function groupOf(tool) {
  return /^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool) ? 'explore' : 'actions'
}

// Estimated Messages tokens per source for the current window. The split is a guess (growth of Messages per turn,
// shared out by what ran); render scales it so the parts add up to the real Messages total.
let split = new Map()
let lastMessages = null
let baseName = 'earlier'
// Characters of tool results seen since the last turn, per group
let seen = new Map()

function bump(map, key, n) {
  map.set(key, (map.get(key) ?? 0) + n)
}

function messagesOf(bd) {
  const c = bd?.categories?.find((x) => String(x.name).toLowerCase() === 'messages')
  return c ? c.tokens : null
}

// Called after each main-thread turn with the new Messages total and the tokens the model generated
function track(total, out) {
  if (total === null) return
  if (lastMessages === null || total < lastMessages * 0.6) {
    // First reading, or the window was compacted or cleared: what is there now is one lump
    split = new Map([[baseName, total]])
    baseName = 'earlier'
  } else {
    const delta = total - lastMessages
    if (delta > 0) {
      const reply = Math.min(delta, out)
      if (reply > 0) bump(split, 'replies', reply)
      const rest = delta - reply
      const chars = [...seen.values()].reduce((a, b) => a + b, 0)
      if (rest > 0 && chars > 0) for (const [g, n] of seen) bump(split, g, (rest * n) / chars)
      else if (rest > 0) bump(split, 'prompts', rest)
    }
  }
  seen = new Map()
  lastMessages = total
}

// Fold rows under the cutoff into one "other", biggest first with "other" last
function fold(rows, window) {
  const keep = []
  let other = 0
  for (const r of rows) {
    if (r.tokens / window < FOLD) other += r.tokens
    else keep.push(r)
  }
  keep.sort((a, b) => b.tokens - a.tokens)
  if (other > 0) keep.push({ name: 'other', tokens: other })
  return keep
}

// Latest readings, and whether the band is shown
let breakdown = null
let rateLimits = []
let visible = true

// Context tokens after the previous turn, and output tokens generated this session
let lastContext = null
let outTotal = 0

// Each turn's summary, waiting for the duration line that closes the turn, and the lines that took one (by requestId).
// turn.complete and the line measure the turn a few ms apart, so a summary goes to the unclaimed line nearest its duration.
const pending = []
const claimed = new Map()
const NEAR_MS = 5_000

// Blue for a small turn, amber from 5k, red from 20k: a turn that size is worth a look
function deltaColor(delta) {
  return delta >= 20_000 ? RED : delta >= 5_000 ? AMBER : BLUE
}

function signed(delta) {
  return (delta >= 0 ? '▲ +' : '▼ -') + fmt(Math.abs(delta))
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return Math.round(n / 1e3) + 'k'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

// 7500000 ms -> "2h05m", 1800000 -> "30m", 200000000 -> "2d7h"
function until(ms) {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins >= 2880) return Math.floor(mins / 1440) + 'd' + Math.round((mins % 1440) / 60) + 'h'
  if (mins >= 60) return Math.floor(mins / 60) + 'h' + String(mins % 60).padStart(2, '0') + 'm'
  return mins + 'm'
}

function limitColor(percent) {
  return percent >= 90 ? RED : percent >= 75 ? AMBER : BLUE
}

// summary is local estimates and costs nothing; full calls the token-count API
async function refresh($) {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    breakdown = usage.context.breakdown ?? null
    rateLimits = usage.rateLimits ?? []
    // Nothing tracked yet (the mod just loaded, or the window was compacted): start the split from what is there now
    if (lastMessages === null) track(messagesOf(breakdown), 0)
  } catch {
    breakdown = null
    rateLimits = []
  }
  $.ui.invalidate('ui.render')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    // The reset countdown only moves with the clock, so redraw once a minute while shown
    $.clock.every(60_000, () => {
      if (visible) $.ui.invalidate('ui.render')
    })
    await $.command.register({
      name: 'context-bar',
      description: 'Show or hide the context bar',
      immediate: true,
    })
    // Fill the bar right away instead of waiting for the first turn
    if (visible) await refresh($)
    return next(e)
  })

  // Runs after each main-thread turn, and when a rate-limit window moves
  on('session.measure', async ($, e, next) => {
    if (visible) await refresh($)
    return next(e)
  })

  // What each main-thread tool returned, for sharing out the growth of Messages. An observer: it never gets in the way of the call.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      try {
        const body = typeof result?.text === 'string' ? result.text : JSON.stringify(result?.result ?? '')
        bump(seen, groupOf(e.tool), Math.min(body.length, 400_000))
      } catch {}
    }
    return result
  })

  // A compacted or cleared window starts the split over
  for (const command of ['compact', 'clear']) {
    on('command.run', { command }, async ($, e, next) => {
      const result = await next(e)
      lastMessages = null
      baseName = command === 'compact' ? 'summary' : 'earlier'
      seen = new Map()
      if (visible) await refresh($)
      return result
    })
  }

  on('turn.complete', async ($, e, next) => {
    // Subagent turns and turns with no response have nothing to report
    if (e.agentId || !e.usage) return next(e)

    outTotal += e.usage.output_tokens
    const now = (await $.session.usage()).context.tokens
    const delta = now !== undefined && lastContext !== null ? now - lastContext : null
    if (now !== undefined) lastContext = now

    if (!visible) {
      lastMessages = null
      return next(e)
    }
    await refresh($)
    track(messagesOf(breakdown), e.usage.output_tokens)

    // A plugin's turn.complete text is a plain notice, so the summary is drawn under the turn's duration line instead
    const input = e.usage.input_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens
    const parts = []
    if (delta !== null) parts.push('context last turn → ' + fmt(now))
    parts.push('out ' + fmt(e.usage.output_tokens) + ' · session ' + fmt(outTotal))
    if (input > 0) parts.push('cache ' + Math.round((e.usage.cache_read_input_tokens / input) * 100) + '%')
    pending.push({ durationMs: e.durationMs, delta, rest: parts.join(' · ') })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const line = await next(e)
    let summary = claimed.get(e.requestId)
    if (!summary && pending.length) {
      let best = -1
      for (let i = 0; i < pending.length; i++) {
        const off = Math.abs(pending[i].durationMs - e.props.durationMs)
        if (off <= NEAR_MS && (best < 0 || off < Math.abs(pending[best].durationMs - e.props.durationMs))) best = i
      }
      if (best >= 0) {
        summary = pending.splice(best, 1)[0]
        claimed.set(e.requestId, summary)
      }
    }
    if (!summary || !visible) return line
    const { Box, Text } = $.ui.resolve(e)
    return Box({
      flexDirection: 'column',
      children: [
        line,
        Box({
          flexDirection: 'row',
          columnGap: 1,
          paddingLeft: 2,
          children: [
            ...(summary.delta !== null ? [Text({ bold: true, color: deltaColor(summary.delta), children: [signed(summary.delta)] })] : []),
            Text({ dimColor: true, children: [summary.rest] }),
          ],
        }),
      ],
    })
  })

  // /model changes the model and its window, so refresh the readings as it runs (not on /config or the picker, which the mod cannot see)
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    if (visible) await refresh($)
    return result
  })

  on('command.run', { command: 'context-bar' }, async ($) => {
    visible = !visible
    if (visible) await refresh($)
    else $.ui.invalidate('ui.render')
    return { text: 'context bar ' + (visible ? 'shown' : 'hidden') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Other mods draw in this band too, so keep what they draw
    const others = await next(e)
    if (!visible || e.props.hasSurvey || !breakdown) return others
    const rest = others && others.type !== 'engine' ? [others] : []
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    // Inside the border and one column of padding on each side
    const width = Math.max(10, e.props.bodyColumns - 4)
    const max = breakdown.rawMaxTokens

    // Rows by group: the other categories, Messages opened up by source, then the compact buffer and free space
    const cats = breakdown.categories.filter((c) => c.kind !== 'deferred' && c.tokens > 0)
    const tail = [
      ...cats.filter((c) => c.kind === 'buffer').map((c) => ({ name: 'compact', tokens: c.tokens, color: FREE, ch: '▒' })),
      ...cats.filter((c) => c.kind === 'free').map((c) => ({ name: 'free', tokens: c.tokens, color: FREE, ch: '█', free: true })),
    ]
    const body = cats.filter((c) => c.kind !== 'free' && c.kind !== 'buffer')
    const messages = body.find((c) => c.name.toLowerCase() === 'messages')
    const baseRows = fold(
      body.filter((c) => c !== messages).map((c) => ({ name: LABELS[c.name.toLowerCase()] ?? c.name.toLowerCase(), tokens: c.tokens, color: COLORS[c.name.toLowerCase()] ?? FALLBACK })),
      max,
    ).map((r) => ({ ...r, color: r.color ?? MSG_COLORS.other, ch: '█' }))

    // The estimates are scaled so the parts add up to the real Messages total
    let parts = []
    if (messages) {
      const guess = [...split].filter(([, n]) => n > 0)
      const sum = guess.reduce((n, [, v]) => n + v, 0)
      if (sum > 0) {
        parts = guess
          .map(([name, n]) => ({ name, tokens: (n / sum) * messages.tokens, color: MSG_COLORS[name] ?? MSG_COLORS.other, ch: '█' }))
          .sort((a, b) => b.tokens - a.tokens)
      }
    }
    const lumped = messages && parts.length === 0 ? [{ name: 'messages', tokens: messages.tokens, color: COLORS.messages, ch: '█' }] : []

    // Biggest group first, "other" after them, then the compact buffer and free space.
    // Messages sorts as one group by its total, with its parts kept together.
    const rowsOf = baseRows.filter((r) => r.name !== 'other').map((r) => ({ tokens: r.tokens, rows: [r] }))
    if (messages) rowsOf.push({ tokens: messages.tokens, rows: parts.length ? parts : lumped, isMessages: parts.length > 0 })
    rowsOf.sort((x, y) => y.tokens - x.tokens)
    const other = baseRows.find((r) => r.name === 'other')
    if (other) rowsOf.push({ tokens: other.tokens, rows: [other] })

    // One bar segment per row; free space takes up the rounding drift so the bar is exactly `width`
    const barRows = [...rowsOf.flatMap((g) => g.rows), ...tail]
    const segments = barRows.map((r) => ({ r, cells: Math.round((r.tokens / max) * width) }))
    const free = segments.find((s) => s.r.free)
    if (free) free.cells = Math.max(0, free.cells + (width - segments.reduce((n, s) => n + s.cells, 0)))
    const bar = Box({
      flexDirection: 'row',
      children: segments.filter((s) => s.cells > 0).map((s, i) => Text({ key: 'seg-' + i, color: s.r.color, children: [s.r.ch.repeat(s.cells)] })),
    })

    // Legend: a swatch, the label, tokens, and the share of the window
    const item = (r, i) =>
      Box({
        key: 'leg-' + r.name + i,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color: r.color, children: ['■'] }),
          Text({ dimColor: true, children: [r.name] }),
          Text({ bold: true, children: [fmt(r.tokens)] }),
          ...(r.free || r.name === 'compact' ? [] : [Text({ dimColor: true, children: [Math.round((r.tokens / max) * 100) + '%'] })]),
        ],
      })
    const line = (key, children) => Box({ key, flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children })
    const messagesHead = Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color: COLORS.messages, children: ['■'] }),
        Text({ bold: true, color: COLORS.messages, children: ['messages'] }),
        Text({ bold: true, children: [fmt(messages?.tokens ?? 0)] }),
        Text({ dimColor: true, children: [Math.round(((messages?.tokens ?? 0) / max) * 100) + '% ▸'] }),
      ],
    })
    // Plain rows share a line; Messages and its parts get a line of their own
    const legend = []
    let run = []
    const flush = () => {
      if (run.length) legend.push(line('leg-' + legend.length, run.map(item)))
      run = []
    }
    for (const g of rowsOf) {
      if (g.isMessages) {
        flush()
        legend.push(line('leg-msg', [messagesHead, ...g.rows.map(item)]))
      } else run.push(...g.rows)
    }
    // Compact and free space join the last line when it is a plain one, instead of taking a line of their own
    if (run.length) {
      run.push(...tail)
      flush()
    } else {
      flush()
      legend.push(line('leg-tail', tail.map(item)))
    }

    // Plan limits, like the usage page: current session (5h) and this week.
    // Wide terminals get a bar and the reset countdown; narrower ones just the percent.
    const wide = e.props.bodyColumns >= 105
    const limits = []
    for (const kind of ['five_hour', 'seven_day']) {
      const r = rateLimits.find((x) => x.kind === kind)
      if (!r) continue
      const label = kind === 'five_hour' ? '5h' : 'wk'
      const color = limitColor(r.percentUsed)
      const filled = Math.min(6, Math.round((r.percentUsed / 100) * 6))
      const resets = r.resetsAt ? Date.parse(r.resetsAt) - now : NaN
      limits.push(
        Box({
          key: 'limit-' + kind,
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ dimColor: true, children: [label] }),
            ...(wide
              ? [Text({ color, children: ['█'.repeat(filled)] }), Text({ color: TRACK, children: ['█'.repeat(6 - filled)] })]
              : []),
            Text({ bold: true, color, children: [Math.round(r.percentUsed) + '%'] }),
            ...(wide && Number.isFinite(resets) ? [Text({ dimColor: true, children: ['⏱ ' + until(resets)] })] : []),
          ],
        }),
      )
    }
    // On a very narrow terminal the plan limits are the first thing to go
    const showLimits = limits.length > 0 && e.props.bodyColumns >= 80

    // The model is read live, so a /model switch shows at once rather than after the next turn
    const model = (await $.session.model()) || breakdown.model
    const modelColor = familyColor(model)
    const header = Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ bold: true, color: ACCENT, children: ['◆ context'] }),
            Text({ dimColor: true, children: ['·'] }),
            Text({ bold: Boolean(modelColor), color: modelColor, children: [model] }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Text({ bold: true, children: [fmt(breakdown.totalTokens)] }),
                Text({ dimColor: true, children: ['of ' + fmt(max) + ' · ' + Math.round(breakdown.percentage) + '%'] }),
              ],
            }),
            ...(showLimits ? [Text({ dimColor: true, children: ['│'] }), ...limits.flatMap((l, i) => (i ? [Text({ dimColor: true, children: ['·'] }), l] : [l]))] : []),
          ],
        }),
      ],
    })

    const box = Box({
      key: 'frame',
      flexDirection: 'column',
      borderStyle: 'round',
      ...(modelColor && { borderColor: modelColor }),
      paddingX: 1,
      children: [header, bar, ...legend],
    })
    return rest.length ? Box({ flexDirection: 'column', children: [box, ...rest] }) : box
  })
}
