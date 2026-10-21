// Version every desktop JS/CSS URL from its bytes, so new HTML cannot reuse stale bundles.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
export function stampDesktopAssets(directory) {
  const entry=path.join(directory,'index.html'),previous=fs.readFileSync(entry,'utf8')
  const next=previous.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*>/g,tag=>{
    const end=tag.indexOf('>')+1
    const opening=tag.slice(0,end).replace(/(src|href)="([a-zA-Z0-9_./-]+\.(?:js|css))(?:\?[^"#]*)?"/g,(_,attribute,asset)=>{
      const bytes=fs.readFileSync(path.join(directory,asset))
      const version=createHash('sha256').update(bytes).digest('hex').slice(0,12)
      return `${attribute}="${asset}?v=${version}"`
    })
    return opening+tag.slice(end)
  })
  if(next!==previous)fs.writeFileSync(entry,next)
  return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  stampDesktopAssets(fileURLToPath(new URL('../desktop-tauri/ui',import.meta.url)))
}
