# Frozen Android build boundary

Android stays on the complete pre-migration source archive at `legacy/android-baseline/source.tar.gz`, baseline commit `4606d87465b1d4164217405f5296a44bf29a6941` plus its saved working tree. Its fixed archive SHA-256 is `f4dc529f79964fa7da2677436e05d338076476377f1941c0b8c2ebe6805a7847`. The accompanying `snapshot.json` records all 1,617 file hashes.

Use `node scripts/build-android-frozen.mjs --prepare-only --out /absolute/isolated/output` to verify and extract the old UI, shared Rust service, JNI, Gradle configuration and package identity together. Preparation is repeatable only while those recorded source files remain unchanged. It rejects archive or source tampering and verifies that the old Android crate resolves `../server` inside that extracted tree. The extracted source has no new `provider-plugin` workspace.

`--build` explicitly runs the frozen npm, Cargo NDK and Gradle entry points. It requires a configured SDK and existing build tools. Rust artifacts use the isolated output's `target/`; copied APK outputs use its `dist/`. It does not copy or generate a production signing key. The original release signing configuration still requires the existing keystore and credentials; CI explicitly builds an unsigned release and a separate `.debug` package.

The Android GitHub workflow is manual only. All build commands, emulator checks, caches and uploaded files point to the verified frozen source and target. Changes to the new desktop/server implementation cannot automatically build an Android APK against the new shared Rust service.

This migration ran preparation, full file-hash verification, repeat preparation and deliberate source-tamper rejection only. It did not invoke Cargo NDK, Gradle, an emulator, signing or an APK build.
