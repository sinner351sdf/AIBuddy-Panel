import { registerPlugin } from '@capacitor/core'
export type LocalGatewayStatus = { running: boolean; base?: string; version?: string; error?: string }
export interface GatewayBridge {
  start(options: {port: number}): Promise<LocalGatewayStatus>
  stop(): Promise<LocalGatewayStatus>
  status(): Promise<LocalGatewayStatus>
  openDashboard(options: {url: string; name: string}): Promise<void>
}
export const nativeGateway = registerPlugin<GatewayBridge>('LocalGateway')
