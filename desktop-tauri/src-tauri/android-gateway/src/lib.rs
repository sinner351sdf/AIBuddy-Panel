//! Android hosts the same gateway library as desktop/headless, in an isolated
//! foreground-service process. A restart starts a fresh process, so global
//! schedulers/database handles are never initialized twice in one process.
use std::{net::{IpAddr, Ipv4Addr}, path::Path, sync::Mutex};
use agent2api_server::server::{self, access, ServerState};

static SHUTDOWN: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::new(None);

pub fn start(home: &Path, ui: &Path, port: u16) -> Result<String, String> {
    if port == 0 { return Err("端口不能为 0".into()); }
    if !home.is_absolute() || !ui.is_absolute() || !ui.join("index.html").is_file() {
        return Err("本机网关的数据目录或内置网页不完整".into());
    }
    let mut running = SHUTDOWN.lock().map_err(|_| "网关状态锁不可用")?;
    if running.is_some() { return Ok(format!("http://127.0.0.1:{port}")); }
    server::probe_port(port).map_err(|e| e.message)?;
    std::fs::create_dir_all(home).map_err(|e| e.to_string())?;
    // Called once, before any Rust worker exists, in the :gateway process.
    std::env::set_var("AGENT2API_PROXY_HOME", home);
    std::env::set_var("HOME", home);
    std::env::set_var("TMPDIR", home.join("tmp"));
    std::fs::create_dir_all(home.join("tmp")).map_err(|e| e.to_string())?;
    let mut state = ServerState::bootstrap(port, IpAddr::V4(Ipv4Addr::LOCALHOST))?;
    state.set_ui_dir(ui.to_path_buf());
    access::set_panel_gate(true);
    access::set_v1_fail_closed(true);
    access::attach_db(state.db().cloned());
    access::load_refresh_tokens();
    access::load_access_tokens();
    *running = Some(server::start(&state).map_err(|e| e.message)?);
    Ok(format!("http://127.0.0.1:{port}"))
}

pub fn stop() -> Result<(), String> {
    if let Some(shutdown) = SHUTDOWN.lock().map_err(|_| "网关状态锁不可用")?.take() {
        let _ = shutdown.send(());
    }
    Ok(())
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::{JNIEnv, objects::{JClass, JString}, sys::jstring};
    fn reply(mut env: JNIEnv, value: Result<String, String>) -> jstring {
        let text = match value {
            Ok(base) => serde_json::json!({"ok":true,"base":base,"version":env!("CARGO_PKG_VERSION")}),
            Err(error) => serde_json::json!({"ok":false,"error":error}),
        }.to_string();
        match env.new_string(text) {
            Ok(value) => value.into_raw(),
            Err(_) => { let _ = env.throw_new("java/lang/IllegalStateException", "无法返回网关状态"); std::ptr::null_mut() }
        }
    }
    #[no_mangle]
    pub extern "system" fn Java_com_aibuddy_panel_mobile_GatewayNative_start(mut env: JNIEnv, _: JClass, home: JString, ui: JString, port: i32) -> jstring {
        let value = (|| {
            let home: String = env.get_string(&home).map_err(|e| e.to_string())?.into();
            let ui: String = env.get_string(&ui).map_err(|e| e.to_string())?.into();
            let port = u16::try_from(port).map_err(|_| "端口超出范围")?;
            start(Path::new(&home), Path::new(&ui), port)
        })();
        reply(env, value)
    }
    #[no_mangle]
    pub extern "system" fn Java_com_aibuddy_panel_mobile_GatewayNative_stop(env: JNIEnv, _: JClass) -> jstring {
        reply(env, stop().map(|_| String::new()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_missing_or_relative_ui_before_opening_a_database() {
        assert!(start(Path::new("relative"), Path::new("relative"), 3065).is_err());
        assert!(start(Path::new("/nonexistent"), Path::new("/nonexistent"), 3065).is_err());
        assert!(start(Path::new("/nonexistent"), Path::new("/nonexistent"), 0).is_err());
    }
    #[test]
    fn local_gateway_hosts_full_panel_and_keeps_api_authentication() {
        use std::{io::{BufRead, BufReader, Write}, net::{TcpListener, TcpStream}, time::{Duration, SystemTime, UNIX_EPOCH}};
        let root = std::env::temp_dir().join(format!("aibuddy-native-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let ui = root.join("ui");
        std::fs::create_dir_all(&ui).unwrap();
        std::fs::write(ui.join("index.html"), "<!doctype html><head></head><body>complete panel</body>").unwrap();
        std::fs::write(ui.join("login.html"), "<!doctype html><head></head><body>login</body>").unwrap();
        let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = reservation.local_addr().unwrap().port(); drop(reservation);
        start(&root.join("data"), &ui, port).unwrap();
        let request = |method: &str, path: &str| -> Result<String, std::io::Error> {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
            stream.set_read_timeout(Some(Duration::from_secs(5)))?;
            write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}")?;
            let mut status=String::new(); BufReader::new(stream).read_line(&mut status)?; Ok(status)
        };
        for _ in 0..50 { if request("GET", "/health").is_ok() { break; } std::thread::sleep(Duration::from_millis(20)); }
        assert!(request("GET", "/health").unwrap().contains("200"));
        assert!(request("GET", "/login").unwrap().contains("200"));
        assert!(request("GET", "/api/accounts").unwrap().contains("401"));
        assert!(request("POST", "/v1/chat/completions").unwrap().contains("503"));
        assert!(root.join("data").is_dir());
        stop().unwrap();
        for _ in 0..50 { if TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err() { break; } std::thread::sleep(Duration::from_millis(20)); }
        assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err());
        // Background store handles live until this test process exits, just as the Android :gateway process does.
    }

}
