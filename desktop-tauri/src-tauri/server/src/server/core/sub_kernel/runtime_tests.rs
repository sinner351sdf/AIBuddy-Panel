use super::*;

fn fixtures(node: &str, ports: [u16; 2]) -> (Vec<ProviderInput>, Vec<NodeTarget>) {
    let providers: Vec<_> = ["a", "b"]
        .into_iter()
        .map(|id| ProviderInput {
            id: id.into(),
            name: id.into(),
            url: "https://example.invalid/sub".into(),
        })
        .collect();
    let targets = providers
        .iter()
        .zip(ports)
        .map(|(provider, port)| NodeTarget {
            provider_id: provider.id.clone(),
            sub_name: provider.name.clone(),
            node: node.into(),
            port: Some(port),
        })
        .collect();
    (providers, targets)
}

#[test]
fn listeners_use_exact_provider_scoped_definitions() {
    let node = "🇯🇵 日本 [S01].+ | IEPL (x2)";
    let (providers, targets) = fixtures(node, [19101, 19102]);
    let config: Value =
        serde_yaml::from_str(&build_config(&providers, 19090, "fixture", &targets, &test_definitions(&targets, &[12341, 12342])).unwrap())
            .unwrap();
    assert_ne!(
        config["listeners"][0]["proxy"],
        config["listeners"][1]["proxy"]
    );
    for (index, provider) in providers.iter().enumerate() {
        let definition = &config["proxies"][index];
        assert_eq!(config["listeners"][index]["proxy"], definition["name"]);
        assert_eq!(definition["name"], node_alias(&provider.id, node));
        assert_eq!(definition["port"], 12341 + index);
    }
    let (_, mut with_missing) = fixtures(node, [19101, 19102]);
    with_missing.push(NodeTarget { provider_id: "a".into(), sub_name: "a".into(), node: "missing".into(), port: Some(19103) });
    let safe: Value = serde_yaml::from_str(&build_config(&providers, 19090, "fixture", &with_missing, &test_definitions(&targets, &[12341, 12342])).unwrap()).unwrap();
    assert_eq!(safe["listeners"].as_array().unwrap().len(), 2, "unknown nodes must not fall back to direct");

}

/// 使用指定的已安装 mihomo，只连接本地 HTTP 出站夹具；不下载或访问真实订阅。
#[tokio::test]
#[ignore = "requires AGENT2API_TEST_MIHOMO pointing to an installed official kernel"]
async fn real_kernel_routes_same_named_nodes_to_their_own_provider() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let binary = std::env::var("AGENT2API_TEST_MIHOMO").expect("set official kernel path");
    let dir = std::env::temp_dir().join(format!("a2api-sub-routing-{}", random_secret()));
    std::fs::create_dir_all(dir.join("providers")).unwrap();
    let _cleanup = Cleanup(dir.clone());
    let mut upstream_ports = Vec::new();
    let mut upstream_tasks = Vec::new();
    async fn read_header(stream: &mut tokio::net::TcpStream) -> Vec<u8> {
        let mut header = Vec::new();
        while header.len() < 8192 && !header.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                break;
            }
            header.push(byte[0]);
        }
        header
    }
    for body in ["provider-a", "provider-b"] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        upstream_ports.push(listener.local_addr().unwrap().port());
        upstream_tasks.push(tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let request = read_header(&mut stream).await;
                if request.starts_with(b"CONNECT ") {
                    let _ = stream
                        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                        .await;
                    let _ = read_header(&mut stream).await;
                }
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
            }
        }));
    }
    // 持有三个临时端口以避免分配阶段重复，启动子进程前才释放。
    let reserved: Vec<_> = (0..4)
        .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
        .collect();
    let ports: Vec<_> = reserved
        .iter()
        .map(|l| l.local_addr().unwrap().port())
        .collect();
    let node = "🇯🇵 日本 [S01].+ | IEPL (x2)";
    let (providers, mut targets) = fixtures(node, [ports[1], ports[2]]);
    targets.push(NodeTarget {
        provider_id: "a".into(),
        sub_name: "a".into(),
        node: "missing-node".into(),
        port: Some(ports[3]),
    });
    let mut config: Value = serde_yaml::from_str(
        &build_config(&providers, ports[0], "fixture-secret", &targets, &test_definitions(&targets[..2], &upstream_ports)).unwrap(),
    )
    .unwrap();
    config["log-level"] = json!("debug");
    for (index, provider) in providers.iter().enumerate() {
        let key = format!("sub_{}", provider.id);
        config["proxy-providers"][&key] = json!({
            "type": "file", "path": format!("providers/{key}.yaml"),
        });
        let content = json!({"proxies": [
            {"name": node, "type": "http", "server": "127.0.0.1", "port": upstream_ports[index]},
            {"name": format!("{node} backup"), "type": "http", "server": "127.0.0.1", "port": 1}
        ]});
        std::fs::write(
            dir.join(format!("providers/{key}.yaml")),
            serde_yaml::to_string(&content).unwrap(),
        )
        .unwrap();
    }
    std::fs::write(
        dir.join("config.yaml"),
        serde_yaml::to_string(&config).unwrap(),
    )
    .unwrap();
    drop(reserved);
    let mut child = tokio::process::Command::new(binary)
        .arg("-d")
        .arg(&dir)
        .arg("-f")
        .arg(dir.join("config.yaml"))
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if controller_get(ports[0], "fixture-secret", "/version")
            .await
            .is_some()
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "controller not ready"
        );
        assert!(child.try_wait().unwrap().is_none(), "kernel exited");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let registry = controller_get(ports[0], "fixture-secret", "/proxies")
        .await
        .unwrap();
    assert_eq!(config["listeners"].as_array().unwrap().len(), 2);
    for (index, expected) in ["provider-a", "provider-b"].into_iter().enumerate() {
        let alias = config["listeners"][index]["proxy"].as_str().unwrap();
        assert_eq!(registry["proxies"][alias]["name"], alias);
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::http(format!("http://127.0.0.1:{}", ports[index + 1])).unwrap())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let response = client.get("http://127.0.0.1:9/test").send().await.unwrap();
        assert!(
            response.status().is_success(),
            "proxy response: {}",
            response.status()
        );
        let body = response.text().await.unwrap();
        assert_eq!(body, expected, "listener routed to the wrong provider");
    }
    child.kill().await.unwrap();
    for task in upstream_tasks {
        task.abort();
    }
}

fn test_definitions(targets: &[NodeTarget], ports: &[u16]) -> HashMap<String, Value> {
    targets.iter().zip(ports).map(|(target, port)| (node_key(&target.provider_id, &target.node),
      json!({"name":target.node,"type":"http","server":"127.0.0.1","port":port}))).collect()
}
