// Validate downloaded release assets before any GitHub mutation. Node 18+, no dependencies.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export function linuxRequired(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(tag)
  if (!match) throw new Error(`版本标签格式无效：${tag}`)
  const [, major, minor, patch] = match.map((value, index) => index ? Number(value) : value)
  return major > 3 || (major === 3 && (minor > 0 || patch >= 4))
}

export function linuxDesktopRequired(tag) {
  linuxRequired(tag)
  const [major, minor, patch] = tag.slice(1).split(/[.\-+]/).slice(0, 3).map(Number)
  return major > 3 || (major === 3 && (minor > 0 || patch >= 8))
}

export function windowsServerRequired(tag) {
  linuxRequired(tag)
  const [major, minor] = tag.slice(1).split(/[.\-+]/).slice(0, 2).map(Number)
  return major > 3 || (major === 3 && minor >= 1)
}

export function isPrereleaseTag(tag) {
  return /(?:-|\.)(?:alpha|beta|rc)(?:[.\-]|$)/i.test(tag)
}

export function validateRun(run, artifacts, sha, tag, repo) {
  if (run.head_sha !== sha || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('构建未成功完成或提交与 tag 不一致')
  if (!['.github/workflows/build.yml', '.github/workflows/publish-release.yml'].includes(run.path)) throw new Error('构建工作流来源不匹配')
  if (run.repository?.full_name !== repo) throw new Error('构建仓库来源不匹配')
  const names = ['windows-nsis', 'macos-universal', ...(linuxDesktopRequired(tag) ? ['linux-desktop'] : []), ...(linuxRequired(tag) ? ['linux-server-amd64', 'linux-server-arm64'] : []), ...(windowsServerRequired(tag) ? ['windows-server-amd64'] : [])]
  for (const name of names) {
    const matches = artifacts.artifacts?.filter(item => item.name === name && !item.expired && item.size_in_bytes > 0) || []
    if (matches.length !== 1) throw new Error(`缺少或重复构建附件：${name}`)
    if (matches[0].workflow_run?.head_sha !== sha) throw new Error(`附件提交不匹配：${name}`)
  }
}

export function collectAssets(directory, tag) {
  const assets = []
  const one = (subdir, extension) => {
    const folder = path.join(directory, subdir)
    const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => name.endsWith(extension)) : []
    if (files.length !== 1) throw new Error(`${subdir} 需要且只能有一个 ${extension} 安装包`)
    const file = path.join(folder, files[0]); requireFile(file); return file
  }
  const requireFile = file => {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.size === 0) throw new Error(`附件不是非空普通文件：${file}`)
  }
  assets.push(one('windows-nsis', '.exe'), one('macos-universal', '.dmg'))
  if (linuxDesktopRequired(tag)) {
    // upload-artifact preserves the common bundle root (deb/ and appimage/).
    for (const [folder, ext] of [['deb', '.deb'], ['appimage', '.AppImage']]) {
      const nested = path.join('linux-desktop', folder)
      assets.push(one(fs.existsSync(path.join(directory, nested)) ? nested : 'linux-desktop', ext))
    }
  }
  const arches = ['amd64', 'arm64']
  const hasLinux = arches.some(arch => fs.existsSync(path.join(directory, `linux-server-${arch}`)))
  if (linuxRequired(tag) || hasLinux) {
    for (const arch of arches) {
      const name = `agent2api-server-linux-${arch}.tar.gz`
      const file = path.join(directory, `linux-server-${arch}`, name)
      const checksum = `${file}.sha256`
      requireFile(file); requireFile(checksum)
      const match = /^([a-f\d]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(fs.readFileSync(checksum, 'utf8'))
      if (!match || match[2] !== name || hash(file) !== match[1].toLowerCase()) throw new Error(`SHA256 校验失败：${name}`)
      assets.push(file, checksum)
    }
  }
  if (windowsServerRequired(tag) || fs.existsSync(path.join(directory, 'windows-server-amd64'))) {
    const name = 'agent2api-server-windows-amd64.zip'
    const file = path.join(directory, 'windows-server-amd64', name)
    const checksum = `${file}.sha256`
    requireFile(file); requireFile(checksum)
    const match = /^([a-f\d]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(fs.readFileSync(checksum, 'utf8'))
    if (!match || match[2] !== name || hash(file) !== match[1].toLowerCase()) throw new Error(`SHA256 校验失败：${name}`)
    assets.push(file, checksum)
  }
  const sums = path.join(directory, 'SHA256SUMS.txt')
  fs.writeFileSync(sums, assets.filter(file => !file.endsWith('.sha256')).map(file => `${hash(file)}  ${path.basename(file)}\n`).join(''))
  return [...assets, sums]
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'run') validateRun(JSON.parse(fs.readFileSync(args[0])), JSON.parse(fs.readFileSync(args[1])), ...args.slice(2))
    else if (command === 'assets') process.stdout.write(collectAssets(...args).join('\0') + '\0')
    else throw new Error('未知校验命令')
  } catch (error) { console.error(`错误: ${error.message}`); process.exitCode = 1 }
}
