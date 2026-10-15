import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@ui'

type Snapshot = {
  parent: string
  current: string
  parentPage: string
}

function navigationSnapshot(): Snapshot & { parentItem: HTMLElement | null } {
  const active = document.querySelector<HTMLElement>('#nav .nav-item.active')
  const group = active?.closest<HTMLElement>('.nav-group')
  const parentItem = group?.querySelector<HTMLElement>('.nav-item[data-page]') ?? null
  return {
    parent: group?.querySelector('.nav-group-toggle .nav-group-title')?.textContent?.trim() ?? '',
    current: active?.querySelector('.label')?.textContent?.trim()
      || document.getElementById('crumb-page')?.textContent?.trim()
      || '',
    parentPage: parentItem?.dataset.page ?? '',
    parentItem,
  }
}

function openParent(): void {
  const { parentPage, parentItem } = navigationSnapshot()
  const app = (window as unknown as { wbApp?: { showPage?: (page: string) => void } }).wbApp
  if (parentPage && typeof app?.showPage === 'function') app.showPage(parentPage)
  else parentItem?.click()
}

function ShellBreadcrumb() {
  const [snapshot, setSnapshot] = React.useState<Snapshot>(navigationSnapshot)

  React.useEffect(() => {
    let disposed = false
    let queued = false
    const synchronize = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (disposed) return
        const next = navigationSnapshot()
        setSnapshot(previous => previous.parent === next.parent
          && previous.current === next.current
          && previous.parentPage === next.parentPage ? previous : next)
      })
    }
    const observer = new MutationObserver(synchronize)
    const marker = document.getElementById('crumb-page')
    const nav = document.getElementById('shell-sidebar-root') || document.getElementById('nav')
    if (marker) observer.observe(marker, { childList: true, characterData: true, subtree: true })
    if (nav) observer.observe(nav, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-page'],
    })
    synchronize()
    return () => { disposed = true; observer.disconnect() }
  }, [])

  if (!snapshot.current) return null
  return (
    <Breadcrumb aria-label='面包屑'>
      <BreadcrumbList>
        {snapshot.parent ? (
          <>
            <BreadcrumbItem className='hidden md:block'>
              <BreadcrumbLink render={<button type='button' />} onClick={openParent}>
                {snapshot.parent}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className='hidden md:block' />
          </>
        ) : null}
        <BreadcrumbItem>
          <BreadcrumbPage>{snapshot.current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function mount(): void {
  const host = document.getElementById('shell-breadcrumb')
  if (host) createRoot(host).render(<ShellBreadcrumb />)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
