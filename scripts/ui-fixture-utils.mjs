// Load the real shared class-name utility for VM-rendered component fixtures.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const islandsRequire = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const uiRequire = createRequire(new URL('../desktop-tauri/ui-kit/package.json', import.meta.url))
const ts = islandsRequire('typescript')
const source = readFileSync(new URL('../desktop-tauri/ui-kit/src/lib/cn.ts', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: uiRequire })
export const cn = exports.cn
