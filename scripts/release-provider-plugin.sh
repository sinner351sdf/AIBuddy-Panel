#!/usr/bin/env bash
# Manual, reviewed publication only. No tag creation, app latest changes or rebuild.
set -euo pipefail
if [[ $# -lt 4 ]]; then
  echo 'Usage: release-provider-plugin.sh providers-vVERSION RUN_ID NOTES_FILE TRUSTED_PUBLIC_KEYS_JSON [--signing-key PRIVATE_KEY_FILE] [--publish]' >&2
  exit 2
fi
TAG=$1
RUN_ID=$2
NOTES=$3
TRUSTED_KEYS=$4
shift 4
MODE=draft
SIGNING_KEY=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) MODE=--publish; shift ;;
    --signing-key) [[ $# -ge 2 && -f "$2" ]] || exit 2; SIGNING_KEY=$(cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2"); shift 2 ;;
    *) echo 'Unknown publication option' >&2; exit 2 ;;
  esac
done
[[ "$RUN_ID" =~ ^[1-9][0-9]*$ && ( "$MODE" == draft || "$MODE" == --publish ) ]] || exit 2
[[ -f "$NOTES" && -s "$NOTES" && -f "$TRUSTED_KEYS" ]] || { echo 'Missing reviewed notes or trusted production public keys' >&2; exit 2; }
ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
node --input-type=module -e 'import {pluginVersion} from "./scripts/provider-plugin-assets.mjs"; pluginVersion(process.argv[1])' "$TAG"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
[[ "$REPO" == sinner351sdf/AIBuddy-Panel ]] || { echo 'Unexpected plugin publication repository' >&2; exit 1; }
SHA=$(git rev-parse --verify "refs/tags/$TAG^{commit}")
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
gh api "repos/$REPO/actions/runs/$RUN_ID" > "$WORK/run.json"
gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" > "$WORK/artifacts.json"
node scripts/provider-plugin-assets.mjs run "$WORK/run.json" "$WORK/artifacts.json" "$SHA" "$TAG" "$REPO"
gh run download "$RUN_ID" --repo "$REPO" --dir "$WORK/assets"
ASSET_DIR="$WORK/assets"
if [[ -n "$SIGNING_KEY" ]]; then
  node scripts/sign-provider-artifacts.mjs --input "$ASSET_DIR" --out "$WORK/signed" --tag "$TAG" --sha "$SHA" --key "$SIGNING_KEY" --trusted-keys "$TRUSTED_KEYS"
  ASSET_DIR="$WORK/signed"
fi
node scripts/provider-plugin-assets.mjs list "$ASSET_DIR" "$TAG" "$SHA" "$TRUSTED_KEYS" > "$WORK/assets.list"
if gh release view "$TAG" --repo "$REPO" --json isDraft > "$WORK/existing.json" 2>/dev/null; then
  node -e 'if(!JSON.parse(require("fs").readFileSync(process.argv[1])).isDraft)throw Error("Existing published plugin release is immutable")' "$WORK/existing.json"
else
  gh release create "$TAG" --repo "$REPO" --verify-tag --draft --latest=false --title "$TAG" --notes-file "$NOTES"
fi
while IFS= read -r -d '' asset; do gh release upload "$TAG" "$asset" --repo "$REPO" --clobber; done < "$WORK/assets.list"
if [[ "$MODE" == --publish ]]; then
  PRERELEASE=$(node --input-type=module -e 'import {pluginVersion} from "./scripts/provider-plugin-assets.mjs";console.log(pluginVersion(process.argv[1]).includes("-"))' "$TAG")
  gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease="$PRERELEASE" --latest=false --title "$TAG" --notes-file "$NOTES"
fi
echo "Plugin release prepared ($MODE): https://github.com/$REPO/releases/tag/$TAG ; application latest unchanged"
