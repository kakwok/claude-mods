// The Lens tab bar. It is drawn in a Client region so it sees the pointer: a click picks a tab,
// and dragging a tab along the bar moves it. What the person did goes to the hooks module by post.
// Hotkeys follow the order on screen: 1 is whichever tab is first.

const GAP = 3
const ACCENT = '#d97757'

// The columns each tab covers, [from, to), as a plain Button draws "1: Activity"
function spans(tabs) {
  let x = 0
  return tabs.map((t, i) => {
    const w = String(i + 1).length + 2 + t.label.length
    const s = { from: x, to: x + w }
    x += w + GAP
    return s
  })
}

function hit(tabs, x) {
  return spans(tabs).findIndex((s) => x >= s.from && x < s.to)
}

// Where a tab dropped at column x lands: the slot whose middle is closest
function slot(tabs, x) {
  const mids = spans(tabs).map((s) => (s.from + s.to) / 2)
  let best = 0
  mids.forEach((m, i) => {
    if (Math.abs(x - m) < Math.abs(x - mids[best])) best = i
  })
  return best
}

function moved(tabs, from, to) {
  const out = [...tabs]
  const [t] = out.splice(from, 1)
  out.splice(to, 0, t)
  return out
}

export default function Tabs(props, surface) {
  const { Box, Text, Button } = surface.elements
  const tabs = Array.isArray(props?.tabs) ? props.tabs : []
  const drag = surface.state?.drag

  surface.onPointer((ev) => {
    const d = surface.state?.drag
    if (ev.type === 'down' && ev.button === 'left') {
      const i = hit(tabs, ev.x)
      if (i >= 0) surface.setState({ drag: { id: tabs[i].id, from: i, to: i } })
    } else if (ev.type === 'move' && d && ev.button) {
      const to = slot(tabs, ev.x)
      if (to !== d.to) surface.setState({ drag: { ...d, to } })
    } else if (ev.type === 'up' && d) {
      surface.setState({ drag: undefined })
      if (d.to !== d.from) surface.post({ order: moved(tabs, d.from, d.to).map((t) => t.id), active: d.id })
      else surface.post({ select: d.id })
    }
  })

  // While dragging, the bar shows where the tab would land, the dragged one underlined
  if (drag && drag.to !== drag.from) {
    return Box({
      flexDirection: 'row',
      columnGap: GAP,
      children: moved(tabs, drag.from, drag.to).map((t, i) =>
        Text({
          key: 'drag-' + t.id,
          bold: t.id === drag.id,
          underline: t.id === drag.id,
          color: t.id === drag.id ? ACCENT : undefined,
          dimColor: t.id !== drag.id,
          children: [i + 1 + ': ' + t.label],
        }),
      ),
    })
  }

  return Box({
    flexDirection: 'row',
    columnGap: GAP,
    children: tabs.map((t, i) =>
      Button({
        key: 'tab-' + t.id,
        label: t.label,
        hotkey: String(i + 1),
        plain: true,
        dimColor: t.id !== props.active,
        onPress: () => surface.post({ select: t.id }),
      }),
    ),
  })
}
