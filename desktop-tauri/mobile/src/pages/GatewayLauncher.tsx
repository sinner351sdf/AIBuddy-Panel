import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Badge, Field, FieldLabel, FieldGroup, Input, Alert, AlertDescription } from '@ui'
import { nativeGateway, type GatewayBridge, type LocalGatewayStatus } from '../api/nativeGateway'
import { listServers, saveServer, removeServer, normalizeBase, type ServerEntry } from '../lib/servers'
import { usePolling } from '../lib/usePolling'
import { ThemeSync } from '../components/Shell'
import { Icon } from '../components/Icon'
import { confirmAction } from '../components/confirm'
import { t } from '../i18n'

/** Native launcher owns service selection only. Each selected gateway opens the dedicated mobile panel. */
export function GatewayLauncher({bridge=nativeGateway}:{bridge?:GatewayBridge}) {
  const [local,setLocal]=useState<LocalGatewayStatus>({running:false})
  const [servers,setServers]=useState<ServerEntry[]>(listServers)
  const [port,setPort]=useState('3065'),[name,setName]=useState(''),[address,setAddress]=useState('')
  const [busy,setBusy]=useState(''),[error,setError]=useState('')
  const refresh=async()=>{try {setLocal(await bridge.status())}catch(failure){setError(String(failure instanceof Error?failure.message:failure))}}
  usePolling(refresh,5000)
  useEffect(()=>{const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);return()=>window.removeEventListener('focus',onFocus)},[bridge])
  const run=async(key:string,action:()=>Promise<unknown>)=>{if(busy)return;setBusy(key);setError('');try{await action()}catch(failure){setError(failure instanceof Error?failure.message:String(failure))}finally{setBusy('')}}
  const start=()=>run('local',async()=>{
    const number=Number(port)
    if(!Number.isInteger(number)||number<1024||number>65535)throw new Error(t('端口需为 1024–65535 的整数'))
    setLocal(await bridge.start({port:number}))
  })
  const open=(url:string,label:string)=>run('open',()=>bridge.openDashboard({url,name:label}))
  const add=()=>{
    const base=normalizeBase(address)
    if(!base){setError(t('请输入正确的服务器地址'));return}
    saveServer({base,name});setServers(listServers());setAddress('');setName('');setError('')
  }
  return <div className='m-app'><ThemeSync/><main className='m-scroll'><div className='m-page flex flex-col gap-4 px-4 py-6'>
    <header><h1 className='m-0 text-2xl font-semibold'>AIBuddy Panel</h1><p className='mb-0 mt-2 text-sm text-muted-foreground'>{t('在手机运行网关，或连接已有的远程服务。')}</p></header>
    {error?<Alert variant='destructive'><AlertDescription>{error}</AlertDescription></Alert>:null}
    <Card><CardHeader><div className='flex items-center justify-between gap-2'><CardTitle>{t('本机网关')}</CardTitle><Badge variant={local.running?'success':'secondary'}>{local.running?t('运行中'):t('未启动')}</Badge></div><CardDescription>{t('账号与配置保存在这台手机，不需要电脑在线。')}</CardDescription></CardHeader>
    <CardContent><FieldGroup><Field><FieldLabel htmlFor='local-gateway-port'>{t('本机端口')}</FieldLabel><Input id='local-gateway-port' inputMode='numeric' value={port} onChange={e=>setPort(e.target.value)} disabled={local.running||Boolean(busy)} className='min-h-11 text-base'/></Field>{local.running&&local.base?<p className='m-0 break-all font-mono text-xs'>{local.base}/v1{local.version?` · v${local.version}`:''}</p>:null}<p className='m-0 text-xs leading-relaxed text-muted-foreground'>{t('首次打开需创建管理员和 API Key。服务在通知栏持续显示，可手动停止。')}</p></FieldGroup></CardContent>
    <CardFooter className='flex-wrap gap-2'>{local.running?<><Button className='min-h-11 flex-1' disabled={Boolean(busy)||!local.base} onClick={()=>local.base&&void open(local.base,t('本机网关'))}>{t('打开管理面板')}</Button><Button variant='outline' className='min-h-11' disabled={Boolean(busy)} onClick={()=>void run('stop',async()=>setLocal(await bridge.stop()))}>{t('停止')}</Button></>:<Button className='min-h-11 w-full' disabled={Boolean(busy)} onClick={()=>void start()}><Icon name='play' data-icon='inline-start'/>{busy==='local'?t('正在启动…'):t('启动本机网关')}</Button>}</CardFooter></Card>
    <Card><CardHeader><CardTitle>{t('远程服务')}</CardTitle><CardDescription>{t('可以保存多台服务器，每台使用各自的账号、配置和登录状态。')}</CardDescription></CardHeader><CardContent className='flex flex-col gap-3'>
    {servers.map(server=><div key={server.id} className='flex items-center gap-2'><Button variant='outline' className='h-auto min-h-14 min-w-0 flex-1 justify-start whitespace-normal py-2 text-left' disabled={Boolean(busy)} onClick={()=>void open(server.base,server.name||server.base)}><Icon name='server' data-icon='inline-start'/><span className='min-w-0'><span className='block truncate'>{server.name||server.base}</span>{server.name?<span className='block truncate text-xs text-muted-foreground'>{server.base}</span>:null}</span></Button><Button variant='ghost' size='icon-lg' aria-label={t('移除服务器')} disabled={Boolean(busy)} onClick={()=>void run('remove',async()=>{if(await confirmAction(t('移除这个连接记录？不会删除服务器上的数据。'))){removeServer(server.id);setServers(listServers())}})}><Icon name='trash' data-icon='inline-start'/></Button></div>)}
    <FieldGroup><Field><FieldLabel htmlFor='remote-gateway-address'>{t('服务器地址')}</FieldLabel><Input id='remote-gateway-address' value={address} onChange={e=>setAddress(e.target.value)} placeholder='192.168.1.50:3065' inputMode='url' autoCapitalize='off' autoCorrect='off' className='min-h-11 text-base'/></Field><Field><FieldLabel htmlFor='remote-gateway-name'>{t('备注名（可选）')}</FieldLabel><Input id='remote-gateway-name' value={name} onChange={e=>setName(e.target.value)} placeholder={t('例如：家里、公司')} className='min-h-11 text-base'/></Field></FieldGroup>
    </CardContent><CardFooter><Button variant='outline' className='min-h-11 w-full' disabled={Boolean(busy)||!address.trim()} onClick={add}>{t('保存远程连接')}</Button></CardFooter></Card>
    <p className='m-0 text-xs text-muted-foreground'>{t('按 Android 返回键可回到服务选择。')}</p><p className='m-0 pb-4 text-xs leading-relaxed text-muted-foreground'>{t('两种模式都打开同一套完整网页版，界面会自动适应手机屏幕。Android 本机模式不读取电脑上的客户端登录态。')}</p>
  </div></main></div>
}
