import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
function Icon({ children, ...props }: IconProps) {
  return <svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' data-icon='inline-start' {...props}>{children}</svg>
}
export function SunIcon(props: IconProps) { return <Icon {...props}><circle cx='12' cy='12' r='4' /><path d='M12 2.5v2m0 15v2M4.6 4.6l1.4 1.4m12 12 1.4 1.4M2.5 12h2m15 0h2M4.6 19.4l1.4-1.4m12-12 1.4-1.4' /></Icon> }
export function MoonIcon(props: IconProps) { return <Icon {...props}><path d='M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' /></Icon> }
export function MonitorIcon(props: IconProps) { return <Icon {...props}><rect x='2.5' y='4' width='19' height='12.5' rx='2' /><path d='M9 20.5h6M12 16.5v4' /></Icon> }
export function SearchIcon(props: IconProps) { return <Icon {...props}><circle cx='11' cy='11' r='7' /><path d='m20 20-3.5-3.5' /></Icon> }
export function SettingsIcon(props: IconProps) { return <Icon {...props}><circle cx='12' cy='12' r='3' /><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' /></Icon> }
export function LinkIcon(props: IconProps) { return <Icon {...props}><path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' /></Icon> }
export function CloseIcon(props: IconProps) { return <Icon {...props}><path d='m6 6 12 12M6 18 18 6' /></Icon> }
export function CheckIcon(props: IconProps) { return <Icon {...props}><path d='m4.5 12.5 5 5 10-11' /></Icon> }
export function ChevronRightIcon(props: IconProps) { return <Icon {...props}><path d='m9 5 7 7-7 7' /></Icon> }

/** 布局缩略图是内容示意，控件交互由 ToggleGroupItem 提供。 */
export function LayoutPreview({ kind }: { kind: string }) {
  const block = (x: number, y: number, width: number, height: number, opacity: number) => <rect x={x} y={y} width={width} height={height} rx='1.8' fill='currentColor' opacity={opacity} />
  return <svg viewBox='0 0 48 34' className='pref-layout-preview' aria-hidden='true'>
    {kind === 'vertical' ? <>{block(2, 2, 11, 30, .5)}{block(16, 2, 30, 9, .26)}{block(16, 14, 30, 18, .12)}</> : null}
    {kind === 'classic' ? <>{block(2, 2, 44, 8, .26)}{block(2, 13, 11, 19, .5)}{block(16, 13, 30, 19, .12)}</> : null}
    {kind === 'horizontal' ? <>{block(2, 2, 44, 11, .35)}{block(2, 16, 44, 16, .12)}</> : null}
    {kind === 'mix' ? <>{block(2, 2, 44, 8, .26)}{block(2, 13, 9, 19, .5)}{block(14, 13, 32, 19, .12)}</> : null}
  </svg>
}
