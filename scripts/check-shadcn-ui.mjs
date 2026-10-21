/** Guard the shared component contracts, including legacy shell entry points. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'desktop-tauri/ui-islands/package.json'))
const ts = require('typescript')
const sourceDir = path.join(root, 'desktop-tauri/ui-islands/src')
const issues = []
const nativeControls = new Set(['button', 'input', 'select', 'textarea'])
const htmlControls = /<\s*(?:button|input|select|textarea|dialog|nav)\b|\brole\s*=\s*["'](?:button|menu|menuitem|dialog|combobox|switch|checkbox|radio|tab|tablist)["']/i
const groupRules = new Map([
  ['SelectItem', { stop: ['Select', 'SelectContent'], expected: ['SelectGroup'] }],
  ['CommandItem', { stop: ['Command', 'CommandList', 'CommandDialog'], expected: ['CommandGroup'] }],
  ['DropdownMenuItem', { stop: ['DropdownMenu', 'DropdownMenuContent', 'DropdownMenuSubContent'], expected: ['DropdownMenuGroup'] }],
  ['DropdownMenuCheckboxItem', { stop: ['DropdownMenu', 'DropdownMenuContent', 'DropdownMenuSubContent'], expected: ['DropdownMenuGroup'] }],
  ['DropdownMenuRadioItem', { stop: ['DropdownMenu', 'DropdownMenuContent', 'DropdownMenuSubContent'], expected: ['DropdownMenuRadioGroup'] }],
  ['ContextMenuItem', { stop: ['ContextMenu', 'ContextMenuContent', 'ContextMenuSubContent'], expected: ['ContextMenuGroup'] }],
  ['TabsTrigger', { stop: ['Tabs'], expected: ['TabsList'] }],
])
let scanned = 0
let shellScanned = 0
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : [])
}
function walk(node, visitor) { visitor(node); ts.forEachChild(node, child => walk(child, visitor)) }
function parse(source, file, jsx = false) { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.JS) }
function reporter(ast, file, target = issues, lineOffset = 0) {
  return (node, code, rule) => target.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 + lineOffset, code, rule })
}
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}
function stringOf(node) {
  node = unwrap(node)
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
}
function attributeValue(attribute) {
  if (!attribute?.initializer) return attribute ? true : undefined
  const value = ts.isJsxExpression(attribute.initializer) ? unwrap(attribute.initializer.expression) : attribute.initializer
  if (value?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value?.kind === ts.SyntaxKind.FalseKeyword) return false
  return stringOf(value)
}
function isHiddenInput(node) {
  const attributes = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.text, a]))
  if (attributeValue(attributes.get('type')) === 'hidden' || attributeValue(attributes.get('hidden')) === true) return true
  // A hidden file picker is an integration endpoint; its visible action is a shared Button.
  if (attributeValue(attributes.get('type')) !== 'file') return false
  if (/(?:^|\s)hidden(?:\s|$)/.test(attributeValue(attributes.get('className')) || '')) return true
  const style = attributes.get('style')?.initializer
  const expression = style && ts.isJsxExpression(style) ? unwrap(style.expression) : null
  return Boolean(expression && ts.isObjectLiteralExpression(expression) && expression.properties.some(p => ts.isPropertyAssignment(p) &&
    ['display', 'visibility'].includes(p.name.getText()) && ['none', 'hidden'].includes(stringOf(p.initializer))))
}
function importNames(ast) {
  const shared = new Map(), namespaces = new Set(), reactCreators = new Set(), reactNamespaces = new Set()
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const module = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    const isShared = /^@(?:ui(?:\/|$)|agent2api\/ui(?:\/|$))/.test(module)
    if (isShared && bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) shared.set(item.name.text, item.propertyName?.text || item.name.text)
    if (isShared && bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (module === 'react') {
      if (statement.importClause?.name) reactNamespaces.add(statement.importClause.name.text)
      if (bindings && ts.isNamespaceImport(bindings)) reactNamespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if ((item.propertyName?.text || item.name.text) === 'createElement') reactCreators.add(item.name.text)
    }
  }
  const sharedName = tag => {
    if (ts.isIdentifier(tag)) return shared.get(tag.text)
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text)) return tag.name.text
  }
  return { sharedName, componentName: tag => sharedName(tag) || tag.getText(ast), reactCreators, reactNamespaces }
}
function renderOwner(node, names) {
  let element = ts.isJsxOpeningElement(node) ? node.parent : node
  let parent = element.parent
  while (parent) {
    if (ts.isParenthesizedExpression(parent) || ts.isConditionalExpression(parent) || (ts.isArrowFunction(parent) && parent.body === element)) {
      element = parent; parent = parent.parent
    } else if (ts.isReturnStatement(parent) && parent.expression === element) {
      element = functionOf(parent)
      parent = element?.parent
    } else break
  }
  if (!parent || !ts.isJsxExpression(parent) || !ts.isJsxAttribute(parent.parent) || parent.parent.name.text !== 'render') return null
  const owner = parent.parent.parent.parent
  return ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner) ? names.sharedName(owner.tagName) : null
}
function functionOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return parent
}
function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return stringOf(node.argumentExpression)
}
function isTemporaryClipboard(node, ast) {
  const fn = functionOf(node)
  if (!fn?.body || !ts.isVariableDeclaration(node.parent) || !ts.isIdentifier(node.parent.name)) return false
  const variable = node.parent.name.text
  let copy = false, select = false, remove = false
  walk(fn.body, child => {
    if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return
    const method = child.expression.name.text
    if (method === 'execCommand' && stringOf(child.arguments[0]) === 'copy') copy = true
    if (ts.isIdentifier(child.expression.expression) && child.expression.expression.text === variable) {
      if (method === 'select') select = true
      if (method === 'remove') remove = true
    }
  })
  // Require the actual offscreen/hidden temporary-node lifecycle, not a function-name allowlist.
  const offscreen = /(?:top|left)\s*:\s*-\d|display\s*:\s*none|opacity\s*:\s*0|\.hidden\s*=\s*true/.test(fn.body.getText(ast))
  return copy && select && remove && offscreen
}
function bundlePresence(expression) {
  expression = unwrap(expression)
  if (!expression) return null
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const child = bundlePresence(expression.operand)
    return child === null ? null : !child
  }
  // Only explicit component-renderer availability checks qualify as bundle fallbacks.
  const bridge = /\bwindow\.wb(?:Shell\w*|Legacy\w*|Toast|WindowControls|WebLoginButton|Preferences)\b/
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return bundlePresence(expression.left) === true && bundlePresence(expression.right) === true ? true : null
    }
    const equality = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(expression.operatorToken.kind)
    const inequality = [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(expression.operatorToken.kind)
    if ((equality || inequality) && ts.isTypeOfExpression(expression.left) && bridge.test(expression.left.expression.getText())) {
      const type = stringOf(expression.right)
      if (type === 'function' || type === 'object') return equality
      if (type === 'undefined') return inequality
    }
    return null
  }
  return bridge.test(expression.getText()) && (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression)) ? true : null
}
function isBundleFallback(node) {
  for (let parent = node.parent, child = node; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      const presence = bundlePresence(parent.expression)
      if ((parent.thenStatement === child && presence === false) || (parent.elseStatement === child && presence === true)) return true
    }
    if (ts.isConditionalExpression(parent)) {
      const presence = bundlePresence(parent.condition)
      if ((parent.whenTrue === child && presence === false) || (parent.whenFalse === child && presence === true)) return true
    }
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      const at = parent.statements.indexOf(child)
      for (const earlier of parent.statements.slice(0, Math.max(0, at))) {
        if (!ts.isIfStatement(earlier) || earlier.elseStatement || bundlePresence(earlier.expression) !== true) continue
        const last = ts.isBlock(earlier.thenStatement) ? earlier.thenStatement.statements.at(-1) : earlier.thenStatement
        if (last && (ts.isReturnStatement(last) || ts.isThrowStatement(last))) return true
      }
    }
  }
  return false
}
function checkDomGeneration(ast, report, names = importNames(ast), reactOwnedChildren = false) {
  const bindings = new Map(), factories = new Set()
  walk(ast, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer)
    const name = ts.isFunctionDeclaration(node) ? node.name?.text : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : undefined
    const fn = ts.isFunctionDeclaration(node) ? node : ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : undefined
    if (!name || !fn?.parameters[0] || !ts.isIdentifier(fn.parameters[0].name) || !fn.body) return
    const parameter = fn.parameters[0].name.text
    walk(fn.body, child => {
      if (ts.isCallExpression(child) && propertyName(child.expression) === 'createElement' && ts.isIdentifier(child.arguments[0]) && child.arguments[0].text === parameter) factories.add(name)
    })
  })
  function literalText(node, seen = new Set()) {
    if (!node) return ''
    if (ts.isIdentifier(node) && bindings.has(node.text) && !seen.has(node.text)) return literalText(bindings.get(node.text), new Set([...seen, node.text]))
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text
    const parts = []
    ts.forEachChild(node, child => { parts.push(literalText(child, seen)) })
    return parts.join('')
  }
  walk(ast, node => {
    if (isBundleFallback(node)) return
    if (ts.isCallExpression(node)) {
      const name = propertyName(node.expression)
      const factory = name === 'createElement' || (ts.isIdentifier(node.expression) && (factories.has(node.expression.text) || names.reactCreators.has(node.expression.text)))
      const tag = stringOf(node.arguments[0])
      if (factory && nativeControls.has(tag)) {
        if (tag === 'textarea' && isTemporaryClipboard(node, ast)) return
        if (renderOwner(node, names)) return
        report(node, 'dom-control', 'Render visible controls with the shared component instead of creating native DOM controls')
      }
      if (name === 'insertAdjacentHTML' && (reactOwnedChildren || htmlControls.test(literalText(node.arguments[1])))) report(node, 'legacy-html', 'Component controllers must not replace React-owned children or generate control markup with insertAdjacentHTML')
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind) && ['innerHTML', 'outerHTML'].includes(propertyName(node.left)) && (reactOwnedChildren || htmlControls.test(literalText(node.right)))) {
      report(node, 'legacy-html', 'Component controllers must not replace React-owned children or generate control markup with innerHTML / outerHTML')
    }
  })
}
function checkReact(source, file, target = issues) {
  const ast = parse(source, file, true), report = reporter(ast, file, target), names = importNames(ast)
  function within(node, stop, expected) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isJsxElement(parent)) continue
      const name = names.componentName(parent.openingElement.tagName)
      if (expected.includes(name)) return true
      if (stop.includes(name)) return false
    }
    return false
  }
  walk(ast, node => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
    const name = names.componentName(node.tagName)
    if (path.basename(file) === 'keys-page.tsx' && ['table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(name)) report(node, 'table-components', 'The migrated Key table must use shared Table components; colgroup metadata stays native')
    const grouping = groupRules.get(name)
    if (grouping && !within(node, grouping.stop, grouping.expected)) report(node, 'composition', `${name} must be inside ${grouping.expected.join(' / ')}`)
    if (['Input', 'Textarea'].includes(name) && within(node, [], ['InputGroup'])) report(node, 'input-group', 'InputGroup needs its own InputGroupInput / InputGroupTextarea')
    if (nativeControls.has(name) && !renderOwner(node, names) && !(name === 'input' && isHiddenInput(node)) && !isBundleFallback(node)) report(node, 'native-control', 'Use the shared shadcn component for a visible native control')
    for (const attribute of node.attributes.properties.filter(ts.isJsxAttribute)) {
      if (attribute.name.text !== 'className' || !attribute.initializer) continue
      const value = attribute.initializer
      if (ts.isJsxExpression(value) && value.expression && (ts.isConditionalExpression(value.expression) || ts.isTemplateExpression(value.expression) || ts.isBinaryExpression(value.expression))) report(attribute, 'class-composition', 'Use cn() for conditional classes')
      const text = value.getText(ast)
      if (/\bspace-[xy]-/.test(text)) report(attribute, 'spacing', 'Use flex/grid gap instead of space-x/y')
      if (/\bdark:(?:bg|text|border)-/.test(text)) report(attribute, 'colors', 'Use semantic color tokens')
      if (['DialogContent', 'PopoverContent', 'TooltipContent', 'AlertDialogContent'].includes(name) && /\bz-(?:\[|\d)/.test(text)) report(attribute, 'overlay-layer', 'Overlay layers belong in the shared component')
      if (['Button', 'InputGroupButton'].includes(name) && /\b(?:bg-(?:primary|destructive|surface)|text-(?:primary|destructive|muted|subtle|foreground)|font-(?:bold|semibold)|rounded-)/.test(text)) report(attribute, 'button-variant', 'Use a shared button variant for visual styling')
    }
  })
  checkDomGeneration(ast, report, names)
}
function checkHtml(source, file, requiredHosts, target = issues) {
  const tags = [], scripts = []
  // Skip comments and raw script/style text: examples and dictionary-loader strings are not static UI.
  const tokens = /<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<([a-z][\w-]*)\b([^>]*)>/gi
  let match
  while ((match = tokens.exec(source))) {
    if (match[1]) {
      if (match[1].toLowerCase() === 'script') scripts.push({ body: match[3], lineOffset: source.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length - 1 })
      continue
    }
    if (!match[4]) continue
    const attributes = new Map()
    for (const attribute of match[5].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
    tags.push({ tag: match[4].toLowerCase(), attributes, at: match.index })
  }
  for (const { tag, attributes, at } of tags) {
    const id = attributes.get('id'), classes = (attributes.get('class') || '').split(/\s+/)
    const hiddenInput = tag === 'input' && (attributes.get('type') === 'hidden' || attributes.has('hidden'))
    // This inert template is generated from the shared shadcn Button at build time.
    const loadingTemplateStart = source.indexOf('<template id="page-loading-error">')
    const loadingTemplateEnd = source.indexOf('</template>', loadingTemplateStart)
    const generatedLoadingRetry = tag === 'button' && attributes.get('data-slot') === 'button' && attributes.has('data-loading-retry') && loadingTemplateStart >= 0 && at > loadingTemplateStart && at < loadingTemplateEnd
    if (generatedLoadingRetry) continue

    if ((['button', 'input', 'select', 'textarea', 'option', 'nav', 'dialog', 'form'].includes(tag) && !hiddenInput) || id === 'nav' || id === 'login-theme-toggle' || classes.includes('nav-item') || ['button', 'menu', 'menuitem', 'tablist', 'combobox', 'dialog'].includes(attributes.get('role'))) {
      target.push({ file, line: source.slice(0, at).split('\n').length, code: 'static-control', rule: 'Static shell HTML must retain island hosts instead of restoring native navigation, theme or form controls' })
    }
  }
  for (const id of requiredHosts) if (tags.filter(node => node.attributes.get('id') === id).length !== 1) target.push({ file, line: 1, code: 'shell-host', rule: `Keep exactly one component host #${id}` })
  // Inline controllers must not bypass the same migration contract.
  for (const { body, lineOffset } of scripts) { const ast = parse(body, file); checkDomGeneration(ast, reporter(ast, file, target, lineOffset)) }
}

for (const file of files(sourceDir)) { scanned++; checkReact(fs.readFileSync(file, 'utf8'), file) }
for (const controller of ['js/prefs.js', 'js/user-menu.js', 'js/notify-center.js', 'js/shell.js', 'js/login-extras.js', 'js/tags-view.js', 'titlebar.js', 'web-login.js', 'tooltip.js']) {
  const file = path.join(root, `desktop-tauri/ui/${controller}`)
  const ast = parse(fs.readFileSync(file, 'utf8'), file)
  // web-login owns the state of React Buttons, including text/Spinner content.
  // Even a harmless-looking <span> or empty-string write would destroy those children.
  checkDomGeneration(ast, reporter(ast, file), undefined, controller === 'web-login.js'); shellScanned++
}
for (const [name, hosts] of [
  ['index', ['shell-sidebar-root', 'shell-sidebar-trigger-host', 'shell-breadcrumb', 'shell-window-controls', 'sidebar-user', 'topbar-status']],
  ['login', ['login-app', 'login-theme-toggle-host']],
]) {
  const file = path.join(root, `desktop-tauri/ui/${name}.html`)
  checkHtml(fs.readFileSync(file, 'utf8'), file, hosts); shellScanned++
}

if (process.argv.includes('--self-test')) {
  // Contract fixtures test meaningful accepted/rejected syntax without changing workspace sources.
  const reactFixture = source => { const found = []; checkReact(source, 'fixture.tsx', found); return found }
  assert.equal(reactFixture(`import { Badge as Tag, BreadcrumbLink } from '@ui'; const x=<><Tag render={<button/>}/><BreadcrumbLink render={<button/>}/><input type='hidden'/><input type='file' hidden/><input type='file' className='hidden'/><canvas/><panel-captcha/></>`).length, 0)
  assert.equal(reactFixture(`import { Badge } from '@ui'; const x=<><Badge render={props=><button {...props}/>}/><Badge render={function(props){return <button {...props}/>}}/></>`).length, 0)
  assert.equal(reactFixture(`const x=<><button>Save</button><input type='color'/><select/><textarea/></>`).filter(i => i.code === 'native-control').length, 4)
  assert.equal(reactFixture(`const x=<LocalWidget render={<button/>}/>`).filter(i => i.code === 'native-control').length, 1)
  assert.equal(reactFixture(`import * as UI from '@ui'; const x=<><UI.DropdownMenuContent><UI.DropdownMenuGroup><UI.DropdownMenuItem/></UI.DropdownMenuGroup></UI.DropdownMenuContent><UI.Tabs><UI.TabsList><UI.TabsTrigger/></UI.TabsList></UI.Tabs></>`).length, 0)
  assert.equal(reactFixture(`import { CommandItem, DropdownMenuItem, TabsTrigger } from '@ui'; const x=<><CommandItem/><DropdownMenuItem/><TabsTrigger/></>`).filter(i => i.code === 'composition').length, 3)
  const jsFixture = (source, reactOwnedChildren = false) => { const ast = parse(source, 'fixture.js'), found = []; checkDomGeneration(ast, reporter(ast, 'fixture.js', found), undefined, reactOwnedChildren); return found }
  assert.equal(jsFixture(`function el(tag){return document.createElement(tag)}; el('button'); menu.innerHTML='<button>Open</button>'; menu.insertAdjacentHTML('beforeend','<input>')`).length, 3)
  assert.equal(jsFixture(`const el=tag=>document.createElement(tag); el('button')`).filter(i => i.code === 'dom-control').length, 1)
  assert.equal(jsFixture(`function copy(){const ta=document.createElement('textarea');ta.style.cssText='position:fixed;top:-999px';ta.select();document.execCommand('copy');ta.remove()} const canvas=document.createElement('canvas');host.innerHTML='';host.textContent='plain';`).length, 0)
  assert.equal(jsFixture(`if (!window.wbShellAccount) { const fallback=document.createElement('button') }`).length, 0)
  assert.equal(jsFixture(`if (window.wbShellAccount) { document.createElement('button') }`).filter(i => i.code === 'dom-control').length, 1)
  assert.equal(jsFixture(`button.innerHTML='<span class="spinner"></span>Waiting'; button.innerHTML=''`, true).filter(i => i.code === 'legacy-html').length, 2)
  assert.equal(reactFixture(`const x=window.wbShellAccount ? <AccountIsland/> : <button>Bundle fallback</button>`).length, 0)
  const htmlFixture = source => { const found = []; checkHtml(source, 'fixture.html', ['host'], found); return found }
  assert.equal(htmlFixture(`<!-- <nav><button></button></nav> --><script>const example='<button>';document.write('<script src="dictionary.js"><\\/script>')</script><div id="host"></div>`).length, 0)
  assert.equal(htmlFixture(`<div id="host"></div><nav><button id="login-theme-toggle"></button></nav>`).filter(i => i.code === 'static-control').length, 2)
  assert.equal(htmlFixture(`<div></div>`).filter(i => i.code === 'shell-host').length, 1)
  assert.equal(htmlFixture(`<div id="host"></div><input type="hidden"/>`).length, 0)
  assert.equal(htmlFixture(`<div id="host"></div>\n<script>\ndocument.createElement('button')\n</script>`).find(i => i.code === 'dom-control').line, 3)
  const keyTableIssues = []
  checkReact('<table><thead><tr><th/></tr></thead><tbody><tr><td/></tr></tbody></table>', 'keys-page.tsx', keyTableIssues)
  assert.equal(keyTableIssues.filter(issue => issue.code === 'table-components').length, 7)
  console.log('PASS: component guard contract fixtures (render targets, hidden inputs, composition, legacy controls, clipboard, bundle fallback and static HTML)')
}
if (issues.length) {
  console.error(issues.map(issue => `${path.relative(root, issue.file)}:${issue.line}: ${issue.rule}`).join('\n'))
  process.exitCode = 1
} else console.log(`PASS: ${scanned} React island files + ${shellScanned} shell sources; shared controls, group/list composition, shell hosts, semantic styles and legacy DOM contracts`)
