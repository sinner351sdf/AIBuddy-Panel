import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ui'
import { t } from '../i18n'

function LoginThemeToggle() {
  const readDark = () => document.documentElement.getAttribute('data-theme') === 'dark'
  const [dark, setDark] = React.useState(readDark)
  React.useEffect(() => {
    const observer = new MutationObserver(() => setDark(readDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  const label = dark ? t('切换到浅色') : t('切换到深色')
  function toggle() {
    const theme = readDark() ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', theme)
    setDark(theme === 'dark')
    try {
      const prefs = JSON.parse(localStorage.getItem('aibuddy-prefs') || '{}')
      prefs.theme = theme
      localStorage.setItem('aibuddy-prefs', JSON.stringify(prefs))
      localStorage.setItem('workbuddy-desktop-theme', theme)
    } catch { /* Theme switching remains available when storage is blocked. */ }
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={
          <Button id='login-theme-toggle' variant='outline' size='icon-lg'
            className='fixed top-4 right-[18px] z-50' aria-label={label} onClick={toggle} />
        }>
          <svg data-icon='inline-start' viewBox='0 0 24 24' fill='none' stroke='currentColor'
            strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
            {dark ? (
              <><circle cx='12' cy='12' r='4' /><path d='M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5' /></>
            ) : <path d='M20.9 13a9 9 0 1 1-9.9-9.9A7 7 0 0 0 20.9 13Z' />}
          </svg>
        </TooltipTrigger>
        <TooltipContent side='left'>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function mount() {
  const host = document.getElementById('login-theme-toggle-host')
  if (host) createRoot(host).render(<LoginThemeToggle />)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
else mount()
