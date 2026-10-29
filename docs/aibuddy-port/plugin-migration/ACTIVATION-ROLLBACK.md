# Plugin activation transaction

Package parsing, protocol/platform checks, signature verification and executable preparation finish before stopping the old host. `PreparedPack::stage` then keeps the exact previous `plugins.json` bytes and any directory replaced by a same-version reinstall. It does not delete that backup when the new registry record is written.

`operations::install_prepared` stops the old process, stages the package and starts the new process. Startup checks that every provider declared in the on-disk manifest is present exactly once in the initialization result. Extra providers from a development binary, such as `demo`, are ignored. An empty initialization result, missing declared provider, repeated declared provider, execution failure or protocol failure prevents activation.

Only successful activation commits the transaction and removes the replaced directory backup. On activation or commit failure, the host stops the new process before restoring the old directory and registry, then reloads the old host. The operation returns an error that explicitly reports rollback/recovery; it is not reported as a successful installation with a warning. Disabled packages and individual provider toggles keep their previous values.

Adapter and schedule registrations are rebuilt during the switch. The RPC model cache is retained through staging and rollback, so failure does not discard the last working model catalog. Dropping an uncommitted transaction also attempts rollback. If filesystem recovery fails, the backup is retained and the error identifies it; a retry does not remove an already-restored original binary.

The file-transaction tests cover same-version replacement, an upgrade to another directory, registry-save failure, abandoned activation, first-install rollback, repeated rollback and a registry-restore retry. The handshake tests cover missing/empty/duplicate declarations and extra demo filtering. These unit tests simulate failed activation; execution of bad executables and invalid wire handshakes is verified separately through the isolated host lifecycle fixtures.
