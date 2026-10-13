/** Resolve a visible drop index against the full queue, excluding the dragged group. */
export function moveQueueGroup<T extends { provider: string }>(
  all: readonly T[], displayed: readonly T[], provider: string, index: number,
): T[] {
  const moved = all.find(group => group.provider === provider)
  if (!moved) return [...all]
  const rest = all.filter(group => group.provider !== provider)
  const visibleRest = displayed.filter(group => group.provider !== provider)
  const slot = Math.max(0, Math.min(visibleRest.length, index))
  const anchor = visibleRest[slot]?.provider
  const at = anchor === undefined ? rest.length : rest.findIndex(group => group.provider === anchor)
  const to = at < 0 ? rest.length : at
  return [...rest.slice(0, to), moved, ...rest.slice(to)]
}
