import { mock, test } from 'claude-code/testing'

let TOKENS = 80000
const usage = () => ({
  value: {
    context: {
      tokens: TOKENS,
      window: 200000,
      breakdown: {
        model: 'claude-opus-5-5',
        totalTokens: TOKENS,
        rawMaxTokens: 200000,
        percentage: (TOKENS / 200000) * 100,
        categories: [
          { name: 'Messages', tokens: TOKENS, kind: 'used' },
          { name: 'Free space', tokens: 200000 - TOKENS, kind: 'free' },
        ],
      },
    },
    rateLimits: [],
  },
})

const U = { input_tokens: 10, cache_read_input_tokens: 990, cache_creation_input_tokens: 0, output_tokens: 456 }

for (const [label, grow, color] of [['small', 1100, '#4f8bf0'], ['medium', 7000, '#e3b341'], ['large', 25000, '#e5534b']] as const) {
  test('a ' + label + ' turn leads the line and is colored in the band', async ($, on) => {
    mock.clock(on)
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', () => ({ value: undefined }))
    on('session.usage', usage)
    on('turn.complete', (_: any, e: any) => ({ text: e.text ?? '' }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
    TOKENS = 80000
    await $.turn.complete({ text: '', usage: U, reason: 'answered' } as any)
    TOKENS = 80000 + grow
    const r = (await $.turn.complete({ text: '', usage: U, reason: 'answered' } as any)) as any
    console.log('line: ' + r.text)
    if (!r.text.startsWith('▲ +')) throw new Error('the line does not lead with the context cost')
    const ui = await $.ui.mount({ plugin: 'context-bar', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 140, rows: 40 }, props: { bodyColumns: 120, hasSurvey: false } } as any)
    const el = (await ui.find({ type: 'Text', text: /^▲ \+/ })) as any
    console.log('band: ' + el?.children?.join('') + ' in ' + el?.props.color)
    if (el?.props.color !== color) throw new Error('expected ' + color)
  })
}
