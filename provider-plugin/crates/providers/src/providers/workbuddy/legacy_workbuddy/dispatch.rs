use super::*;
use agent2api_provider_sdk::PluginCtx;
use crate::errors::GatewayError;
fn text<'a>(p:&'a Value,k:&str)->&'a str{p.get(k).and_then(Value::as_str).unwrap_or("")}
fn arg<T:serde::de::DeserializeOwned>(p:&Value,k:&str)->Result<T,GatewayError>{serde_json::from_value(p.get(k).cloned().unwrap_or(Value::Null)).map_err(|e|GatewayError::bad_request(format!("参数 {k} 无效: {e}")))}
fn value<T:serde::Serialize>(v:T)->Result<Value,GatewayError>{serde_json::to_value(v).map_err(|e|GatewayError::new(format!("动作结果无法编码: {e}")))}
pub async fn dispatch(ctx:&PluginCtx,provider:&str,account:&str,action:&str,payload:&Value)->Result<Value,GatewayError>{
 if action.starts_with("aibuddy.task_execution."){task_execution::with_control(payload,dispatch_inner(ctx,provider,account,action,payload)).await}else{dispatch_inner(ctx,provider,account,action,payload).await}
}
async fn dispatch_inner(ctx:&PluginCtx,provider:&str,account:&str,action:&str,payload:&Value)->Result<Value,GatewayError>{
let record=crate::store::record(ctx,provider,account).await?; let session=super::super::session_of_record(&record,super::super::Region::from_provider_id(provider).unwrap_or(super::super::Region::Cn));
let service=billing::BillingService::new(session.clone());
let err=|e:billing::BillingError|e.to_gateway_error();
match action {
"aibuddy.raw"=>{
 let method=text(payload,"method"); let path=text(payload,"path");
 if !matches!(method,"GET"|"POST"|"PUT"|"DELETE"|"PATCH"|"HEAD") || !path.starts_with('/') || path.starts_with("//") || path.contains("://") {return Err(GatewayError::bad_request("无效的WorkBuddy内部请求"));}
 let endpoint=session.get("endpoint").and_then(Value::as_str).unwrap_or(crate::workbuddy_shared::endpoints::DEFAULT_ENDPOINT);
 let url=format!("{}{}{}",crate::workbuddy_shared::endpoints::normalize_endpoint(endpoint),path,text(payload,"query"));
 let headers=billing::request::growth_headers(&session,&[]);let proxy=crate::proxy_util::wire_proxy_from_json(session.get("proxy").unwrap_or(&Value::Null)).map_err(GatewayError::bad_request)?;
 let call=billing::request::raw_json_call(method,&url,payload.get("body"),&headers,proxy.as_ref()).await.map_err(err)?;value(call.data)
},
"aibuddy.growth.list_tasks"=>value(billing::growth::list_tasks(&service,&session).await.map_err(err)?),
"aibuddy.growth.list_tasks_mp"=>value(billing::growth::list_tasks_mp(&service,&session).await.map_err(err)?),
"aibuddy.growth.list_tasks_merged"=>value(billing::growth::list_tasks_merged(&service,&session).await.map_err(err)?),
"aibuddy.growth.task_by_code"=>value(billing::growth::task_by_code(&service,&session,text(payload,"code")).await.map_err(err)?),
"aibuddy.growth.accept_tasks"=>value(billing::growth::accept_tasks(&service,&session,&arg::<Vec<String>>(payload,"codes")?,arg::<bool>(payload,"mp")?).await.map_err(err)?),
"aibuddy.growth.accept_tasks_batched"=>value(billing::growth::accept_tasks_batched(&service,&session,&arg::<Vec<String>>(payload,"codes")?,arg::<bool>(payload,"mp")?).await.map_err(err)?),
"aibuddy.growth.accept_verified_task"=>value(billing::growth::accept_verified_task(&service,&session,text(payload,"code")).await.map_err(err)?),
"aibuddy.growth.claim_reward"=>value(billing::growth::claim_reward(&session,text(payload,"code"),arg::<bool>(payload,"mp")?).await.map_err(err)?),
"aibuddy.growth.task_by_code_waiting"=>value(billing::growth::task_by_code_waiting(&service,&session,text(payload,"code")).await.map_err(err)?),
"aibuddy.report.report_chat_activity"=>value(billing::report::report_chat_activity(&service,&session,text(payload,"conversation_id"),text(payload,"request_id"),text(payload,"model_id"),text(payload,"model_name")).await.map_err(err)?),
"aibuddy.report.report_desktop_events"=>value(billing::report::report_desktop_events(&session,arg::<Vec<Value>>(payload,"events")?).await.map_err(err)?),
"aibuddy.report.report_web_event"=>value(billing::report::report_web_event(&session,text(payload,"event_code"),text(payload,"page_url"),text(payload,"element_id"),text(payload,"element_name")).await.map_err(err)?),
"aibuddy.report.report_mp_events"=>value(billing::report::report_mp_events(&session,arg::<Vec<Value>>(payload,"events")?).await.map_err(err)?),
"aibuddy.report.set_appearance_theme"=>value(billing::report::set_appearance_theme(&session,text(payload,"resource_key")).await.map_err(err)?),
"aibuddy.streak.streak_full"=>value(billing::streak::streak_full(&service,&session).await.map_err(err)?),
"aibuddy.streak.redeem_tier"=>value(billing::streak::redeem_tier(&service,&session,text(payload,"tier")).await.map_err(err)?),
"aibuddy.streak.lottery_chances"=>value(billing::streak::lottery_chances(&service,&session).await.map_err(err)?),
"aibuddy.streak.lottery_draw"=>value(billing::streak::lottery_draw(&service,&session).await.map_err(err)?),
"aibuddy.streak.heatmap_yesterday_missed"=>value(billing::streak::heatmap_yesterday_missed(&service,&session).await.map_err(err)?),
"aibuddy.streak.use_makeup_card"=>value(billing::streak::use_makeup_card(&service,&session,text(payload,"date")).await.map_err(err)?),
"aibuddy.streak.streak_bonus_account"=>value(billing::streak::streak_bonus_account(&service,&session).await),
"aibuddy.streak.streak_bonus_with_policy"=>value(billing::streak::streak_bonus_with_policy(&service,&session,arg::<bool>(payload,"spend")?).await),
"aibuddy.streak.active_today"=>value(billing::streak::active_today(&service,&session).await.map_err(err)?),
"aibuddy.travel.buddy_info"=>value(billing::travel::buddy_info(&service,&session).await.map_err(err)?),
"aibuddy.travel.buddy_agreement"=>value(billing::travel::buddy_agreement(&service,&session).await.map_err(err)?),
"aibuddy.travel.buddy_first"=>value(billing::travel::buddy_first(&service,&session).await.map_err(err)?),
"aibuddy.travel.travel_status"=>value(billing::travel::travel_status(&service,&session).await.map_err(err)?),
"aibuddy.travel.travel_depart"=>value(billing::travel::travel_depart(&service,&session).await.map_err(err)?),
"aibuddy.travel.travel_claim"=>value(billing::travel::travel_claim(&service,&session,arg::<i64>(payload,"record_id")?).await.map_err(err)?),
"aibuddy.travel.travel_claim_known"=>value(billing::travel::travel_claim_known(&service,&session,arg::<i64>(payload,"record_id")?).await.map_err(err)?),
"aibuddy.travel.travel_account_once"=>value(billing::travel::travel_account_once(&service,&session,text(payload,"uid")).await),
"aibuddy.gift.compensation_status"=>value(billing::gift::compensation_status(&service,&session).await.map_err(err)?),
"aibuddy.gift.claim_compensation"=>value(billing::gift::claim_compensation(&service,&session).await.map_err(err)?),
"aibuddy.gift.claim_gift"=>value(billing::gift::claim_gift(&service,&session,arg::<billing::gift::GiftKind>(payload,"kind")?).await.map_err(err)?),
"aibuddy.trial.claim_trial"=>value(billing::trial::claim_trial(&service,&session).await.map_err(err)?),
"aibuddy.expert.market_expert_list"=>value(billing::expert::market_expert_list(&service,&session,text(payload,"expert_type")).await.map_err(err)?),
"aibuddy.task_execution.execute_refreshed" | "aibuddy.task_execution.execute" => {
let code=text(payload,"code"); let mode=text(payload,"mode"); let mut result=task_execution::execute(&service,&session,code,mode).await;
if action.ends_with("execute_refreshed") && result.outcome=="failed" && (result.message.contains("登录态已过期")||result.message.contains("401")) {
let provider_impl=super::super::WorkBuddyProvider::new(super::super::Region::from_provider_id(provider).unwrap_or(super::super::Region::Cn));
if provider_impl.refresh_account(ctx,account,&record,&session).await.is_ok(){let fresh=crate::store::record(ctx,provider,account).await?;let fresh=super::super::session_of_record(&fresh,provider_impl.region);result=task_execution::execute(&service,&fresh,code,mode).await;}else{result=ResultRow::new("failed","凭证刷新失败，请重新登录账号");}
} value(result)},
"aibuddy.task_execution.travel_run"=>value(task_execution::travel_run(&service,&session).await),
"aibuddy.task_execution.activity_run"=>value(task_execution::activity_run(&service,&session).await),
"aibuddy.task_execution.rewards_run"=>value(task_execution::rewards_run(&service,&session).await),
"aibuddy.growth_actions.run_action"=>{let task=arg(payload,"task")?;value(growth_actions::run_action(&service,&session,text(payload,"code"),&task).await.map_err(err)?)},
_=>Err(GatewayError::with_status(501,format!("未知AIBuddy兼容动作 {action}"))),
}}