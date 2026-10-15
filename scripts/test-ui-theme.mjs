import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Exercise the same helper used by both settings entry points, without a gateway.
const values = new Map()
const style = {
  setProperty: (name, value) => values.set(name, value),
  removeProperty: name => values.delete(name),
}
const context = { window: {}, document: { documentElement: { style } } }
runInNewContext(readFileSync(new URL('../desktop-tauri/ui/theme.js', import.meta.url), 'utf8'), context)
const apply = context.window.wbTheme.applyPrimaryColor

for (const [primary, foreground] of [
  ['#1d4ed8', 'oklch(0.985 0 0)'], // Deep blue needs light text, even in dark mode.
  ['#eab308', 'oklch(0.145 0 0)'], // Yellow needs dark text in either mode.
  ['#000000', 'oklch(0.985 0 0)'],
  ['#ffffff', 'oklch(0.145 0 0)'],
]) {
  apply(primary)
  assert.equal(values.get('--primary'), primary)
  assert.equal(values.get('--ui-primary'), primary)
  assert.equal(values.get('--primary-foreground'), foreground)
}

// A reset after custom color selection must let both themes regain their pairs.
apply('')
assert.equal(values.size, 0, 'Reset must remove every inline primary override')
console.log('PASS: shared primary colors, readable foregrounds, and reset cleanup')
