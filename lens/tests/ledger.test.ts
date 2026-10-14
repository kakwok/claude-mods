import { mock, test } from 'claude-code/testing'

// The ledger tabs (Activity, Context) of the merged pane, driven by the real hooks and by the demo data.
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
  if (el.type === 'Button') return [fit(P.hotkey ? `${P.hotkey}: ${P.label}` : P.plain ? P.label : `[ ${P.label} ]`, w)]
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


// What the stubbed agent list and pane closes look like, for tests that change them
let AGENTS: any[] = []
let CLOSES = 0

const stubs = (on: any, clock: any) => {
  AGENTS = []
  CLOSES = 0
  on('session.start', () => ({ cwd: '/Users/kkwok/proj' }))
  on('session.cwd', () => ({ value: '/Users/kkwok/proj' }))
  on('agent.list', () => ({ value: AGENTS }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => {
    CLOSES += 1
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('classic.PostToolUse', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  on('prompt.attachment', (_: any, e: any) => ({ text: e.text }))
  on('prompt.context', () => ({ blocks: [] }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('session.usage', () => ({
    value: {
      context: {
        window: 1000000,
        breakdown: {
          memoryFiles: [{ path: '/Users/kkwok/.claude/projects/proj/memory/MEMORY.md', type: 'AutoMem', tokens: 262 }],
          mcpTools: [
            { name: 'a', serverName: 'claude_ai_Docs', tokens: 200, isLoaded: false },
            { name: 'b', serverName: 'claude_ai_Docs', tokens: 200, isLoaded: false },
            { name: 'c', serverName: 'claude-in-chrome', tokens: 400, isLoaded: true },
          ],
          skills: { totalSkills: 47, includedSkills: 47, tokens: 8300, skillFrontmatter: [] },
          agents: [],
        },
      },
      rateLimits: [],
    },
  }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
}

const dump = async (ui: any, title: string) => {
  const w = PANE.props.bodyColumns
  const root = (await ui.find({ type: 'Box' })) as El
  console.log('\n── ' + title + ' ' + '─'.repeat(Math.max(0, w - title.length - 1)))
  console.log('┌' + '─'.repeat(w + 2) + '┐')
  for (const l of lines(root, w)) console.log('│ ' + fit(l, w) + ' │')
  console.log('└' + '─'.repeat(w + 2) + '┘')
}

test('real events fill the ledger', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, clock)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/Users/kkwok/proj' })
  await $.prompt.submit({ text: 'fix the login bug' })

  let n = 0
  const call = async (tool: string, args: Record<string, string>, failed = false, agentId?: string) => {
    const id = 'toolu_' + ++n
    await $.tool.call({ tool, tool_use_id: id, ...(agentId ? { agentId } : {}), ...args } as any)
    await clock.advance(1500)
    if (failed) await $.classic.PostToolUseFailure({ tool_name: tool, tool_use_id: id, error: 'exit 1: 2 failed', duration_ms: 2100 } as any)
    else await $.classic.PostToolUse({ tool_name: tool, tool_use_id: id, duration_ms: 12 } as any)
  }
  await $.prompt.context({ blocks: [], instructionFiles: [{ path: '/Users/kkwok/.claude/CLAUDE.md', kind: 'user', content: '' }, { path: '/Users/kkwok/proj/CLAUDE.md', kind: 'project', content: '' }] } as any)
  await $.prompt.attachment({ type: 'instructions', text: 'Contents of CLAUDE.md: use pytest.', origin: { kind: 'engine' } } as any)
  await call('Read', { file_path: '/Users/kkwok/proj/src/auth.py' })
  await call('Grep', { pattern: 'login' })
  await call('Edit', { file_path: '/Users/kkwok/proj/src/auth.py' })
  await $.prompt.attachment({ type: 'edited_text_file', text: 'Note: src/auth.py was modified, either by the user or by a linter.', origin: { kind: 'engine' } } as any)
  await call('Bash', { command: 'pytest tests/test_auth.py -q' }, true)
  await call('Edit', { file_path: '/Users/kkwok/proj/src/auth.py' })
  await call('Write', { file_path: '/Users/kkwok/proj/tests/test_auth.py' })
  await call('Edit', { file_path: '/Users/kkwok/proj/src/api/routes/users.py' })
  await call('Read', { file_path: '/Users/kkwok/proj/src/api/routes/orders.py' })
  await call('Edit', { file_path: '/etc/hosts' })
  await $.prompt.attachment({ type: 'todo_reminder', text: 'The TodoWrite tool has not been used recently.', origin: { kind: 'engine' } } as any)
  await call('Bash', { command: 'pytest tests/test_auth.py -q' })
  await call('Grep', { pattern: 'TODO' }, false, 'a1')
  await $.prompt.attachment({ type: 'context', text: 'Branch: feature/auth-fix. 3 uncommitted files.', origin: { kind: 'hook', event: 'SessionStart' } } as any)
  await clock.advance(4000)

  await $.command.run({ command: 'lens', args: '' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-activity' })
  await dump(ui, 'activity')
  await ui.press({ key: 'toggle-reads' })
  await dump(ui, 'activity, with reads shown')
  await ui.press({ key: 'toggle-reads' })
  await ui.press({ key: 'tab-context' })
  await dump(ui, 'context')
  await ui.press({ key: 'att-todo_reminder' })
  await dump(ui, 'context: todo_reminder expanded')
})

test('/ledger demo shows sample data and clears it', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, clock)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/Users/kkwok/proj' })
  const ui = await $.ui.mount(PANE)
  console.log('\n/ledger demo -> ' + (await $.command.run({ command: 'lens', args: 'demo' })).text)
  await ui.press({ key: 'tab-activity' })
  await dump(ui, 'demo: activity')
  console.log('\n' + (await $.command.run({ command: 'lens', args: 'demo off' })).text)
  await dump(ui, 'after demo off')
})

test('viewing Activity keeps the pane from folding away', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, clock)
  AGENTS = [{ id: 'a1', description: 'map auth flow', type: 'Explore', status: 'running' }]
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/Users/kkwok/proj' })
  await clock.advance(2000) // agents deployed: the pane opens by itself
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-activity' }) // the person chooses to look at the ledger
  AGENTS = [{ id: 'a1', description: 'map auth flow', type: 'Explore', status: 'completed' }]
  await clock.advance(30000) // long past the 8 s fold delay
  console.log('\nafter 30 s with Activity open, closes: ' + CLOSES)
  if (CLOSES !== 0) throw new Error('the pane folded while Activity was showing')
  await ui.press({ key: 'tab-roster' }) // going back to Agents does not undo the choice
  await clock.advance(30000)
  console.log('after switching back to Agents, closes: ' + CLOSES + ' (it stays: the person pinned it)')
})

test('/lens routes by argument, and a manual open stays across a new batch of agents', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on, clock)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/Users/kkwok/proj' })
  const ui = await $.ui.mount(PANE)
  const run = async (args: string) => (await $.command.run({ command: 'lens', args })).text ?? ''
  console.log('\n/lens bogus -> ' + (await run('bogus')))
  await run('context') // opens on Context
  console.log('after /lens context: closes=' + CLOSES + ', context tab shown: ' + Boolean(await ui.find({ type: 'Text', text: /added to the prompt/ })))
  await run('activity') // already open: switches to Activity
  console.log('after /lens activity: closes=' + CLOSES + ', activity shown: ' + Boolean(await ui.find({ type: 'Text', text: /files changed/ })))
  await run('activity') // already on Activity: closes
  console.log('after /lens activity again: closes=' + CLOSES)
  await run('') // opens again (manual: pinned)
  AGENTS = [{ id: 'b1', description: 'second batch', type: 'Explore', status: 'running' }]
  await clock.advance(2000)
  AGENTS = [{ id: 'b1', description: 'second batch', type: 'Explore', status: 'completed' }]
  await clock.advance(30000)
  console.log('manual open, then a new batch finishes: closes=' + CLOSES + ' (still just the one from before)')
  if (CLOSES !== 1) throw new Error('the pane folded although the person opened it')
})
