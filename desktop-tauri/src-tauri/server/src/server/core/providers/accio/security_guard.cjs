'use strict';

// Private stdio bridge. The addon stays in the user's official installation;
// neither the native binary nor generated factors are copied to disk.
const {createHash} = require('node:crypto');
const {createInterface} = require('node:readline');
const write = process.stdout.write.bind(process.stdout);
console.log = console.warn = console.error = () => {};
const emit = value => write('@accio-sg:' + JSON.stringify(value) + '\n');
let sdk;
let init;
let binding;
let loadError;
try {
  sdk = require(process.argv[1]);
  if (sdk.isStub === true || typeof sdk.getSecurityFactorsForWeb !== 'function') {
    throw new Error('unavailable');
  }
} catch (_) { loadError = 'sg_unavailable'; }

function tokenPresent() {
  try { const token = sdk.getSecurityToken(6); return typeof token === 'string' && token.length > 0; }
  catch (_) { return false; }
}

async function initializeOnce(mode, sgcookie) {
  try {
    const token = mode === 'sgcookie' ? await sdk.initUmidBySgCookie(sgcookie) : await sdk.initUmid(6);
    const present = (typeof token === 'string' && token.length > 0) || tokenPresent();
    return {status: present ? 'success' : 'failed', tokenPresent: present, mode,
      reason: present ? null : 'missing_token'};
  } catch (error) {
    // Only numeric codes and controlled reasons cross the pipe. Native messages
    // can contain cookies, filesystem paths or tokens; never serialize them.
    const code = Number.isSafeInteger(error?.errorCode) ? error.errorCode : null;
    const busy = typeof error?.message === 'string' && error.message.includes('already in progress');
    const present = tokenPresent();
    return {mode, status: code === 1 && present ? 'already_initialized' : 'failed',
      tokenPresent: present, errorCode: code,
      reason: code === 1 ? 'already_initialized' : busy ? 'already_in_progress' : 'native_error'};
  }
}

async function initialize(sgcookie) {
  const mode = sgcookie ? 'sgcookie' : 'environment';
  if (loadError) return {status: 'unavailable', tokenPresent: false, mode};
  const primary = await initializeOnce(mode, sgcookie);
  // Desktop 0.34.5 uan -> lan: cookie rejection falls back once to AREA_ONLINE.
  // rc=1 and an initialization already in progress must not start another init.
  if (mode !== 'sgcookie' || primary.status !== 'failed' ||
      primary.errorCode === 1 || primary.reason === 'already_in_progress' ||
      primary.reason === 'missing_token') return {...primary, fallbackAttempted: false};
  const fallback = await initializeOnce('environment', '');
  return {...fallback, fallbackAttempted: true, cookieErrorCode: primary.errorCode,
    cookieReason: primary.reason};
}

function factors(urlText, appkey) {
  const url = new URL(urlText);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('url');
  // Matches desktop 0.34.5: Windows passes the URL, macOS passes api + MD5(uri).
  const input = process.platform === 'win32'
    ? {appkey, urlInput: urlText}
    : {appkey, api: url.hostname + url.pathname,
      data: createHash('md5').update(url.pathname + url.search, 'utf8').digest('hex')};
  let raw;
  try { raw = sdk.getSecurityFactorsForWeb(JSON.stringify(input)); }
  catch (error) {
    return {errType: 'sg_native_error', errCode: Number.isSafeInteger(error?.errorCode) ? error.errorCode : null};
  }
  let value;
  try { value = JSON.parse(raw); } catch (_) { return {errType: 'sg_parse_error'}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {errType: 'sg_invalid_shape'};
  const headers = {};
  for (const [key, valuePart] of Object.entries(value)) {
    if (['string', 'number', 'boolean'].includes(typeof valuePart)) {
      headers[key] = encodeURIComponent(String(valuePart));
    }
  }
  return Object.keys(headers).length ? {headers} : {errType: 'sg_invalid_shape'};
}

// Serialize commands even while native initialization is awaiting its callback.
let queue = Promise.resolve();
const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
lines.on('line', line => {
  queue = queue.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
      if (binding !== undefined && binding !== request.binding) return emit({id: request.id, errType: 'sg_context_changed'});
      binding = request.binding;
      const cookie = request.sgcookie ?? '';
      if (typeof cookie !== 'string' || cookie.length > 65536 || /[\u0000-\u001f\u007f]/.test(cookie)) throw new Error('cookie');
      init ??= initialize(cookie);
      const initialization = await init;
      if (loadError) return emit({id: request.id, init: initialization, errType: loadError});
      if (initialization.status === 'failed' || !initialization.tokenPresent) return emit({id: request.id, init: initialization, errType: 'sg_init_failed'});
      emit({id: request.id, init: initialization, ...factors(request.url, request.appkey)});
    } catch (_) { emit({id: request?.id, errType: 'sg_bridge_error'}); }
  });
});
lines.on('close', () => queue.finally(() => process.exit(0)));
