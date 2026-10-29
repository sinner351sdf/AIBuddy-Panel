use agent2api_provider_sdk::{ctx::CallGateway,PluginCtx,StoreError};
use agent2api_provider_protocol::HostEnv;
use serde_json::Value;
pub fn fixture_ctx()->PluginCtx {PluginCtx::from_gateway(HostEnv{host_version:"fixture".into(),data_dir:std::env::temp_dir().join("aibuddy-plugin-fixtures").to_string_lossy().into(),target:"fixture".into(),proxy:String::new(),debug_traffic:false,loopback_port:0},std::sync::Arc::new(Fixture))}
struct Fixture;
impl CallGateway for Fixture {fn call<'a>(&'a self,_:&'a str,_:Value)->std::pin::Pin<Box<dyn std::future::Future<Output=Result<Value,StoreError>>+Send+'a>>{Box::pin(async{Err(StoreError::Rejected("fixture has no account database".into()))})}}
