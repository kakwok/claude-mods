import { mock, test } from 'claude-code/testing'

// A multi-agent session played back on a fake clock. Prints the pane as text.
// The renderer is a rough sketch of the layout. Timeline blocks use one glyph per
// kind of work here (the real pane uses color): █ read/search  ▓ edit  ▒ shell  ░ web

const PANE = {
  plugin: 'lens',
  component: 'Pane',
  requestId: 'lens',
  surface: 'terminal',
  viewport: { columns: 140, rows: 40 },
  props: { title: 'Lens', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

type El = { type: string; props: Record<string, any>; children?: (El | string)[] }

const GLYPH: Record<string, string> = { '#4f8bf0': '█', '#e3b341': '▓', '#8b7cf6': '▒', '#6bbfc6': '░', '#f472b6': '◆', '#9ca3af': '▪' }

function fit(s: string, width?: number) {
  return width === undefined ? s : s.length > width ? s.slice(0, width - 1) + '…' : s.padEnd(width)
}

function lines(el: El | string, width: number): string[] {
  if (typeof el === 'string') return [el]
  const P = el.props ?? {}
  const kids = el.children ?? []
  const w = P.width as number | undefined
  if (el.type === 'Button') return [fit(P.hotkey ? `${P.hotkey}: ${P.label}` : `[ ${P.label} ]`, w)]
  if (el.type === 'Text') {
    let text = kids.map((k) => (typeof k === 'string' ? k : lines(k, width).join(' '))).join('')
    if (/^█+$/.test(text) && GLYPH[P.color]) text = GLYPH[P.color].repeat(text.length)
    return [fit(text, w)]
  }
  const pad = ' '.repeat(P.paddingLeft ?? 0)
  if (P.flexDirection === 'row') {
    const parts = kids.map((k) => lines(k, width)[0] ?? '')
    if (P.justifyContent === 'space-between' && parts.length === 2) {
      const total = w ?? width
      const room = total - (P.paddingLeft ?? 0) - parts[0].length - parts[1].length
      return [pad + parts[0] + ' '.repeat(Math.max(1, room)) + parts[1]]
    }
    if (P.flexWrap === 'wrap') {
      const out: string[] = []
      let cur = ''
      for (const p of parts) {
        if (cur && (cur + '  ' + p).length > width) {
          out.push(cur)
          cur = p
        } else cur = cur ? cur + '  ' + p : p
      }
      return [...out, cur].map((l) => pad + l)
    }
    return [fit(pad + parts.join(' '.repeat(P.columnGap ?? 0)), w)]
  }
  const out: string[] = []
  kids.forEach((k, i) => {
    if (i > 0 && P.rowGap) out.push('')
    out.push(...lines(k, width).map((l) => pad + l))
  })
  return out
}

const sec = (n: number) => n * 1000

test('simulate a multi-agent session', async ($, on) => {
  const clock = mock.clock(on)
  let list: any[] = []
  on('agent.list', () => ({ value: list }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  const log: string[] = []
  const stamp = () => Math.round(Number(clock.now()) / 1000) + 's'
  on('ui.open', ($, e) => {
    log.push(`pane opened at ${stamp()}${e.focus ? ' (focused)' : ' (no focus stolen)'}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    log.push(`pane closed at ${stamp()}`)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(PANE)
  const band = await $.ui.mount({ ...PANE, component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 60, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)

  const A = (id: string, description: string, type: string, status: string, parentId?: string) => ({ id, description, type, status, ...(parentId ? { parentId } : {}) })
  const call = (agentId: string, args: Record<string, string>) => $.tool.call({ agentId, ...args } as any)
  const spend = (agentId: string, out: number, inp: number) =>
    $.turn.complete({
      turnId: 't-' + agentId, agentId, answer: '', durationMs: 1000, isAborted: false, reason: 'answer',
      usage: { input_tokens: inp, output_tokens: out, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0, model: 'claude-test' },
    } as any)
  const STEPS = ['Map the auth flow', 'Write parser tests', 'Review the diff', 'Fix flagged issues', 'Update the README']
  const ING = ['Mapping the auth flow', 'Writing parser tests', 'Reviewing the diff', 'Fixing flagged issues', 'Updating the README']
  // Claude updates its todo list: the first `done` steps are finished and the next one is current
  const todo = (done: number) =>
    $.tool.call({
      tool: 'TodoWrite',
      todos: STEPS.map((content, i) => ({ content, activeForm: ING[i], status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' })),
    } as any)
  const at = async (t: number) => {
    const now = await clock.now()
    if (t * 1000 > now) await clock.advance(t * 1000 - now)
  }
  const show = async (title: string, target = ui) => {
    await clock.advance(0)
    const root = (await target.find({ type: 'Box' })) as El
    const w = PANE.props.bodyColumns
    console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, w - title.length - 1)))
    console.log('┌' + '─'.repeat(w + 2) + '┐')
    for (const l of lines(root, w)) if (target === ui || l.trim()) console.log('│ ' + fit(l, w) + ' │')
    console.log('└' + '─'.repeat(w + 2) + '┘')
  }

  // 0s: two subagents start
  list = [A('a1', 'map auth flow', 'Explore', 'running'), A('a2', 'write parser tests', 'general-purpose', 'running')]
  await at(1)
  await todo(0)
  console.log('\n(no one has typed /lens; agents were just deployed)')
  await call('a1', { tool: 'Grep', pattern: 'login' })
  await call('a2', { tool: 'Read', file_path: '/Users/kkwok/proj/src/parser.py' })
  await at(4)
  await call('a1', { tool: 'Read', file_path: '/Users/kkwok/proj/src/auth.py' })
  await spend('a1', 900, 1200)
  await at(9)
  await call('a1', { tool: 'Read', file_path: '/Users/kkwok/proj/src/session.py' })
  await call('a2', { tool: 'Read', file_path: '/Users/kkwok/proj/tests/conftest.py' })
  await at(14)
  await call('a1', { tool: 'WebFetch', url: 'https://example.com/oauth' })
  await spend('a2', 1800, 2500)
  await at(22)
  list = [A('a1', 'map auth flow', 'Explore', 'completed'), A('a2', 'write parser tests', 'general-purpose', 'running')]
  await spend('a1', 1400, 600)
  await call('a2', { tool: 'Write', file_path: '/Users/kkwok/proj/tests/test_parser.py' })

  // 24s: the test writer spawns a child to find fixtures
  await at(24)
  await todo(1)
  list = [...list, A('a3', 'find fixtures', 'Explore', 'running', 'a2')]
  await call('a3', { tool: 'Glob', pattern: 'tests/**/*.json' })
  await at(27)
  await call('a3', { tool: 'Grep', pattern: 'fixture' })
  await call('a2', { tool: 'Edit', file_path: '/Users/kkwok/proj/tests/test_parser.py' })
  await at(33)
  await call('a2', { tool: 'Bash', command: 'pytest tests/test_parser.py -q' })
  await at(40)
  list = list.map((a) => (a.id === 'a3' ? { ...a, status: 'failed' } : a))
  await spend('a3', 500, 900)
  await call('a2', { tool: 'Edit', file_path: '/Users/kkwok/proj/tests/test_parser.py' })
  await at(44)
  await call('a2', { tool: 'Bash', command: 'pytest tests/test_parser.py -q' })
  await at(47)
  await ui.press({ key: 'tab-timeline' })
  await show('47s in: timeline')
  await ui.press({ key: 'tab-roster' })
  await show('47s in: roster')
  await ui.press({ key: 'tab-timeline' })

  // 50s onward: tests pass, a reviewer starts
  await at(52)
  await todo(2)
  list = list.map((a) => (a.id === 'a2' ? { ...a, status: 'completed' } : a))
  await spend('a2', 3100, 2200)
  list = [...list, A('a4', 'review the diff', 'code-reviewer', 'running')]
  await call('a4', { tool: 'Bash', command: 'git diff main...HEAD' })
  await at(58)
  await call('a4', { tool: 'Read', file_path: '/Users/kkwok/proj/src/parser.py' })
  await at(63)
  await call('a4', { tool: 'Read', file_path: '/Users/kkwok/proj/tests/test_parser.py' })
  await spend('a4', 2600, 4100)
  await at(72)
  await call('a4', { tool: 'Grep', pattern: 'TODO' })
  await at(84)
  await show('84s in: timeline')
  await ui.press({ key: 'tab-roster' })
  await show('84s in: roster')

  // 85s: the reviewer finishes, so nothing is running; the pane waits a few seconds
  // Claude Code may also drop finished agents from its list; the roster has to keep them
  list = []
  await at(88)
  console.log('\n88s: all done, pane still up -> ' + log.join('; '))
  await at(95)
  console.log('\n95s: ' + log.join('; '))
  await show('95s in: folded into a band above the prompt', band)

  // expand again to check past activity
  await ui.press({ key: 'tab-timeline' })
  await $.command.run({ command: 'lens', args: '' })
  await at(110)
  console.log('\n110s, after /lens: ' + log.join('; '))
  await show('110s in: expanded on request, stays until closed')
})

test('/lens demo shows a full sample session', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(5000)
  const ui = await $.ui.mount(PANE)
  const answer = await $.command.run({ command: 'lens', args: 'demo' })
  console.log('\n/lens demo -> ' + answer.text)
  await clock.advance(2000)
  const w = PANE.props.bodyColumns
  const dump = async (title: string) => {
    const root = (await ui.find({ type: 'Box' })) as El
    console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, w - title.length - 1)))
    console.log('┌' + '─'.repeat(w + 2) + '┐')
    for (const l of lines(root, w)) console.log('│ ' + fit(l, w) + ' │')
    console.log('└' + '─'.repeat(w + 2) + '┘')
  }
  await ui.press({ key: 'tab-roster' })
  await dump('demo: roster tab')
  await ui.press({ key: 'tab-timeline' })
  await dump('demo: timeline tab')
  console.log('\n' + (await $.command.run({ command: 'lens', args: 'demo off' })).text)
})
