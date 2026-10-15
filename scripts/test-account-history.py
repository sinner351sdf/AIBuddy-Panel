#!/usr/bin/env python3
"""Isolated account-history migration/API test. Uses synthetic disabled accounts only."""
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'target/debug/agent2api-server'
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
registry = (ROOT / 'desktop-tauri/src-tauri/server/src/server/core/providers/mod.rs').read_text()
providers = re.findall(r'ProviderMeta \{ id: "([^"]+)", label: "([^"]+)" \}', registry)
assert len(providers) >= 20

with tempfile.TemporaryDirectory(prefix='agent2api-account-history-') as scratch:
    home = Path(scratch)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = {k: v for k, v in os.environ.items() if not k.startswith(('AGENT2API_', 'WORKBUDDY_'))}
    env.update(AGENT2API_PROXY_HOME=scratch, AGENT2API_PROXY_PORT=str(port), AGENT2API_HOST='127.0.0.1',
               AGENT2API_CAPTCHA_ENABLED='0', AGENT2API_UI_DIR=str(ROOT / 'desktop-tauri/ui'))
    token = None

    def request(path, method='GET', body=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['x-panel-token'] = token
        req = urllib.request.Request(base + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        with http.open(req, timeout=20) as response:
            result = json.load(response)
            assert response.status == 200
            return result.get('data')

    def start():
        log = (home / 'server.log').open('ab')
        process = subprocess.Popen([str(BINARY)], env=env, stdout=log, stderr=log)
        log.close()
        for _ in range(150):
            if process.poll() is not None:
                raise RuntimeError((home / 'server.log').read_text()[-2000:])
            try:
                http.open(base + '/health', timeout=.2).close()
                return process
            except OSError:
                time.sleep(.1)
        process.terminate()
        raise RuntimeError('fixture startup timeout')

    process = start()
    password = secrets.token_urlsafe(20)
    try:
        token = request('/api/panel/setup?auth-mode=body', 'POST', {'username': 'history-fixture', 'password': password})['accessToken']
        process.terminate()
        process.wait(timeout=15)
        expected = {}
        with sqlite3.connect(home / 'agent2api.db') as db:
            for name in ['insert', 'update_old', 'update_new', 'delete']:
                db.execute(f'DROP TRIGGER account_history_{name}')
            db.execute('DROP TABLE account_history')
            db.execute('PRAGMA user_version=12')
            db.execute("INSERT INTO kv(key,value) VALUES ('customProviders', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (json.dumps([{'id': 'custom-fixture', 'name': 'Historical Custom', 'enabled': False}]),))
            rows = []
            for provider, label in providers + [('custom-fixture', 'Historical Custom')]:
                account_id = f'fixture-{provider}'
                edition = 'intl' if provider.endswith('-intl') or provider in ['accio', 'custom-fixture'] else 'cn'
                data = {'id': account_id, 'provider': provider, 'edition': edition, 'name': label, 'enabled': False}
                db.execute('INSERT INTO accounts(id,provider,priority,enabled,data) VALUES(?,?,0,0,?)', (account_id, provider, json.dumps(data)))
                rows.append({'accountId': account_id, 'accountName': label, 'requests': 1, 'successful': 1, 'tokens': 1000})
                expected[account_id] = (provider, label, edition)
            # An account already removed before upgrading: recover provider and region from its request.
            db.execute("INSERT INTO requests(id,ts,model,status,provider,account_id,total_tokens) VALUES('old',?,'fixture',200,'qoder-intl','removed-before-upgrade',1000)", (int(time.time()*1000),))
            rows.append({'accountId': 'removed-before-upgrade', 'accountName': 'Old Account', 'requests': 1, 'successful': 1, 'tokens': 1000})
            expected['removed-before-upgrade'] = ('qoder-intl', 'Qoder 国际版', 'intl')
            day = time.strftime('%Y-%m-%d')
            db.execute('INSERT INTO request_daily(date,requests,successful,tokens,account_stats) VALUES(?,?,?,?,?)',
                       (day, len(rows), len(rows), len(rows)*1000, json.dumps(rows)))

        process = start()
        token = request('/api/panel/login?auth-mode=body', 'POST', {'username': 'history-fixture', 'password': password})['accessToken']
        before = request('/api/stats/summary?range=all')

        def verify(summary):
            actual = {row['id']: row for row in summary['accounts']}
            for account_id, identity in expected.items():
                row = actual[account_id]
                assert (row['provider'], row['providerLabel'], row['edition']) == identity, (account_id, row)
                assert row['totalTokens'] == 1000
            assert summary['overview']['tokens'] == len(expected)*1000

        verify(before)
        # Real account deletion endpoints, using disposable disabled fixture rows.
        for account_id in expected:
            if account_id != 'removed-before-upgrade':
                request('/api/accounts/' + account_id, 'DELETE')
        after = request('/api/stats/summary?range=all')
        verify(after)
        assert before['overview'] == after['overview']
        process.terminate()
        process.wait(timeout=15)
        with sqlite3.connect(home / 'agent2api.db') as db:
            db.execute('DELETE FROM requests')
            db.execute("DELETE FROM kv WHERE key='customProviders'")
            assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 0
        process = start()
        token = request('/api/panel/login?auth-mode=body', 'POST', {'username': 'history-fixture', 'password': password})['accessToken']
        verify(request('/api/stats/summary?range=all'))
        print(f'PASS: v12 to v13 migration, {len(providers)} built-in providers + custom provider; real deletion API; historical backfill; stable totals; restart; request pruning and custom-provider removal preserve identity')
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
