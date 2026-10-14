# Signing RecoltOS and the "RecoltOS Local" certificate

## Public releases: Developer ID and notarization

Public releases use a **Developer ID Application** certificate, the hardened runtime and the JIT
entitlements for Electron. The native host (`recolt-host`, Rust) is signed by `pnpm run build:host`
with the same identity and the hardened runtime, without any entitlement. The `runAsNode` and `enableNodeCliInspectArguments`
fuses stay closed in the shipped build.

The notarization credentials are stored in the keychain under the `RecoltOS-notary` profile:

```sh
xcrun notarytool store-credentials "RecoltOS-notary" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID"
xcrun notarytool history --keychain-profile "RecoltOS-notary"
```

Enter the app-specific password only at the secure prompt of `notarytool`. Never pass it as an
argument, keep it in the repository or log it. The Team ID is supplied through the environment, with no
value stored in the repository.

To produce a release, set `RECOLTOS_SIGN_IDENTITY` to the full name of the Developer ID Application
certificate and set `APPLE_TEAM_ID`, then run:

```sh
RECOLTOS_NOTARIZE=1 pnpm run dist:dmg
pnpm run check:dist
pnpm run test:packaged
```

The build checks the signature's Team ID, submits the app to Apple, staples and validates its ticket,
then creates the signed DMG, submits it to Apple and staples and validates its ticket. A rejection stops
the build. Without `RECOLTOS_NOTARIZE=1`, nothing is sent to Apple. Local builds keep their ad hoc
signature by default, or the "RecoltOS Local" certificate when that identity is set.

## Why sign with a stable identity

macOS ties privacy permissions (Screen Recording, access to the Desktop, Documents…) to the app code's **designated requirement**, not to its path. With an **ad hoc** signature (`-`), that requirement is the `cdhash`: a hash of the bundle's contents. It stays the same as long as the bundle is identical byte for byte, and changes as soon as the code, the `Info.plist` or the fuses change. After each new build, macOS may therefore ask for the permissions again.

With a **stable local certificate**, the requirement becomes "identifier `com.recoltos.app` + this certificate": it no longer depends on the contents, and permissions survive rebuilds.

No official source guarantees that a **self-signed** certificate produces a stable `granted` state for Screen Recording. If the permission is not kept (or if `CGPreflightScreenCaptureAccess` stays `false` outside an identity with a Team ID), the fallback is an **Apple Development** identity (see below). Electron 42+ notifications also require a signed app.

| Signature                    | `codesign -dr -`                                            | Permissions kept between two builds       |
| ---------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Ad hoc (`-`, default)        | `designated => cdhash H"…"`                                 | No, as soon as the contents change        |
| "RecoltOS Local" certificate | `identifier "com.recoltos.app" and certificate leaf = H"…"` | Yes in practice (not guaranteed by Apple) |

The ad hoc build is fully functional: it is enough for developing and running the app. The certificate is only useful for keeping permissions between builds.

## Create the certificate (a step you do yourself, once)

> **Expected name: "RecoltOS Local"** (exactly). This is the name passed in `RECOLTOS_SIGN_IDENTITY` and looked up by `check:env`.

This is a security setting on your Mac: no script does it for you.

1. Open **Keychain Access** (Applications > Utilities).
2. Choose **Keychain Access > Certificate Assistant > Create a Certificate…**
3. Fill in:
   - **Name**: `RecoltOS Local` (exactly, with this capitalization).
   - **Identity Type**: _Self Signed Root_.
   - **Certificate Type**: _Code Signing_.
   - Check **Let me override defaults** so you can choose a long validity period (for example 3650 days), then click **Continue** to the end. Keep the **login** keychain.
4. In the list, double-click the `RecoltOS Local` certificate, expand **Trust**, and set **Code Signing** to **Always Trust**. Enter your user password to confirm.
5. Check that it is recognized as a valid identity:

   ```sh
   security find-identity -v -p codesigning
   ```

   You should see a `"RecoltOS Local"` line. Without step 4, it does not appear. In that case the config (`electron-builder.config.cjs`) **fails on purpose** with an error saying that no valid signing identity of that name exists in the keychain. electron-builder alone logs "skipped macOS application code signing … Identity name is specified, but no valid identity", exits with code 0 and produces an ad hoc signed build (unstable cdhash), without reporting anything else.

The first time you sign, macOS may ask whether `codesign` can access the private key: choose **Always Allow**.

## Use the identity

```sh
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist
pnpm run app:install          # copies to /Applications and opens the app
```

- Variable unset or empty: ad hoc signature `-` (`mac.identity` in `electron-builder.config.cjs`).
- `identity: null` is deliberately avoided: on arm64 it leaves only the linker signature, which is refused at launch.
- If `RECOLTOS_SIGN_IDENTITY` is set but the identity is not in the keychain, the build stops with a clear error (no silent fallback to ad hoc).
- `pnpm run app:install` (script `scripts/install-local.sh`) stops the installed app, replaces `/Applications/RecoltOS.app` with `ditto`, removes the quarantine attribute, verifies the signature (`codesign --verify --deep --strict`), checks that the designated requirement contains `certificate leaf` when `RECOLTOS_SIGN_IDENTITY` is set (otherwise the build is actually ad hoc and the script fails), then opens the app. It **never** touches `~/Library/Application Support/RecoltOS`.
- Script variables: `RECOLTOS_INSTALL_DIR` (target folder, default `/Applications`) and `RECOLTOS_NO_OPEN=1` (does not open the app).

## Check that the signature is stable

```sh
codesign -dr - dist/mac-arm64/RecoltOS.app      # note the "designated => …" line
RECOLTOS_SIGN_IDENTITY="RecoltOS Local" pnpm run dist
codesign -dr - dist/mac-arm64/RecoltOS.app      # must be identical, even after a code change
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/RecoltOS.app
```

With the right certificate, the line looks like
`designated => identifier "com.recoltos.app" and certificate leaf = H"<certificate fingerprint>"`.

## If permissions misbehave

After the **first** switch from an ad hoc signature to `RecoltOS Local` (or the other way around), the designated requirement changes one last time: macOS may ask for the permissions again, or keep an old entry that no longer works. Reset them, then relaunch the app and grant them again:

```sh
tccutil reset ScreenCapture com.recoltos.app
tccutil reset SystemPolicyDesktopFolder com.recoltos.app
tccutil reset SystemPolicyDocumentsFolder com.recoltos.app
tccutil reset SystemPolicyDownloadsFolder com.recoltos.app
```

## Offline

With a non-ad hoc identity, `codesign` requests a timestamp from Apple's server: without a network, signing may fail. Two ways out:

- try electron-builder's `mac.timestamp` option;
- or sign by hand: `codesign --force --deep --sign "RecoltOS Local" --timestamp=none dist/mac-arm64/RecoltOS.app`.

## Alternative: Apple Development identity

If you have an Apple Developer account, an "Apple Development: …" identity is passed the same way (`RECOLTOS_SIGN_IDENTITY="Apple Development: First Last (XXXXXXXXXX)"`). It is stable too, but it expires (after one year) and ties the build to your account. The local certificate remains the default option.

## Distribution

RecoltOS is neither notarized nor updated automatically: each person builds and signs it locally. A copy that has traveled (AirDrop, download) carries the quarantine attribute:

```sh
xattr -dr com.apple.quarantine /Applications/RecoltOS.app
```

Since macOS 15, right-click > Open is no longer enough for a non-notarized app: go through System Settings > Privacy & Security > "Open Anyway".
