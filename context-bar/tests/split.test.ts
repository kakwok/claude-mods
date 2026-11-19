import { mock, test } from 'claude-code/testing'

// Messages is opened up by source: explore, actions, replies, prompts as one block, small rows folded, never Messages/compact/free.

let MESSAGES = 10000
let MCP = 1700
// When the session began; undefined leaves it unknown, which reads as "earlier"
let STARTED: number | undefined
// False leaves the Messages category out, as in a new session before the first message
let HAS_MESSAGES = true
const usage = () => ({
  value: {
    startedAt: STARTED,
    context: {
      tokens: 40000 + MESSAGES,
      window: 200000,
      breakdown: {
        model: 'claude-opus-5-5',
        totalTokens: 40000 + MESSAGES,
        rawMaxTokens: 200000,
        percentage: ((40000 + MESSAGES) / 200000) * 100,
        categories: [
          { name: 'System prompt', tokens: 6200, kind: 'used' },
          { name: 'System tools', tokens: 12000, kind: 'used' },
          { name: 'Skills', tokens: 8000, kind: 'used' },
          { name: 'MCP tools', tokens: MCP, kind: 'used' },
          { name: 'Memory files', tokens: 12100, kind: 'used' },
          ...(HAS_MESSAGES ? [{ name: 'Messages', tokens: MESSAGES, kind: 'used' }] : []),
          { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
          { name: 'Free space', tokens: 200000 - 40000 - MESSAGES - 33000, kind: 'free' },
        ],
      },
    },
    rateLimits: [],
  },
})

const U = { input_tokens: 10, cache_read_input_tokens: 990, cache_creation_input_tokens: 0, output_tokens: 8000 }

async function setup($: any, on: any) {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('command.register', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', usage)
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'x'.repeat(40000), text: 'x'.repeat(40000) }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
}

let mounts = 0
const mount = ($: any) =>
  $.ui.mount({ plugin: 'context-bar', component: 'AbovePrompt', requestId: 'band-' + mounts++, surface: 'terminal', viewport: { columns: 140, rows: 40 }, props: { bodyColumns: 120, hasSurvey: false } } as any)

test('exploration shows as its own part of Messages, and small categories fold into other', async ($, on) => {
  await setup($, on)
  MESSAGES = 10000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  await $.tool.call({ tool: 'Read', tool_use_id: 't1', file_path: '/x' } as any)
  MESSAGES = 30000
  await $.turn.complete({ answer: 'b', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const band = await mount($)
  for (const label of ['messages', 'explore', 'replies', 'earlier', 'compact', 'free', 'other']) {
    if (!(await band.find({ type: 'Text', text: label }))) throw new Error('missing legend entry: ' + label)
  }
  if (await band.find({ type: 'Text', text: 'mcp tools' })) throw new Error('mcp tools (1.7k) should have folded into other')
  if (await band.find({ key: 'leg-1' })) throw new Error('a split Messages should share the one legend line, not start another')
  console.log('legend ok')
})

test('a compacted window starts the split over, with Messages as one plain row', async ($, on) => {
  await setup($, on)
  MESSAGES = 60000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  MESSAGES = 8000
  await $.turn.complete({ answer: 'b', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const band = await mount($)
  if (await band.find({ type: 'Text', text: 'explore' })) throw new Error('old split survived a compaction')
  if (await band.find({ type: 'Text', text: 'earlier' })) throw new Error('a one-part split should show as plain messages')
  if (!(await band.find({ type: 'Text', text: 'messages' }))) throw new Error('expected a messages row after a compaction')
})

test('a folded category comes back when it grows past 1% of the window, and folds again when it shrinks', async ($, on) => {
  await setup($, on)
  MESSAGES = 10000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)

  // Memory files at 12.1k is already shown; use MCP tools (1.7k, under the 2k cutoff on a 200k window) as the one that moves
  const has = async (label: string) => Boolean(await (await mount($)).find({ type: 'Text', text: label }))
  if (await has('mcp tools')) throw new Error('mcp tools at 1.7k should be folded')

  MCP = 9000
  await $.turn.complete({ answer: 'x', durationMs: 1000, usage: U, reason: 'answer' } as any)
  if (!(await has('mcp tools'))) throw new Error('mcp tools at 9k (4.5% of the window) should reappear')

  MCP = 1700
  await $.turn.complete({ answer: 'x', durationMs: 1000, usage: U, reason: 'answer' } as any)
  if (await has('mcp tools')) throw new Error('mcp tools should fold again after shrinking')
})

test('before any turn, Messages is a plain row on the same line as the other rows, compact and free', async ($, on) => {
  await setup($, on)
  MESSAGES = 50000
  // No turn has run: the split is one lump, which says nothing Messages does not
  const band = await mount($)
  if (await band.find({ type: 'Text', text: 'earlier' })) throw new Error('a one-part split should not show as "earlier"')
  if (await band.find({ key: 'leg-msg' })) throw new Error('a lone Messages row should not take a line of its own')
  if (await band.find({ key: 'leg-tail' })) throw new Error('compact and free sit on a line of their own')
  if (await band.find({ key: 'leg-1' })) throw new Error('expected one legend line, got more')
})

test('once the split has two parts, earlier shows beside them', async ($, on) => {
  // session.start takes the first reading, which becomes "earlier"
  MESSAGES = 10000
  await setup($, on)
  MESSAGES = 20000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const band = await mount($)
  for (const label of ['earlier', 'replies']) {
    if (!(await band.find({ type: 'Text', text: label }))) throw new Error('missing legend entry: ' + label)
  }
})

// Starts a session that began ageMs ago and runs one turn, then names the parts of Messages shown.
// Like a real session: a new one has no Messages yet when the mod first reads usage (the first message is not sent),
// while a resumed one, or one the mod loads into late, already has some.
async function firstTurn($: any, on: any, ageMs: number) {
  // setup's mocked clock starts at 0
  STARTED = -ageMs
  const isNew = ageMs < 60_000
  HAS_MESSAGES = !isNew
  MESSAGES = isNew ? 0 : 10000
  await setup($, on)
  HAS_MESSAGES = true
  MESSAGES += 20000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const band = await mount($)
  STARTED = undefined
  const shown = []
  for (const label of ['earlier', 'prompts', 'replies']) if (await band.find({ type: 'Text', text: label })) shown.push(label)
  return shown.join(',')
}

test('a new session splits its first turn into prompts and replies, with no earlier', async ($, on) => {
  const got = await firstTurn($, on, 5_000)
  if (got !== 'prompts,replies') throw new Error('expected prompts,replies, got ' + got)
})

test('a resumed session, or one the mod loads into late, calls what was there "earlier"', async ($, on) => {
  const got = await firstTurn($, on, 3_600_000)
  if (got !== 'earlier,prompts,replies') throw new Error('expected earlier,prompts,replies, got ' + got)
})
