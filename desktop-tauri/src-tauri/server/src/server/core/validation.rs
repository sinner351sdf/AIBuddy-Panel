//! Network boundary for isolated acceptance. Normal service traffic is unchanged.
//!
//! Every active host HTTP transport calls `send_guarded`. Validation accepts only
//! HTTP(S) loopback, pins localhost to 127.0.0.1, ignores all proxies, and never
//! follows redirects. Request bodies, timeouts and fixture headers are preserved.

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

pub fn enabled() -> bool {
    std::env::var("AIBUDDY_VALIDATION_MODE").ok().as_deref() == Some("1")
}

pub fn assert_url(raw: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw).map_err(|_| "隔离验收拒绝非法网络地址".to_string())?;
    let loopback = match parsed.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    if loopback && matches!(parsed.scheme(), "http" | "https")
        && parsed.username().is_empty() && parsed.password().is_none()
    {
        Ok(())
    } else {
        Err("隔离验收拒绝非本地出网、代理和 URL 凭据".to_string())
    }
}

pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve("localhost", SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
}

pub trait ValidatedRequest {
    fn send_guarded(self) -> impl Future<Output = Result<reqwest::Response, reqwest::Error>> + Send;
}

impl ValidatedRequest for reqwest::RequestBuilder {
    fn send_guarded(self) -> impl Future<Output = Result<reqwest::Response, reqwest::Error>> + Send {
        async move {
            if enabled() { send_isolated(self).await } else { self.send().await }
        }
    }
}

async fn send_isolated(builder: reqwest::RequestBuilder) -> Result<reqwest::Response, reqwest::Error> {
    let (original, request) = builder.build_split();
    let request = request?;
    if let Err(reason) = assert_url(request.url().as_str()) {
        crate::server::logging::verbose("[Validation]", &reason);
        // Keep the existing reqwest::Error contract. This deliberately invalid
        // URL yields a builder error before a socket or DNS request can occur.
        return original.get("http://[aibuddy-validation-denied]").send().await;
    }
    client_builder().build()?.execute(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

    #[test]
    fn accepts_only_unambiguous_loopback_http_urls() {
        for raw in ["http://127.0.0.1:3165/", "http://127.1.2.3/", "http://[::1]:3165/", "https://localhost/a"] {
            assert!(assert_url(raw).is_ok(), "{raw}");
        }
        for raw in ["https://api.github.com/", "http://127.0.0.1.evil.invalid/", "http://localhost./", "http://10.0.0.1/", "file:///tmp/a", "ftp://127.0.0.1/", "http://user:secret@localhost/", "not a URL"] {
            assert!(assert_url(raw).is_err(), "{raw}");
        }
    }

    #[tokio::test]
    async fn refuses_public_hosts_and_ip_literals_before_connecting() {
        for raw in ["https://example.invalid/", "http://192.0.2.1:9/", "http://[2001:db8::1]:9/"] {
            let result = send_isolated(reqwest::Client::new().get(raw)).await;
            assert!(result.unwrap_err().is_builder(), "{raw}");
        }
    }

    #[tokio::test]
    async fn isolates_proxy_redirect_and_preserves_request_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let hit = Arc::new(AtomicUsize::new(0));
        let server_hit = hit.clone();
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(std::time::Duration::from_secs(3))).unwrap();
            let mut bytes = Vec::new();
            while !bytes.ends_with(b"fixture-body") {
                let mut chunk = [0; 4096];
                let n = socket.read(&mut chunk).unwrap();
                assert!(n > 0 && bytes.len() + n <= 8192);
                bytes.extend_from_slice(&chunk[..n]);
            }
            let received = String::from_utf8_lossy(&bytes);
            assert!(received.starts_with("POST /fixture "));
            assert!(received.ends_with("fixture-body"));
            server_hit.fetch_add(1, Ordering::SeqCst);
            socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1:9/must-not-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let proxy = reqwest::Proxy::all("http://192.0.2.1:9").unwrap();
        let original = reqwest::Client::builder().proxy(proxy).build().unwrap();
        let response = send_isolated(original.post(format!("http://localhost:{port}/fixture"))
            .body("fixture-body").timeout(std::time::Duration::from_secs(3))).await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        assert_eq!(hit.load(Ordering::SeqCst), 1);
        worker.join().unwrap();
    }
}
