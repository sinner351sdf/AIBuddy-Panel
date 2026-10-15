#!/usr/bin/env python3
"""Isolated 3.0.3 HTTP integration checks; no real providers or kernel download."""
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'target/debug/agent2api-server'
CLIENT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
checks = 0
check_lock = threading.Lock()


def check(condition, message):
    global checks
    assert condition, message
    with check_lock:
        checks += 1


with tempfile.TemporaryDirectory(prefix='agent2api-303-test-') as scratch:
    home = Path(scratch)
    (home / 'config.json').write_text(json.dumps({
        'modelsDevEnabled': False,
        'scheduledTasks': {k: {'enabled': False} for k in
                           ('credentialMaintenance', 'modelRefresh', 'updateCheck')},
    }))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('AGENT2API_', 'WORKBUDDY_'))}
    env.update(AGENT2API_HOST='127.0.0.1', AGENT2API_PROXY_PORT=str(port),
               AGENT2API_PROXY_HOME=scratch, AGENT2API_CAPTCHA_ENABLED='0',
               AGENT2API_UI_DIR=str(ROOT / 'desktop-tauri/ui'))
    # Isolate Clash discovery too: expose only the upstream-style mixed listener.
    clash_dir = home / 'clash' / 'io.github.clash-verge-rev.clash-verge-rev'
    clash_dir.mkdir(parents=True)
    (clash_dir / 'verge.yaml').write_text('verge_mixed_port: 18888\nverge_mixed_listeners: []\n')
    env['APPDATA'] = str(home / 'clash')
    base = f'http://127.0.0.1:{port}'
    token = None
    process = None
    log = (home / 'server.log').open('w')

    def request(path, method='GET', body=None, auth=None, key=None, expected=200):
        headers = {'Content-Type': 'application/json'}
        if auth:
            headers['x-panel-token'] = auth
        if key:
            headers['Authorization'] = 'Bearer ' + key
        req = urllib.request.Request(base + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        try:
            response = CLIENT.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            check(response.status == expected,
                  f'{method} {path}: {response.status} expected {expected}: {raw[:250]!r}')
        result = json.loads(raw)
        return result.get('data', result)

    def admin(path, method='GET', body=None, expected=200):
        return request(path, method, body, auth=token, expected=expected)

    def start():
        proc = subprocess.Popen([str(BINARY)], env=env, stdout=log, stderr=log)
        for _ in range(100):
            assert proc.poll() is None, 'fixture exited'
            try:
                CLIENT.open(base + '/health', timeout=.2).close()
                return proc
            except OSError:
                time.sleep(.1)
        proc.terminate()
        proc.wait(timeout=5)
        raise RuntimeError('fixture startup timed out')

    def stop():
        process.terminate()
        process.wait(timeout=5)
        check(process.returncode == 0, 'graceful shutdown failed')

    try:
        process = start()
        password = secrets.token_urlsafe(20)
        token = request('/api/panel/setup?auth-mode=body', 'POST',
                        {'username': 'upstream-fixture', 'password': password})['accessToken']
        key = 'sk-fixture-' + secrets.token_hex(16)
        kid = admin('/api/keys', 'POST', {'name': 'restricted', 'key': key})['created']['id']
        admin('/api/keys/' + kid + '/quota', 'PUT', {'quotaTokens': 100})
        routes = [('/api/subscriptions', 'GET'), ('/api/subscriptions/add', 'POST'),
                  ('/api/subscriptions/kernel', 'GET'), ('/api/subscriptions/kernel/download', 'POST'),
                  ('/api/subscriptions/kernel/restart', 'POST'), ('/api/subscriptions/decode-qr', 'POST'),
                  ('/api/models/metadata', 'GET'), ('/api/models/metadata', 'PUT'),
                  ('/api/models/metadata/refresh', 'POST'), ('/api/keepalive-strip', 'GET'),
                  ('/api/keepalive-strip', 'PUT')]
        for path, method in routes:
            body = {} if method != 'GET' else None
            request(path, method, body, expected=401)
            request(path, method, body, key=key, expected=403)
        check(admin('/api/subscriptions')['items'] == [], 'unexpected subscriptions')
        for url in ('', 'ss://unsupported', 'file:///tmp/nodes'):
            admin('/api/subscriptions/add', 'POST', {'name': 'bad', 'url': url}, expected=400)
        result = admin('/api/subscriptions/add', 'POST',
                       {'name': 'isolated', 'url': 'https://example.invalid/subscription', 'enabled': False})
        sid = result['items'][0]['id']
        check(not result['items'][0]['enabled'], 'disabled subscription not retained')
        check(not result['kernel']['installed'], 'fixture unexpectedly installed a kernel')
        admin('/api/subscriptions/refresh', 'POST', {'id': sid}, expected=400)
        admin('/api/subscriptions/refresh', 'POST', {'id': 'missing'}, expected=404)
        admin('/api/subscriptions/save', 'POST',
              {'id': sid, 'name': 'renamed', 'url': 'https://example.invalid/new', 'enabled': False})
        check(admin('/api/keepalive-strip')['stripNewlineKeepalive'] is False, 'default must be off')
        admin('/api/keepalive-strip', 'PUT', {'stripNewlineKeepalive': True})
        admin('/api/keepalive-strip', 'PUT', {'stripNewlineKeepalive': 'true'}, expected=400)
        metadata = admin('/api/models/metadata')
        check(metadata['modelsDevEnabled'] is False, 'metadata toggle')
        refresh = admin('/api/models/metadata/refresh', 'POST', {})
        check(refresh['result']['status'] == 'skipped', 'disabled refresh must avoid network')
        admin('/api/models/metadata', 'PUT', {'modelsDevEnabled': 'false'}, expected=400)
        admin('/api/debug', 'PUT', {'debugMode': False})
        check(admin('/api/subscriptions')['items'][0]['id'] == sid, 'config save erased subscriptions')
        # Batch concurrency on disposable accounts, including rejection without partial writes.
        fixtures = [admin('/api/custom-providers', 'POST', {
            'name': f'Concurrency fixture {i}', 'protocol': 'chat_completions',
            'baseUrl': 'https://example.invalid/v1', 'apiKey': f'fixture-only-{i}',
        }) for i in range(2)]
        ids = [item['account']['id'] for item in fixtures]
        admin('/api/accounts/batch', 'POST', {'action': 'concurrency', 'ids': ids, 'maxConcurrent': 4})
        def concurrency_values():
            return [item['maxConcurrent'] for item in admin('/api/accounts')['accounts'] if item['id'] in ids]
        check(concurrency_values() == [4, 4], 'batch concurrency not applied to both accounts')
        for value in (-1, 1000, 1.5):
            admin('/api/accounts/batch', 'POST', {
                'action': 'concurrency', 'ids': ids, 'maxConcurrent': value,
            }, expected=400)
        check(concurrency_values() == [4, 4], 'invalid concurrency partially changed accounts')
        # Metadata must reach the public model list and preserve explicit user values.
        embedded = json.loads((ROOT / 'desktop-tauri/src-tauri/server/src/server/core/model_meta/modelsdev.json').read_text())['models']
        record = next(value for value in embedded.values() if value.get('context') and value.get('levels'))
        model_id = record['canonical'].split('/')[-1]
        provider = fixtures[0]['provider']['id']
        def save_model(capabilities=None):
            model = {'id': model_id, 'enabled': True}
            if capabilities is not None:
                model['capabilities'] = capabilities
            admin('/api/custom-providers/models', 'POST', {
                'providerId': provider, 'models': [model], 'mappings': [],
            })
        def public_model():
            return next(item for item in request('/v1/models', key=key) if item['id'] == model_id)
        save_model()
        item = public_model()
        check(item.get('max_input_tokens') == record['context'], f'metadata context not advertised: {item}')
        save_model({'maxInputTokens': 777})
        check(public_model().get('max_input_tokens') == 777, 'metadata replaced explicit user context')
        # Concurrent manual writes and original Clash synchronization preserve subscription rows.
        pool = admin('/api/proxies/pool')
        check(len(pool['items']) == 1 and pool['items'][0]['source'] == 'clash', 'Clash sync should mirror only its mixed listener')
        with sqlite3.connect(home / 'agent2api.db') as db:
            db.execute('BEGIN IMMEDIATE')
            raw = json.loads(db.execute("SELECT value FROM kv WHERE key='proxyPool'").fetchone()[0])
            raw['items'].append({'id': 'fixture-sub-node', 'source': 'subscription',
                                 'providerId': sid, 'node': 'fixture', 'name': 'fixture subscription',
                                 'port': 28888, 'enabled': True})
            db.execute("UPDATE kv SET value=? WHERE key='proxyPool'", [json.dumps(raw)])
        def add_proxy(index):
            return admin('/api/proxies/pool', 'POST', {
                'name': f'concurrent proxy {index}', 'host': '127.0.0.1',
                'port': 29000 + index, 'protocol': 'http', 'enabled': True,
            })
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
            writes = [executor.submit(add_proxy, index) for index in range(24)]
            syncs = [executor.submit(admin, '/api/proxies/pool/sync-clash', 'POST', {}) for _ in range(16)]
            for future in writes + syncs:
                future.result()
        pool = admin('/api/proxies/pool')['items']
        check(sum(item['source'] == 'manual' for item in pool) == 24, 'concurrent pool writes lost manual proxies')
        check(sum(item['source'] == 'clash' for item in pool) == 1, 'Clash synchronization duplicated its listener')
        check(any(item['id'] == 'fixture-sub-node' for item in pool), 'Clash synchronization erased subscription node')
        check(not any(str(item.get('listenerUid', '')).startswith('__node__:') for item in pool), 'legacy independent nodes still exposed')
        # Generate and decode a QR locally with the existing UI dependency.
        qr = subprocess.check_output(['node', '--input-type=module', '-e',
            "import QR from 'qrcode'; process.stdout.write(await QR.toDataURL('https://example.invalid/qr'));"],
            cwd=ROOT / 'desktop-tauri/ui-islands').decode().strip()
        decoded = admin('/api/subscriptions/decode-qr', 'POST', {'imageBase64': qr})
        check(decoded['url'] == 'https://example.invalid/qr', 'QR roundtrip failed')
        admin('/api/subscriptions/decode-qr', 'POST', {'imageBase64': base64.b64encode(b'bad').decode()}, expected=400)
        admin('/api/backup/run', 'POST', {})
        snapshots = list((home / 'backups').glob('*.db'))
        check(bool(snapshots), 'database snapshot missing')
        with sqlite3.connect(snapshots[-1]) as db:
            saved = json.loads(db.execute("SELECT value FROM kv WHERE key='subscriptions'").fetchone()[0])
            check(saved['items'][0]['id'] == sid, 'snapshot omitted subscriptions')
            check(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'snapshot invalid')
        stop()
        process = start()
        token = request('/api/panel/login?auth-mode=body', 'POST',
                        {'username': 'upstream-fixture', 'password': password})['accessToken']
        items = admin('/api/subscriptions')['items']
        check(items[0]['id'] == sid and items[0]['name'] == 'renamed', 'restart lost subscription')
        check(admin('/api/keepalive-strip')['stripNewlineKeepalive'] is True, 'restart lost strip toggle')
        check(admin('/api/keys/' + kid + '/quota')['quotaTokens'] == 100, 'restart lost Key quota')
        check(concurrency_values() == [4, 4], 'restart lost batch concurrency')
        check(public_model().get('max_input_tokens') == 777, 'restart lost model capability override')
        admin('/api/subscriptions/remove', 'POST', {'id': sid})
        check(admin('/api/subscriptions')['items'] == [], 'remove failed')
        stop()
        print(f'PASS: {checks} isolated 3.0.3 checks; authorization, subscriptions, concurrency, model metadata, persistence, snapshot and QR')
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
        log.close()
