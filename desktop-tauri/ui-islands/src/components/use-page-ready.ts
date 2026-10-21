import { useLayoutEffect } from 'react'

/** Publish committed page readiness without unmounting forms, tables or their drafts. */
export function usePageReady(page: string, ready: boolean) {
  useLayoutEffect(() => {
    const section = document.querySelector<HTMLElement>(`.page[data-page="${page}"]`) || document.querySelector<HTMLElement>(`.mobile-feature-host[data-page="${page}"]`)
    if (section) section.dataset.pageReady = String(ready)
  }, [page, ready])
}
