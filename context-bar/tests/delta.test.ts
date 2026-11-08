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
  test('a ' + label + ' turn is colored under the duration line, not in the band', async ($, on) => {
    mock.clock(on)
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', () => ({ value: undefined }))
    on('session.usage', usage)
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['✻ Baked for 3s'] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
    TOKENS = 80000
    await $.turn.complete({ answer: 'hi', durationMs: 2000, usage: U, reason: 'answer' } as any)
    TOKENS = 80000 + grow
    const r = (await $.turn.complete({ answer: 'hi', durationMs: 3000, usage: U, reason: 'answer' } as any)) as any
    if (r.text !== 'hi') throw new Error('the answer was rewritten: ' + r.text)
    const band = await $.ui.mount({ plugin: 'context-bar', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 140, rows: 40 }, props: { bodyColumns: 120, hasSurvey: false } } as any)
    if (await band.find({ type: 'Text', text: /^▲ \+/ })) throw new Error('the band still shows the delta')
    const line = await $.ui.mount({ plugin: 'context-bar', component: 'TurnDuration', requestId: 'turn-2', surface: 'terminal', viewport: { columns: 140, rows: 40 }, props: { word: 'Baked', durationMs: 3010 } } as any)
    const el = (await line.find({ type: 'Text', text: /^▲ \+/ })) as any
    const rest = (await line.find({ type: 'Text', text: /context last turn/ })) as any
    console.log('line: ' + el?.children?.join('') + ' ' + rest?.children?.join('') + ' in ' + el?.props.color)
    if (el?.props.color !== color) throw new Error('expected ' + color)
  })
}

for (const [model, color] of [['claude-opus-5-5', '#a78bfa'], ['claude-sonnet-5-5', '#4ade80'], ['claude-haiku-5-5', '#38bdf8'], ['claude-fable-5-1', '#f472b6']] as const) {
  test('the model name and frame share the ' + model + ' family color', async ($, on) => {
    mock.clock(on)
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', () => ({ value: undefined }))
    on('session.usage', () => {
      const u = usage()
      return { value: { ...u.value, context: { ...u.value.context, breakdown: { ...u.value.context.breakdown, model } } } }
    })
    on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })
    const band = await $.ui.mount({ plugin: 'context-bar', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', viewport: { columns: 140, rows: 40 }, props: { bodyColumns: 120, hasSurvey: false } } as any)
    const name = (await band.find({ type: 'Text', text: model })) as any
    const frame = (await band.find({ key: 'frame' })) as any
    console.log(model + ': name ' + name?.props.color + ', frame ' + frame?.props.borderColor)
    if (name?.props.color !== color || frame?.props.borderColor !== color) throw new Error('expected ' + color)
  })
}
