#!/usr/bin/env python3
"""Synthetic HTTP replay for the isolated 127.0.0.1:3165 gateway.

Explicit --execute is required. Never invoke against 3065 or real providers.
The demo-only pack is temporary, signed with the supplied validation fixture key,
and the original signed main pack is reinstalled in finally. Only the two exact
account IDs created by this run may be patched/deleted. Existing account rows,
credentials, rules, histories and tasks are read-only verification inputs.

Normal /v1 traffic adds fixture request/audit rows and derived daily/key counters.
Those changes are reported explicitly; this is not a whole-database byte check.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

BASE = "http://127.0.0.1:3165"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOME = Path("/private/tmp/aibuddy-validation-20261025")
DEFAULT_PACK = ROOT / "provider-plugin/target/development-v2/dist/aibuddy-providers-0.2.2-aibuddy.dev.1-aarch64-apple-darwin.zip"
PACK_ID = "aibuddy-providers"
TEXT = "AIBuddy fixture protocol replay"
IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII="
PROTECTED_TABLES = (
    "accounts", "assistant_conversations", "account_history", "checkin_records",
    "account_usage_records", "task_runs", "task_run_items", "task_steps",
    "requests", "request_raw", "debug_traffic",
)
# These runtime-owned fields legitimately change while processing synthetic /v1
# requests or an admin cookie login. All other pre-existing KV entries are checked.
DERIVED_KV = {
    "lastRequestModel", "keyQuotaUsage", "logsNextId", "panelTokens",
    "panelAccessSessions", "panelAltchaSecret", "modelCatalogCache",
    "backgroundTaskState", "requestStatsCursor",
}


class ReplayFailure(RuntimeError):
    """Contains a stage name only, never an HTTP body or credential."""


def require(condition, stage):
    if not condition:
        raise ReplayFailure(stage)


def canonical(value):
    if isinstance(value, bytes):
        return {"bytesSha256": hashlib.sha256(value).hexdigest()}
    if isinstance(value, (tuple, list)):
        return [canonical(v) for v in value]
    return value


def fingerprint(value):
    raw = json.dumps(canonical(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def provider_flags(pack):
    """The status API returns provider rows; older fixtures used an ID map."""
    value = (pack or {}).get("providers", [])
    if isinstance(value, dict):
        return {identifier: bool(enabled) for identifier, enabled in value.items()}
    require(isinstance(value, list), "unexpected installed provider settings schema")
    require(all(isinstance(row, dict) and isinstance(row.get("id"), str)
                and isinstance(row.get("enabled"), bool) for row in value),
            "unexpected installed provider settings row")
    return {row["id"]: row["enabled"] for row in value}


class Gateway:
    def __init__(self, credentials):
        self.credentials = credentials
        self.jar = http.cookiejar.CookieJar()
        self.admin = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))
        # Inference never inherits the administrator cookie.
        self.inference = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(self, path, method="GET", body=None, *, inference=False,
                headers=None, raw=False, timeout=90):
        require(path.startswith("/") and not path.startswith("//"), "unsafe gateway path")
        request_headers = dict(headers or {})
        if isinstance(body, bytes):
            data = body
            request_headers.setdefault("Content-Type", "application/zip")
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            request_headers.setdefault("Content-Type", "application/json")
        else:
            data = None
        if inference:
            request_headers["Authorization"] = "Bearer " + self.credentials["restrictedKey"]
        request = urllib.request.Request(BASE + path, data=data, method=method, headers=request_headers)
        opener = self.inference if inference else self.admin
        try:
            with opener.open(request, timeout=timeout) as response:
                content = response.read(8 * 1024 * 1024 + 1)
                require(len(content) <= 8 * 1024 * 1024, "gateway reply exceeded fixture bound")
                result = content if raw else json.loads(content)
                return response.status, result, dict(response.headers)
        except urllib.error.HTTPError as error:
            # Do not expose response bodies; upstream diagnostics may contain input.
            error.read(1024)
            return error.code, b"" if raw else {}, dict(error.headers)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            raise ReplayFailure("gateway transport/JSON failure (" + type(error).__name__ + ")") from None

    def management(self, path, method="GET", body=None):
        status, result, _ = self.request(path, method, body)
        require(status == 200 and isinstance(result, dict) and result.get("success") is True,
                "management operation failed: " + method + " " + path.split("?")[0])
        return result.get("data")

    def login(self):
        self.management("/api/panel/login", "POST", {
            "username": self.credentials["username"], "password": self.credentials["password"]})
        require(any(self.jar), "admin cookie was not issued")

    def install(self, content):
        result = self.management("/api/plugins/install", "POST", content)
        require(isinstance(result, dict) and not result.get("hostError"), "plugin install/handshake failed")
        return result

    def provider_ids(self):
        snapshot = self.management("/api/plugins")
        host = (snapshot or {}).get("host") or {}
        require(host.get("running") is True, "plugin process is not running")
        ids = []
        for provider in host.get("providers", []):
            value = provider if isinstance(provider, str) else provider.get("id")
            require(isinstance(value, str), "unexpected provider status schema")
            ids.append(value)
        return set(ids)


class DatabaseProof:
    def __init__(self, home):
        self.path = home / "agent2api.db"
        self.key = home / "account.key"
        self.key_digest = hashlib.sha256(self.key.read_bytes()).hexdigest()
        self.before = self.snapshot()
        accounts = self.before["tables"].get("accounts", {})
        self.old_account_ids = {row[0] for row in accounts.values()}
        self.old_priorities = {int(row[2]) for row in accounts.values()}
        self.original_order = self.account_order()

    def connect(self):
        connection = sqlite3.connect("file:" + urllib.parse.quote(str(self.path)) + "?mode=ro", uri=True)
        connection.execute("PRAGMA query_only=ON")
        return connection

    def snapshot(self):
        with self.connect() as connection:
            names = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            tables = {}
            for name in PROTECTED_TABLES:
                if name in names:
                    rows = connection.execute('SELECT rowid,* FROM "' + name + '"').fetchall()
                    tables[name] = {row[0]: (tuple(row[1:]) if name == "accounts" else fingerprint(tuple(row[1:]))) for row in rows}
            kv = dict(connection.execute("SELECT key,value FROM kv"))
            daily = connection.execute('SELECT * FROM request_daily').fetchall() if "request_daily" in names else []
            columns = [r[1] for r in connection.execute('PRAGMA table_info("request_daily")')]
            audit = {row[0]: fingerprint(tuple(row[1:]))
                     for row in connection.execute("SELECT rowid,* FROM logs")} if "logs" in names else {}
            return {"tables": tables, "kv": kv, "daily": daily, "dailyColumns": columns,
                    "audit": audit,
                    "schema": connection.execute("PRAGMA user_version").fetchone()[0]}

    def persist_before(self, destination):
        """Private, recoverable SQLite backup before the first management action.

        Recovery is intentionally a coordinator action. This verifier never
        rewrites old account rows to make its own assertions pass.
        """
        descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)
            rows = {row[0]: tuple(row[1:]) for row in target.execute("SELECT rowid,* FROM accounts")}
        require(rows == self.before["tables"]["accounts"], "account snapshot changed before fixture actions")
        key_path = destination.parent / "account.key"
        descriptor = os.open(key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(self.key.read_bytes())
        return {"database": str(destination), "accountKey": str(key_path),
                "databaseSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                "oldAccountRowsSha256": fingerprint(sorted(rows.items())),
                "automaticBusinessRowRestoration": False}

    def accounts(self):
        with self.connect() as connection:
            return {row[0]: tuple(row[1:]) for row in connection.execute("SELECT rowid,* FROM accounts")}

    def account_order(self):
        with self.connect() as connection:
            return [row[0] for row in connection.execute("SELECT id FROM accounts ORDER BY priority,added_at,id")]

    def assert_old_accounts(self, stage):
        current = self.accounts()
        previous = self.before["tables"].get("accounts", {})
        require(all(current.get(row_id) == row for row_id, row in previous.items()),
                stage + ": existing account data/credential/priority changed")
        current_order = [identifier for identifier in self.account_order() if identifier in self.old_account_ids]
        require(current_order == self.original_order, stage + ": existing account order changed")

    @staticmethod
    def quota_total(value):
        try:
            entries = json.loads(value or "{}")
            return sum(int(row.get("usedTokens", 0)) for row in entries.values() if isinstance(row, dict))
        except (ValueError, TypeError, AttributeError):
            return None

    @staticmethod
    def api_keys_proof(before, after):
        """Compare every key field, allowing only JSON encoding differences.

        The server can rewrite the existing API-key JSON compactly while
        validating an inference key. No permissions or usage fields are ignored.
        A later key metadata feature must receive its own explicit comparison;
        adding the entire apiKeys entry to DERIVED_KV would weaken this proof.
        """
        try:
            left, right = json.loads(before), json.loads(after)
            equal = left == right
            return {"normalizedJsonEqual": equal,
                    "beforeKeyCount": len(left) if isinstance(left, list) else None,
                    "afterKeyCount": len(right) if isinstance(right, list) else None,
                    "rawEncodingChanged": before != after,
                    "allKeyIdentityPermissionProviderQuotaEnabledFieldsCompared": True,
                    "accessMetadataDeltas": [],
                    "beforeRawSha256": hashlib.sha256(before.encode()).hexdigest(),
                    "afterRawSha256": hashlib.sha256(after.encode()).hexdigest(),
                    "beforeNormalizedSha256": fingerprint(left),
                    "afterNormalizedSha256": fingerprint(right)}
        except (ValueError, TypeError):
            return {"normalizedJsonEqual": before == after,
                    "rawEncodingChanged": before != after,
                    "allKeyIdentityPermissionProviderQuotaEnabledFieldsCompared": False}

    def finish(self, owned_ids):
        after = self.snapshot()
        proofs = {}
        for name, original in self.before["tables"].items():
            current = after["tables"].get(name, {})
            missing = sum(row_id not in current for row_id in original)
            changed = sum(row_id in current and current[row_id] != row for row_id, row in original.items())
            proofs[name] = {"beforeRows": len(original), "afterRows": len(current),
                            "oldRowsMissing": missing, "oldRowsModified": changed,
                            "newRows": len(set(current) - set(original))}
        protected_kv = {key: value for key, value in self.before["kv"].items()
                        if key not in DERIVED_KV and not key.startswith("plugin.")}
        keys_proof = self.api_keys_proof(self.before["kv"].get("apiKeys"), after["kv"].get("apiKeys"))
        kv_changes = [key for key, value in protected_kv.items()
                      if after["kv"].get(key) != value and
                      not (key == "apiKeys" and keys_proof["normalizedJsonEqual"])]
        account_ids = {row[0] for row in after["tables"].get("accounts", {}).values()}
        counters = {}
        for field in ("requests", "successful", "tokens", "cache_hit_tokens", "cache_input_tokens"):
            if field in after["dailyColumns"] and field in self.before["dailyColumns"]:
                before_index = self.before["dailyColumns"].index(field)
                after_index = after["dailyColumns"].index(field)
                counters[field + "Delta"] = (sum(int(row[after_index] or 0) for row in after["daily"]) -
                                               sum(int(row[before_index] or 0) for row in self.before["daily"]))
        before_dates = {row[0]: fingerprint(row) for row in self.before["daily"]}
        after_dates = {row[0]: fingerprint(row) for row in after["daily"]}
        before_quota = self.quota_total(self.before["kv"].get("keyQuotaUsage"))
        after_quota = self.quota_total(after["kv"].get("keyQuotaUsage"))
        old_audit, new_audit = self.before["audit"], after["audit"]
        missing_audit = sorted(set(old_audit) - set(new_audit))
        retained_audit = sorted(set(old_audit) & set(new_audit))
        audit_modified = sum(new_audit.get(row_id) != old_audit[row_id] for row_id in retained_audit)
        # Runtime logs have a fixed retention limit. Fixture admin operations
        # append rows and can evict the oldest logs; report this separately from
        # protected conversations, tasks, request history and account history.
        audit = {"beforeRows": len(old_audit), "afterRows": len(new_audit),
                 "oldRowsEvicted": len(missing_audit), "oldRowsModified": audit_modified,
                 "newRowsRetained": len(set(new_audit) - set(old_audit)),
                 "onlyOldestRowsEvicted": not missing_audit or not retained_audit or max(missing_audit) < min(retained_audit)}
        derived = {"requestDaily": {"beforeRows": len(before_dates), "afterRows": len(after_dates),
                                    "modifiedExistingRows": sum(after_dates.get(k) != v for k, v in before_dates.items()),
                                    **counters},
                   "lastRequestModelChanged": self.before["kv"].get("lastRequestModel") != after["kv"].get("lastRequestModel"),
                   "keyQuotaUsedTokensDelta": None if before_quota is None or after_quota is None else after_quota - before_quota,
                   "rollingAuditLog": audit,
                   "runtimeKvChanged": sorted(key for key in DERIVED_KV if self.before["kv"].get(key) != after["kv"].get(key))}
        result = {"schemaBefore": self.before["schema"], "schemaAfter": after["schema"],
                  "originalAccountCount": len(self.old_account_ids), "finalAccountCount": len(account_ids),
                  "accountKeyUnchanged": hashlib.sha256(self.key.read_bytes()).hexdigest() == self.key_digest,
                  "originalAccountOrderUnchanged": [x for x in self.account_order() if x in self.old_account_ids] == self.original_order,
                  "ownedFixtureAccountsRemoved": not (account_ids & set(owned_ids)),
                  "protectedKvChanged": kv_changes, "apiKeysProof": keys_proof,
                  "tableProofs": proofs, "derivedFixtureStatistics": derived}
        result["protectedDataUnchanged"] = (not kv_changes and result["accountKeyUnchanged"] and
            result["originalAccountOrderUnchanged"] and result["ownedFixtureAccountsRemoved"] and
            audit_modified == 0 and audit["onlyOldestRowsEvicted"] and
            self.before["schema"] == after["schema"] == 17 and
            all(row["oldRowsMissing"] == 0 and row["oldRowsModified"] == 0 for row in proofs.values()))
        return result


class ReplayState:
    def __init__(self):
        self.lock = threading.Lock()
        self.accounts = {}
        self.records = []

    def capture(self, account, body):
        messages = body.get("messages", [])
        tools = [m for m in messages if m.get("role") == "tool"]
        images = []
        calls = []
        for message in messages:
            calls.extend(message.get("tool_calls") or [])
            content = message.get("content")
            if isinstance(content, list):
                images.extend(p for p in content if p.get("type") == "image_url")
        row = {"fixtureAccount": self.accounts.get(account), "streamRequested": bool(body.get("stream")),
               "messageCount": len(messages), "toolResults": len(tools), "toolCalls": len(calls),
               "dataImages": sum(str((p.get("image_url") or {}).get("url", "")).startswith("data:image/") for p in images),
               "toolHistoryIntact": any(m.get("tool_call_id") == "fixture_tool_1" for m in tools) and
                                    any(c.get("id") == "fixture_tool_1" for c in calls)}
        with self.lock:
            self.records.append(row)
        return row


def replay_server(state):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def do_POST(self):
            size = int(self.headers.get("Content-Length", "0"))
            if self.path != "/v1/chat/completions" or size < 0 or size > 2 * 1024 * 1024:
                self.send_error(400)
                return
            try:
                body = json.loads(self.rfile.read(size))
            except (ValueError, OSError):
                self.send_error(400)
                return
            raw = self.headers.get("Authorization", "")
            account = raw[len("Bearer demo-"):] if raw.startswith("Bearer demo-") else ""
            if account not in state.accounts:
                self.send_error(403)
                return
            state.capture(account, body)
            identifier = "chatcmpl-fixture-replay"
            def frame(delta=None, finish=None, usage=None):
                value = {"id": identifier, "object": "chat.completion.chunk", "created": 1,
                         "model": "demo-fast", "choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}
                if usage is not None:
                    value["usage"] = usage
                return ("data: " + json.dumps(value, separators=(",", ":")) + "\n\n").encode()
            chunks = [b": fixture keep-alive\r\n\r\n",
                      frame({"role": "assistant"}), b": fixture heartbeat\n\n",
                      frame({"content": TEXT}),
                      frame(finish="stop", usage={"prompt_tokens": 17, "completion_tokens": 5, "total_tokens": 22}),
                      b"data: [DONE]\n\n"]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(sum(map(len, chunks))))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for chunk in chunks:
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    time.sleep(0.012)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def sse_events(content):
    text = content.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    events = []
    for block in text.split("\n\n"):
        kind = "message"
        data = []
        for line in block.splitlines():
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                kind = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip(" "))
        if data:
            joined = "\n".join(data)
            events.append((kind, joined if joined == "[DONE]" else json.loads(joined)))
    return events


def completion_text(value, protocol):
    if protocol == "chat":
        return value.get("choices", [{}])[0].get("message", {}).get("content", "")
    if protocol == "messages":
        return "".join(item.get("text", "") for item in value.get("content", []) if item.get("type") == "text")
    return "".join(part.get("text", "") for item in value.get("output", [])
                   for part in item.get("content", []) if part.get("type") == "output_text")


def build_fixture(source, destination, key_file, target):
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("pack.json"))
        require(manifest.get("id") == PACK_ID and manifest.get("version") == "0.2.2-aibuddy.dev.1", "unexpected main pack identity/version")
        require(manifest.get("signature"), "main restoration pack must already be signed")
        original = json.loads(json.dumps(manifest))
        manifest.pop("signature", None)
        manifest["name"] = "AIBuddy isolated protocol replay fixture"
        manifest["description"] = "Synthetic demo only; temporarily installed for loopback acceptance"
        manifest["providers"] = [{"id": "demo", "label": "隔离协议回放", "order": 0, "default_enabled": True}]
        manifest["ui"] = []
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for item in archive.infolist():
                path = PurePosixPath(item.filename)
                require(not path.is_absolute() and ".." not in path.parts and "\\" not in item.filename, "unsafe original ZIP path")
                if item.is_dir() or item.filename.startswith("ui/"):
                    continue
                data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode() if item.filename == "pack.json" else archive.read(item)
                info = zipfile.ZipInfo(item.filename, (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = ((0o100755 if item.filename == manifest["entry"][target] else 0o100644) << 16)
                info.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    node = shutil.which("node")
    require(node, "Node runtime required for existing fixture signer")
    result = subprocess.run([node, str(ROOT / "provider-plugin/scripts/sign.mjs"), "sign", "--key", str(key_file),
                             "--zip", str(destination), "--target", target], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    require(result.returncode == 0, "temporary fixture signing failed")
    require(destination.stat().st_size < 24 * 1024 * 1024, "fixture pack exceeds install bound")
    return original


def execute(args):
    home = args.home.resolve()
    require(str(home).startswith(("/private/tmp/", "/tmp/")), "private temporary home required")
    require((home.stat().st_mode & 0o077) == 0, "validation home must be private")
    credential_file = home / "test-credentials.json"
    require((credential_file.stat().st_mode & 0o077) == 0, "fixture credential file must be private")
    credentials = json.loads(credential_file.read_text())
    require(all(isinstance(credentials.get(key), str) and credentials[key] for key in ("username", "password", "restrictedKey")), "fixture credentials incomplete")
    source = args.package.resolve()
    require(source.is_file(), "signed main development pack missing")
    main_bytes = source.read_bytes()
    proof = DatabaseProof(home)
    require(len(proof.old_account_ids) == args.expected_accounts, "unexpected original account count")
    require(all(row[1] != "demo" for row in proof.before["tables"]["accounts"].values()), "refusing pre-existing demo accounts")
    key_file = home / "fixture.key.json"
    require(key_file.is_file() and (home / "fixture-trust.json").is_file(), "validation signing fixture missing")
    run_id = "demo_fixture_" + time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
    work = Path(tempfile.mkdtemp(prefix=run_id + "_", dir=home))
    work.chmod(0o700)
    gateway = Gateway(credentials)
    checks, cases, cleanup_errors, owned_ids = [], [], [], []
    report = {"runId": run_id, "baseUrl": BASE, "realProviderActions": 0,
              "mainPackageSha256": hashlib.sha256(main_bytes).hexdigest(),
              "fixtureNamesPrefix": "demo_fixture_", "existingAccountCount": len(proof.old_account_ids),
              "checks": checks, "httpCases": cases, "cleanupErrors": cleanup_errors,
              "statisticsPolicy": "fixture requests/audits and derived daily/key counters may increase; oldest runtime audit logs may expire under normal retention; original business rows must remain unchanged"}
    report_path = args.report or home / "gateway-protocol-replay.json"
    report["beforeSnapshot"] = proof.persist_before(work / "before.sqlite")
    restoration_package = work / "restore-main-signed.zip"
    descriptor = os.open(restoration_package, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(main_bytes)
    report["restorationPackage"] = str(restoration_package)
    initial_pack = None
    install_attempted = False
    server = thread = None
    state = ReplayState()
    failure = None
    completed = False
    attempted = []

    def check(name, condition):
        checks.append({"name": name, "passed": bool(condition)})
        require(condition, name)

    def patch(identifier, patch):
        require(identifier in owned_ids and identifier not in proof.old_account_ids, "refusing non-fixture account patch")
        gateway.management("/api/accounts/" + urllib.parse.quote(identifier, safe=""), "PATCH", patch)
        proof.assert_old_accounts("after fixture patch")

    def infer(protocol, stream, *, rich=False, expected=None, label=None):
        paths = {"chat": "/v1/chat/completions", "messages": "/v1/messages", "responses": "/v1/responses"}
        body = {"model": "demo-fast", "stream": stream}
        if protocol == "responses":
            body.update(input="Synthetic fixture input", max_output_tokens=64)
        elif protocol == "messages":
            body.update(messages=[{"role": "user", "content": "Synthetic fixture input"}], max_tokens=64)
        else:
            body.update(messages=[{"role": "user", "content": "Synthetic fixture input"}], max_tokens=64)
        if rich:
            body["messages"] = [
                {"role": "user", "content": "Read the synthetic fixture."},
                {"role": "assistant", "content": None, "tool_calls": [{"id": "fixture_tool_1", "type": "function", "function": {"name": "fixture_lookup", "arguments": "{\"q\":\"fixture\"}"}}]},
                {"role": "tool", "tool_call_id": "fixture_tool_1", "name": "fixture_lookup", "content": "Synthetic tool result"},
                {"role": "user", "content": [{"type": "text", "text": "Synthetic inline image"}, {"type": "image_url", "image_url": {"url": IMAGE}}]},
            ]
            body["tools"] = [{"type": "function", "function": {"name": "fixture_lookup", "parameters": {"type": "object", "properties": {"q": {"type": "string"}}}}}]
        before = len(state.records)
        attempted.append({"protocol": protocol, "stream": stream, "richHistoryAndImage": rich})
        status, content, response_headers = gateway.request(paths[protocol], "POST", body, inference=True, raw=True,
            headers={"x-demo-upstream": "http://127.0.0.1:" + str(server.server_port),
                     "x-request-id": run_id + "_" + str(len(cases)), "x-client-name": "AIBuddy protocol replay fixture"})
        check((label or protocol + (" stream" if stream else " aggregate")) + " HTTP200", status == 200)
        require(len(state.records) == before + 1, "inference did not use exactly one local fixture upstream request")
        captured = state.records[-1]
        require(captured["fixtureAccount"] in ("first", "second"), "unrecognized selected fixture account")
        if expected:
            check(label + " selects expected account", captured["fixtureAccount"] == expected)
        events = []
        if stream:
            check(protocol + " streaming MIME", "text/event-stream" in response_headers.get("Content-Type", response_headers.get("content-type", "")))
            try:
                events = sse_events(content)
            except (ValueError, UnicodeError, TypeError):
                raise ReplayFailure(protocol + " invalid downstream SSE") from None
            encoded = json.dumps(events, ensure_ascii=False)
            check(protocol + " stream preserves fixture text", TEXT in encoded)
            kinds = {kind for kind, _ in events}
            if protocol == "chat":
                check("chat SSE terminates", any(value == "[DONE]" for _, value in events))
            elif protocol == "messages":
                check("messages SSE terminates", "message_stop" in kinds or any(isinstance(v, dict) and v.get("type") == "message_stop" for _, v in events))
            else:
                check("responses SSE terminates", "response.completed" in kinds or any(isinstance(v, dict) and v.get("type") == "response.completed" for _, v in events))
        else:
            try:
                value = json.loads(content)
            except ValueError:
                raise ReplayFailure(protocol + " aggregate did not return JSON") from None
            check(protocol + " aggregate preserves fixture text", completion_text(value, protocol) == TEXT)
        if rich:
            check("chat tool history survives", captured["toolHistoryIntact"])
            check("chat data image survives", captured["dataImages"] == 1)
        cases.append({"protocol": protocol, "stream": stream, "richHistoryAndImage": rich,
                      "selectedFixtureAccount": captured["fixtureAccount"], "upstreamRequests": 1,
                      "downstreamSseEvents": len(events), "leadingHeartbeatCommentsSent": True,
                      "responseBytes": len(content), "requestId": response_headers.get("x-request-id")})

    try:
        health_status, _, _ = gateway.request("/health")
        check("isolated gateway health returns HTTP200", health_status == 200)
        gateway.login()
        snapshot = gateway.management("/api/plugins")
        packs = (snapshot or {}).get("packs", [])
        initial_pack = next((pack for pack in packs if pack.get("id") == PACK_ID), None)
        require(initial_pack is not None, "main provider pack was not installed")
        initial_flags = provider_flags(initial_pack)
        initial_state_file = work / "initial-plugin-state.json"
        initial_state_file.write_text(json.dumps({"id": PACK_ID, "enabled": initial_pack.get("enabled"),
                                                 "version": initial_pack.get("version"),
                                                 "providerEnabled": initial_flags}, ensure_ascii=False, indent=2) + "\n")
        initial_state_file.chmod(0o600)
        report["initialPluginState"] = str(initial_state_file)
        target = snapshot.get("target")
        require(isinstance(target, str) and target, "plugin target missing")
        key_list = gateway.management("/api/keys")
        restricted = next((item for item in (key_list or {}).get("keys", []) if item.get("id") == "validation-restricted"), None)
        check("restricted inference key is enabled and demo-only", restricted is not None and restricted.get("enabled") is True and restricted.get("allowedProviders") == ["demo"])
        fixture = work / source.name
        original_manifest = build_fixture(source, fixture, key_file, target)
        require("demo" not in {p["id"] for p in original_manifest["providers"]}, "main pack unexpectedly declares demo")
        install_attempted = True
        gateway.install(fixture.read_bytes())
        gateway.management("/api/plugins/enable", "POST", {"id": PACK_ID, "enabled": True})
        gateway.management("/api/plugins/provider", "POST", {"id": PACK_ID, "provider": "demo", "enabled": True})
        check("fixture runtime registers only demo", gateway.provider_ids() == {"demo"})
        proof.assert_old_accounts("after temporary pack install")
        for label in ("first", "second"):
            result = gateway.management("/api/accounts", "POST", {"provider": "demo", "name": run_id + "_" + label,
                                        "token": run_id + "_token_" + label})
            account = result.get("account") or {}
            identifier = account.get("id")
            require(isinstance(identifier, str) and identifier not in proof.old_account_ids and identifier not in owned_ids,
                    "fixture account identity collision")
            require(account.get("provider") == "demo" and str(account.get("name", "")).startswith(run_id), "fixture account response mismatch")
            owned_ids.append(identifier)
            state.accounts[identifier] = label
            proof.assert_old_accounts("after fixture account creation")
        server, thread = replay_server(state)
        free = [number for number in range(10000) if number not in proof.old_priorities and number not in {
            int(row[2]) for row in proof.accounts().values()}]
        require(len(free) >= 3, "no free fixture priority slots")
        low, high, spare = free[:3]
        first, second = owned_ids
        patch(first, {"enabled": True, "priority": low})
        patch(second, {"enabled": True, "priority": high})
        for protocol in ("chat", "messages", "responses"):
            for stream in (False, True):
                infer(protocol, stream)
        infer("chat", True, rich=True)
        infer("chat", False, expected="first", label="priority lower number wins")
        patch(first, {"enabled": False})
        infer("chat", True, expected="second", label="disabled first account skipped")
        patch(first, {"enabled": True, "priority": spare})
        patch(second, {"priority": low})
        patch(first, {"priority": high})
        infer("chat", False, expected="second", label="priority swap selects second")
        patch(second, {"enabled": False})
        infer("chat", True, expected="first", label="enabled remaining account selected")
        check("all upstream requests are synthetic and local", len(state.records) == len(cases))
        completed = True
    except (Exception, KeyboardInterrupt) as error:
        failure = str(error) if isinstance(error, ReplayFailure) else "unexpected fixture failure (" + type(error).__name__ + ")"
        report["failure"] = failure
    finally:
        # Delete only the precise IDs returned by this run, before removing demo.
        for identifier in reversed(owned_ids):
            try:
                require(identifier not in proof.old_account_ids, "refusing original account cleanup")
                gateway.management("/api/accounts/" + urllib.parse.quote(identifier, safe=""), "DELETE")
                proof.assert_old_accounts("after fixture cleanup")
            except Exception as error:
                cleanup_errors.append({"stage": "delete owned fixture account", "errorType": type(error).__name__})
        if install_attempted:
            try:
                gateway.install(main_bytes)
                # Reinstalling a reduced manifest can lose old provider toggles.
                # Restore precisely the pre-run plugin settings through admin APIs.
                current = gateway.management("/api/plugins")
                current_pack = next((p for p in current.get("packs", []) if p.get("id") == PACK_ID), {})
                current_flags = provider_flags(current_pack)
                for identifier, enabled in provider_flags(initial_pack).items():
                    if current_flags.get(identifier) != enabled:
                        gateway.management("/api/plugins/provider", "POST", {"id": PACK_ID, "provider": identifier, "enabled": enabled})
                if initial_pack and current_pack.get("enabled") != initial_pack.get("enabled"):
                    gateway.management("/api/plugins/enable", "POST", {"id": PACK_ID, "enabled": bool(initial_pack.get("enabled"))})
                restored = gateway.management("/api/plugins")
                restored_pack = next((p for p in restored.get("packs", []) if p.get("id") == PACK_ID), {})
                report["mainPackRestored"] = (restored_pack.get("version") == "0.2.2-aibuddy.dev.1" and
                    provider_flags(restored_pack) == provider_flags(initial_pack) and
                    restored_pack.get("enabled") == (initial_pack or {}).get("enabled"))
                if restored_pack.get("enabled"):
                    require("demo" not in gateway.provider_ids(), "demo remains registered after main pack restoration")
            except Exception as error:
                report["mainPackRestored"] = False
                cleanup_errors.append({"stage": "reinstall original signed main pack/settings", "errorType": type(error).__name__})
        else:
            report["mainPackRestored"] = True
        if server:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        # Allow async request-stat writes to settle, without any new API actions.
        time.sleep(0.5)
        try:
            report["dataProof"] = proof.finish(owned_ids)
        except Exception as error:
            report["dataProof"] = {"protectedDataUnchanged": False, "errorType": type(error).__name__}
        report["upstreamSummary"] = state.records
        report["fixtureAccountCountCreated"] = len(owned_ids)
        report["passedChecks"] = sum(item["passed"] for item in checks)
        report["inferenceRequests"] = len(cases)
        report["inferenceRequestsAttempted"] = len(attempted)
        report["loopbackUpstreamRequests"] = len(state.records)
        report["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        report["sourcePackageUnchanged"] = source.read_bytes() == main_bytes
        report["success"] = (completed and len(cases) == 11 and failure is None and not cleanup_errors and report.get("mainPackRestored") is True
                             and report["sourcePackageUnchanged"] and report["dataProof"].get("protectedDataUnchanged") is True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        report_path.chmod(0o600)
        # Also keep a run-specific record so a later rerun never obscures the
        # failure, its account-row evidence or its recovery material.
        run_report_path = work / "report.json"
        run_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        run_report_path.chmod(0o600)
        # Keep the signed fixture and report as evidence; never rewrite source ZIP.
        print(json.dumps({"success": report["success"], "passedChecks": report["passedChecks"],
                          "inferenceRequests": len(cases), "realProviderActions": 0,
                          "report": str(report_path)}, ensure_ascii=False))
    return 0 if report["success"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="explicitly run authorized mutations on the private 3165 copy")
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--package", type=Path, default=DEFAULT_PACK)
    parser.add_argument("--expected-accounts", type=int, default=19)
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args()
    if not arguments.execute:
        parser.error("write/review mode only; --execute is required after the coordinator allocates a test window")
    try:
        return execute(arguments)
    except ReplayFailure as error:
        print(json.dumps({"success": False, "preflightFailure": str(error), "realProviderActions": 0}))
        return 1
    except Exception as error:
        print(json.dumps({"success": False, "preflightFailureType": type(error).__name__, "realProviderActions": 0}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
