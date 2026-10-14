import type { ClientModule } from 'claude-code'

const KEYS = ['up', 'down', 'x', 'h', 'p', 'y', 'n']
// The module function runs on each draw; subscribe each instance once or the listeners stack.
const subscribed = new WeakSet<object>()

const PaneKeys: ClientModule = (_props, surface) => {
  if (!subscribed.has(surface)) {
    subscribed.add(surface)
    surface.onKey(event => { if (KEYS.includes(event.key)) surface.post({ key: event.key }) })
  }
  const { Text } = surface.elements
  return <Text dimColor>keys: ↑↓ select · x kill · h hold · p pause · y/n confirm</Text>
}

export default PaneKeys
