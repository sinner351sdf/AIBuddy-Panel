#!/usr/bin/env python3
"""Exercise OAuth configuration with isolated processes and dummy values only.

Build agent2api-server first. No Google requests or real account credentials.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'target/debug/agent2api-server'
ID = 'AGENT2API_ANTIGRAVITY_CLIENT_ID'
SECRET = 'AGENT2API_ANTIGRAVITY_CLIENT_SECRET'
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
checks = 0


def check(value, message):
    global checks
    assert value, message
    checks += 1


for overrides, missing in [
    ({}, ID),
    ({ID: ' \t ', SECRET: 'fixture-private-value'}, ID),
    ({ID: 'fixture-client-value'}, SECRET),
    ({ID: 'fixture-client-value', SECRET: ' \t '}, SECRET),
    ({ID: ' fixture-client & value ', SECRET: ' fixture-private-value '}, None),
]:
    with tempfile.TemporaryDirectory(prefix='agent2api-oauth-env-') as scratch:
        home = Path(scratch)
        (home / 'config.json').write_text(json.dumps({'scheduledTasks': {
            k: {'enabled': False} for k in ('credentialMaintenance', 'modelRefresh', 'updateCheck')
        }}))
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = {k: v for k, v in os.environ.items() if not k.startswith(('AGENT2API_', 'WORKBUDDY_'))}
        env.update(AGENT2API_HOST='127.0.0.1', AGENT2API_PROXY_PORT=str(port),
                   AGENT2API_PROXY_HOME=scratch, AGENT2API_CAPTCHA_ENABLED='0')
        env.update(overrides)
        base = f'http://127.0.0.1:{port}'

        def request(path, payload=None, token=None):
            headers = {'Content-Type': 'application/json'}
            if token:
                headers['x-panel-token'] = token
            req = urllib.request.Request(base + path, headers=headers,
                data=None if payload is None else json.dumps(payload).encode())
            try:
                response = client.open(req, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.loads(response.read())

        with (home / 'server.log').open('w') as log:
            proc = subprocess.Popen([str(BINARY)], env=env, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    if proc.poll() is not None:
                        raise RuntimeError('isolated server exited unexpectedly')
                    try:
                        status, _ = request('/health')
                        if status == 200:
                            break
                    except (OSError, urllib.error.URLError):
                        time.sleep(.1)
                else:
                    raise RuntimeError('isolated server failed to start')
                status, login = request('/api/panel/setup?auth-mode=body',
                    {'username': 'oauth-fixture', 'password': secrets.token_urlsafe(20)})
                check(status == 200, 'setup failed')
                token = login['data']['accessToken']
                status, result = request('/api/session/login/start', {'provider': 'antigravity'}, token)
                serialized = json.dumps(result)
                check('fixture-private-value' not in serialized, 'secret leaked in response')
                if missing:
                    check(status == 400, 'missing configuration did not reject login')
                    check(missing in serialized, 'missing environment name not reported')
                    check('fixture-client-value' not in serialized, 'configured value leaked in error')
                    check('authUrl' not in serialized, 'unconfigured login emitted authorization URL')
                else:
                    check(status == 200, 'configured login failed')
                    url = urllib.parse.urlparse(result['data']['authUrl'])
                    query = urllib.parse.parse_qs(url.query)
                    check(url.scheme == 'https' and url.hostname == 'accounts.google.com', 'wrong OAuth endpoint')
                    check(query.get('client_id') == ['fixture-client & value'], 'configured ID not used')
                    check(query.get('state') == [result['data']['state']], 'OAuth state mismatch')
                    check(query.get('redirect_uri') == [f'http://localhost:{port}/oauth-callback'], 'callback mismatch')
                    check('client_secret' not in query, 'secret included in URL')
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        check('fixture-private-value' not in (home / 'server.log').read_text(), 'secret leaked in log')

print(f'PASS: {checks} OAuth environment assertions; five isolated servers, no Google requests')
