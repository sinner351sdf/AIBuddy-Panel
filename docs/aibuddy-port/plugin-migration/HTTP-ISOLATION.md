# Host HTTP isolation

`AIBUDDY_VALIDATION_MODE=1` enables `core::validation`. Normal service operation delegates to the existing reqwest client without changing its proxy, redirect, header or timeout behavior.

In validation mode, `ValidatedRequest::send_guarded` builds the request before sending, accepts only HTTP(S) loopback addresses without URL credentials, and sends it through a fresh client with proxies and redirects disabled. `localhost` is pinned to `127.0.0.1`; other domain names and non-loopback IPv4/IPv6 literals are refused before DNS or connection. The existing `reqwest::Error` return type is retained; policy refusal becomes a request builder error and a validation log entry. Explicit request bodies and per-request timeouts remain attached.

Active host transport coverage:

| Path under `server/core` | Covered operations |
| --- | --- |
| `auth_http.rs` | Generic management/authentication requests |
| `upstream/request.rs` | Custom-provider inference transport, including streamed responses |
| `custom_providers.rs` | Custom model list fetch |
| `providers/custom/sensenova_auth.rs` | Remaining host-managed custom-provider OAuth steps |
| `egress.rs` | Connectivity and exit-IP probes; validation skips configured/system proxy construction |
| `update/client.rs` | Application/plugin/index/model-metadata downloads; GitHub authorization is additionally removed in validation mode |
| `cloud_sync/s3.rs` | HEAD, PUT and GET |
| `cloud_sync/webdav.rs` | PROPFIND, MKCOL, PUT, GET and DELETE |
| `notify.rs` | All notification HTTP helpers |
| `sub_kernel/download.rs` | Kernel download |
| `sub_kernel/runtime.rs` | Local controller REST calls |

The guard does not activate copied schedules. Host startup separately disables background checks, cloud sync, travel and other automatic work. Plugin bootstrap still loads an installed development package, but skips the catalog worker and schedule discovery in validation mode. Plugin schedule lookup reports the isolation pause reason. The plugin process has its own equivalent transport boundary; host guards do not sandbox arbitrary third-party executables.

The three local regression tests cover URL confusion and userinfo, public DNS names and IP literals rejected before connection, and a real loopback POST made from a client configured with an unreachable external proxy. The loopback fixture returns a redirect to an external address; the response remains 302 and is not followed. These tests do not contact real providers.

The validation panel also emits a local-only Content-Security-Policy for browser scripts, images, fonts, frames, form submissions and connections. Inline application assets remain usable; external CDN/provider assets are blocked before a request leaves the browser. Production headers are unchanged.

Manual balance refresh is rejected with an explicit validation-only 503 before account resolution, RPC, or balance-history writes. The existing credit-package route returns a successful pause envelope (`pauseReason`) so its page can retain its prior snapshot and explain the paused refresh. The usage sweeper has its own early guard as well as the startup gate. ZCode's incidental configuration sync returns before account callbacks or task creation; viewing status cannot start that background work during review. Normal production paths retain their existing refresh behavior.

Validation panel cookies use separate names and ignore the production panel cookies. Ports do not scope browser cookies, so the 3165 login/logout/refresh flow must neither reuse nor replace the 3065 panel session in the same browser. This mapping is enabled only for the isolated panel.
