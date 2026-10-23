// Context bar above the prompt: one stacked segment per /context category,
// plan-limit usage in the header, and a one-line summary after each turn.
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

// Shorter legend labels than /context prints
const LABELS = {
  'system tools': 'tools',
  'custom agents': 'agents',
  'mcp server instructions': 'mcp instructions',
}

// Latest readings, and whether the band is shown
let breakdown = null
let rateLimits = []
let visible = true

// Context tokens after the previous turn, how much the last turn added, and output tokens generated this session
let lastContext = null
let lastDelta = null
let outTotal = 0

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

  on('turn.complete', async ($, e, next) => {
    // Subagent turns and turns with no response have nothing to report
    if (e.agentId || !e.usage) return next(e)

    outTotal += e.usage.output_tokens
    const now = (await $.session.usage()).context.tokens
    const delta = now !== undefined && lastContext !== null ? now - lastContext : null
    if (now !== undefined) lastContext = now
    lastDelta = delta

    if (!visible) return next(e)
    await refresh($)

    // The line is plain text, so the context cost leads it; the band above the prompt shows it in color
    const input = e.usage.input_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens
    const parts = []
    if (delta !== null) parts.push(signed(delta) + ' context last turn → ' + fmt(now))
    parts.push('out ' + fmt(e.usage.output_tokens) + ' · session ' + fmt(outTotal))
    if (input > 0) parts.push('cache ' + Math.round((e.usage.cache_read_input_tokens / input) * 100) + '%')
    return { text: parts.join(' · '), usage: e.usage }
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

    // Biggest first; the compaction buffer, then free space, close the bar
    const rank = (c) => (c.kind === 'free' ? 2 : c.kind === 'buffer' ? 1 : 0)
    const rows = [...breakdown.categories].sort((a, b) => rank(a) - rank(b) || b.tokens - a.tokens)

    // One bar segment per row, at least one cell for any row that holds tokens
    const segments = []
    let used = 0
    for (const c of rows) {
      if (c.kind === 'deferred' || c.tokens <= 0) continue
      const key = c.name.toLowerCase()
      const color = c.kind === 'free' || c.kind === 'buffer' ? FREE : (COLORS[key] ?? FALLBACK)
      const ch = c.kind === 'buffer' ? '▒' : '█'
      const cells = Math.max(1, Math.round((c.tokens / max) * width))
      segments.push({ c, color, ch, cells })
      used += cells
    }
    // Absorb rounding drift in the free-space segment so the bar is exactly `width`
    const free = segments.find((s) => s.c.kind === 'free')
    if (free) free.cells = Math.max(0, free.cells + (width - used))

    const bar = Box({
      flexDirection: 'row',
      children: segments.map((s, i) =>
        Text({ key: 'seg-' + i, color: s.color, children: [s.ch.repeat(s.cells)] }),
      ),
    })

    // Legend: a swatch, the label, tokens, and the share of the window
    const legend = rows
      .filter((c) => c.kind !== 'deferred')
      .map((c, i) => {
        const key = c.name.toLowerCase()
        const color = c.kind === 'free' || c.kind === 'buffer' ? FREE : (COLORS[key] ?? FALLBACK)
        const label = c.kind === 'free' ? 'free' : (LABELS[key] ?? key)
        const pct = c.kind === 'free' ? '' : Math.round((c.tokens / max) * 100) + '%'
        return Box({
          key: 'leg-' + i,
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ color: c.kind === 'free' ? '#6b7280' : color, children: ['■'] }),
            Text({ dimColor: true, children: [label] }),
            Text({ bold: true, children: [fmt(c.tokens)] }),
            ...(pct ? [Text({ dimColor: true, children: [pct] })] : []),
          ],
        })
      })

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
            Text({ children: [breakdown.model] }),
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

    // What the last turn added leads the legend: the header has no room for it beside the plan limits,
    // and the legend wraps where the header would overflow
    const delta =
      lastDelta !== null
        ? [
            Box({
              key: 'delta',
              flexDirection: 'row',
              columnGap: 1,
              children: [
                Text({ bold: true, color: deltaColor(lastDelta), children: [signed(lastDelta)] }),
                Text({ dimColor: true, children: ['last turn'] }),
              ],
            }),
          ]
        : []

    const box = Box({
      flexDirection: 'column',
      borderStyle: 'round',
      paddingX: 1,
      children: [header, bar, Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [...delta, ...legend] })],
    })
    return rest.length ? Box({ flexDirection: 'column', children: [box, ...rest] }) : box
  })
}
