import { mock, test } from 'claude-code/testing'

// Messages is opened up by source: explore, actions, replies, prompts as one block, every category under a short name, the smallest folded only when the legend would pass two lines, never Messages/compact/free.

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
const mount = ($: any, bodyColumns = 120) =>
  $.ui.mount({ plugin: 'context-bar', component: 'AbovePrompt', requestId: 'band-' + mounts++, surface: 'terminal', viewport: { columns: bodyColumns + 20, rows: 40 }, props: { bodyColumns, hasSurvey: false } } as any)

test('exploration shows as its own part of Messages, and every category shows under a short name when there is room', async ($, on) => {
  await setup($, on)
  MESSAGES = 10000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  await $.tool.call({ tool: 'Read', tool_use_id: 't1', file_path: '/x' } as any)
  MESSAGES = 30000
  await $.turn.complete({ answer: 'b', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const band = await mount($)
  for (const label of ['messages', 'explore', 'replies', 'earlier', 'compact', 'free', 'sys prompt', 'tools', 'skills', 'mcp', 'memory']) {
    if (!(await band.find({ type: 'Text', text: label }))) throw new Error('missing legend entry: ' + label)
  }
  if (await band.find({ type: 'Text', text: 'other' })) throw new Error('nothing should fold when the legend fits in two lines')
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

test('on a narrow terminal the smallest categories fold into other, and come back when it widens', async ($, on) => {
  // Same Messages before and after the turn, so Messages is one plain row and the fit depends only on the categories
  MESSAGES = 10000
  await setup($, on)
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const has = async (label: string, cols: number) => Boolean(await (await mount($, cols)).find({ type: 'Text', text: label }))

  // 60 columns cannot hold every entry in two lines: mcp (1.7k, the smallest) goes first, Messages never folds
  if (await has('mcp', 60)) throw new Error('mcp should fold on a narrow terminal')
  if (!(await has('other', 60))) throw new Error('expected an other row on a narrow terminal')
  if (!(await has('messages', 60))) throw new Error('Messages should never fold')
  if (!(await has('memory', 60))) throw new Error('the biggest category (memory, 12.1k) should stay')

  if (!(await has('mcp', 120))) throw new Error('mcp should come back on a wide terminal')
  if (await has('other', 120)) throw new Error('nothing should fold on a wide terminal')
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

test('a part under 1k shows as a whole number, not a float from scaling', async ($, on) => {
  // replies is 252 of 10010, and (252 / 10010) * 10010 is 252.00000000000003
  MESSAGES = 9758
  await setup($, on)
  MESSAGES = 10010
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: { ...U, output_tokens: 252 }, reason: 'answer' } as any)
  const band = await mount($)
  if (!(await band.find({ type: 'Text', text: 'replies' }))) throw new Error('missing legend entry: replies')
  if (await band.find({ type: 'Text', text: /\d\.\d{3,}/ })) throw new Error('a token count shows as an unrounded float')
  if (!(await band.find({ type: 'Text', text: '252' }))) throw new Error('expected replies as 252')
})
