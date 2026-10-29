pub mod billing; pub mod growth_actions; pub mod task_execution; mod growth_chat;
use serde_json::{json,Value};
#[derive(Clone,Debug,serde::Serialize)] pub struct ResultRow {pub outcome:&'static str,pub message:String,pub credit:Option<i64>,pub energy:Option<i64>}
impl ResultRow {pub fn new(outcome:&'static str,message:impl Into<String>)->Self {Self{outcome,message:message.into(),credit:None,energy:None}} pub fn reward(mut self,c:i64,e:i64)->Self{self.credit=Some(c);self.energy=Some(e);self} pub fn json(&self)->Value{json!(self)}}
pub mod dispatch;
