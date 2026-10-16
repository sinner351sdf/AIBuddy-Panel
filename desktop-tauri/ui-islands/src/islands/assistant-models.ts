import { loadAssistantModels, type AssistantCatalog } from './assistant-state'
import { BOOLEAN_KEYS, capabilitiesOf, type Capabilities } from './model-capability'
export type AssistantModelOption = {
  id: string; group: string; providers: string[]; search: string[]
  capabilities: Capabilities; mixed: boolean; contextWindowVaries?: boolean
}
/** A public model ID can route to multiple providers. Only promise a capability
 * when every enabled route declares it; aliases inherit their target's metadata. */
export function assistantModelOptions(catalog: AssistantCatalog): AssistantModelOption[] {
  const enabled = (catalog.models || []).filter(row => row.enabled === true && row.provider && row.id)
  const byName = new Map<string, Record<string, unknown>[]>()
  const add = (name: string, row: Record<string, unknown>) => byName.set(name, [...(byName.get(name) || []), row])
  for (const row of enabled) add(String(row.id), row)
  for (const mapping of catalog.mappings || []) {
    if (mapping.enabled !== true || mapping.isDefault === true || !mapping.alias) continue
    for (const row of enabled.filter(row => row.provider === mapping.provider && row.id === mapping.target)) add(String(mapping.alias), row)
  }
  return [...byName].map(([id, routes]) => {
    const providers = [...new Set(routes.map(row => String(row.providerLabel || row.provider)))]
    const capabilities: Capabilities = {}; let mixed = false
    for (const key of BOOLEAN_KEYS) {
      const values = routes.map(row => capabilitiesOf(row)[key])
      if (values.every(value => value === true)) capabilities[key] = true
      else if (values.every(value => value === false)) capabilities[key] = false
      else if (values.some(value => value === true)) mixed = true
    }
    const windows = routes.map(row => capabilitiesOf(row).maxInputTokens)
    // Public names/aliases can route to any enabled provider. Never assume an unknown route's limit.
    if (windows.every((value): value is number => typeof value === 'number')) capabilities.maxInputTokens = Math.min(...windows)
    return { id, group: providers.join(' / '), providers, capabilities, mixed, contextWindowVaries: new Set(windows).size > 1, search: routes.flatMap(row => [String(row.name || ''), String(row.id), String(row.provider), String(row.providerLabel || '')]) }
  })
}
export async function loadAssistantModelOptions(): Promise<AssistantModelOption[]> {
  return assistantModelOptions(await loadAssistantModels())
}
