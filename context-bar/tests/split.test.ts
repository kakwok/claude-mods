import { mock, test } from 'claude-code/testing'

// Messages is opened up by source: explore, actions, replies, prompts as one block, small rows folded, never Messages/compact/free.

let MESSAGES = 10000
let MCP = 1700
const usage = () => ({
  value: {
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
          { name: 'Messages', tokens: MESSAGES, kind: 'used' },
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
  console.log('legend ok')
})

test('a compacted window starts the split over as one summary row', async ($, on) => {
  await setup($, on)
  MESSAGES = 60000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)
  MESSAGES = 8000
  await $.turn.complete({ answer: 'b', durationMs: 1000, usage: U, reason: 'answer' } as any)
  const band = await mount($)
  if (await band.find({ type: 'Text', text: 'explore' })) throw new Error('old split survived a compaction')
  if (!(await band.find({ type: 'Text', text: 'earlier' }))) throw new Error('expected a single lump row after a compaction')
})

test('a folded category comes back when it grows past 3% of the window, and folds again when it shrinks', async ($, on) => {
  await setup($, on)
  MESSAGES = 10000
  await $.turn.complete({ answer: 'a', durationMs: 1000, usage: U, reason: 'answer' } as any)

  // Memory files at 12.1k is already shown; use MCP tools (1.7k, under the 6k cutoff on a 200k window) as the one that moves
  const has = async (label: string) => Boolean(await (await mount($)).find({ type: 'Text', text: label }))
  if (await has('mcp tools')) throw new Error('mcp tools at 1.7k should be folded')

  MCP = 9000
  await $.turn.complete({ answer: 'x', durationMs: 1000, usage: U, reason: 'answer' } as any)
  if (!(await has('mcp tools'))) throw new Error('mcp tools at 9k (4.5% of the window) should reappear')

  MCP = 1700
  await $.turn.complete({ answer: 'x', durationMs: 1000, usage: U, reason: 'answer' } as any)
  if (await has('mcp tools')) throw new Error('mcp tools should fold again after shrinking')
})
