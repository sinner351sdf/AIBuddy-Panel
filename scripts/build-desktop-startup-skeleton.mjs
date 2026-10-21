// Pre-render genuine shared Skeleton/Card components into the static desktop entry.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)),islands=path.join(root,'desktop-tauri/ui-islands')
const require=createRequire(path.join(islands,'package.json')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-startup-skeleton-'))
try {
 const file=path.join(temp,'skeleton.cjs')
 require('esbuild').buildSync({stdin:{contents:`import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {DesktopStartupSkeleton,DesktopSidebarSkeleton,PageLoadingError} from './src/components/desktop-startup-skeleton';export function render(){return renderToStaticMarkup(createElement(DesktopStartupSkeleton))};export function renderSidebar(){return renderToStaticMarkup(createElement(DesktopSidebarSkeleton))};export function renderError(){return renderToStaticMarkup(createElement(PageLoadingError))}`,resolveDir:islands,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:file,define:{'process.env.NODE_ENV':'"production"'},alias:{'@ui':path.join(root,'desktop-tauri/ui-kit/src'),react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[path.join(islands,'node_modules'),path.join(root,'desktop-tauri/ui-kit/node_modules')],logLevel:'silent'})
 const markup=require(file).render(),entry=path.join(root,'desktop-tauri/ui/index.html'),previous=fs.readFileSync(entry,'utf8')
 const block='<!-- desktop-startup-skeleton:start -->\n'+markup+'\n<!-- desktop-startup-skeleton:end -->'
 let next=previous.includes('<!-- desktop-startup-skeleton:start -->')?previous.replace(/<!-- desktop-startup-skeleton:start -->[\s\S]*?<!-- desktop-startup-skeleton:end -->/,block):previous.replace('<main class="main">','<main class="main">\n'+block)
 const sidebarBlock='<!-- desktop-startup-sidebar:start -->\n'+require(file).renderSidebar()+'\n<!-- desktop-startup-sidebar:end -->'
 next=next.includes('<!-- desktop-startup-sidebar:start -->')?next.replace(/<!-- desktop-startup-sidebar:start -->[\s\S]*?<!-- desktop-startup-sidebar:end -->/,sidebarBlock):next.replace('<div class="shell shell-sidebar-07">','<div class="shell shell-sidebar-07">\n'+sidebarBlock)
 const errorBlock='<template id="page-loading-error">'+require(file).renderError()+'</template>'
 next=next.includes('<template id="page-loading-error">')?next.replace(/<template id="page-loading-error">[\s\S]*?<\/template>/,errorBlock):next.replace('</main>','</main>\n'+errorBlock)
 if(next!==previous)fs.writeFileSync(entry,next)
} finally {fs.rmSync(temp,{recursive:true,force:true})}
