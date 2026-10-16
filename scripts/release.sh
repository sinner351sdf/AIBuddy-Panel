#!/usr/bin/env bash
# 发版收尾脚本：v* tag 的 build 工作流跑完后，一条命令挂上 GitHub Release。
#
#   bash scripts/release.sh vX.Y.Z            # 自动找该 tag 的成功 build run
#   bash scripts/release.sh vX.Y.Z <run-id>   # 或显式指定 run
#
# 做三件事：
#   1. 下载 Windows、macOS、Linux 双架构更新包及校验文件到临时目录；
#   2. 用 tag 所指提交的提交信息（= 更新日志，见 agent.md 第 5 节）创建 / 更新
#      GitHub Release 并挂全部附件；
#   3. 打印验收提示。
#
# 幂等可重跑：附件 `--clobber` 覆盖上传。

set -euo pipefail

TAG="${1:?用法: scripts/release.sh vX.Y.Z [build-run-id]}"
RUN_ID="${2:-}"

case "$TAG" in
  v*) ;;
  *) echo "错误: '$TAG' 不是 v* 形式的 tag" >&2; exit 1 ;;
esac

command -v gh   >/dev/null || { echo "错误: 未安装 gh CLI" >&2; exit 1; }
# gh 的 JSON 输出用 node 解析（不引入 jq 依赖，两端都有 node）
command -v node >/dev/null || { echo "错误: 未安装 node" >&2; exit 1; }

# gh 是 Go 程序：既不读 git 的 http.proxy，也不读 Windows 系统代理，只认代理
# 环境变量。本机 git 配了代理而 gh 没配，下面的下载安装包与上传附件都是大文件
# 传输，直连不稳时会中途失败 —— 故把 git 的代理透传给 gh。
# 只设 HTTPS_PROXY：gh 的请求（含附件上传下载）全是 HTTPS，实测不读 HTTP_PROXY。
# 从 git 读取而非写死端口，换代理只改 git 一处；git 未配代理就不设，退回直连
# （外部已显式设过时不覆盖）。
if [ -z "${HTTPS_PROXY:-}" ]; then
  # 按 git/curl 查找代理的顺序依次尝试，兼容这几种配置写法：
  #   http.<url>.proxy（按仓库配） / http.proxy / https.proxy
  # 只取 --get-urlmatch 会漏掉 https.proxy，只取 https.proxy 会漏掉前两种。
  GH_PROXY=$(git config --get-urlmatch http.proxy https://github.com || true)
  [ -n "$GH_PROXY" ] || GH_PROXY=$(git config --get https.proxy || true)
  if [ -n "$GH_PROXY" ]; then
    export HTTPS_PROXY="$GH_PROXY"
    echo "→ 已使用 Git 配置的 HTTPS 代理"
  fi
fi

# ── 1. 核对 tag、构建来源与完整附件 ──────────────────────────
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VALIDATOR="$SCRIPT_DIR/release-assets.mjs"
TAG_SHA=$(git rev-parse --verify "refs/tags/$TAG^{commit}")
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/a2a-release.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

validate_run() {
  gh api "repos/$REPO/actions/runs/$1" > "$WORK_DIR/run.json" || return 1
  gh api "repos/$REPO/actions/runs/$1/artifacts" > "$WORK_DIR/artifacts.json" || return 1
  node "$VALIDATOR" run "$WORK_DIR/run.json" "$WORK_DIR/artifacts.json" "$TAG_SHA" "$TAG" "$REPO"
}
if [ -z "$RUN_ID" ]; then
  echo "→ 查找 $TAG 对应提交的成功 build 工作流…"
  gh run list --repo "$REPO" --workflow=build --limit 30 --json databaseId > "$WORK_DIR/runs.json"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1])).forEach(r=>console.log(r.databaseId))' "$WORK_DIR/runs.json" > "$WORK_DIR/run-ids.txt"
  while IFS= read -r id; do
    if validate_run "$id"; then RUN_ID=$id; break; fi
  done < "$WORK_DIR/run-ids.txt"
  [ -n "$RUN_ID" ] || { echo "错误: 没找到提交一致且附件完整的成功构建" >&2; exit 1; }
else
  validate_run "$RUN_ID"
fi
echo "→ $REPO / build run: $RUN_ID / $TAG_SHA"

gh run download "$RUN_ID" --repo "$REPO" -D "$WORK_DIR/assets"
node "$VALIDATOR" assets "$WORK_DIR/assets" "$TAG" > "$WORK_DIR/assets.list"
ASSETS=()
while IFS= read -r -d '' file; do ASSETS+=("$file"); done < "$WORK_DIR/assets.list"
# 老版本允许只有桌面包；3.0.4 起双架构更新包及校验必须齐全。
if [ ! -d "$WORK_DIR/assets/linux-server-amd64" ]; then
  echo "提示: 历史版本未包含容器更新包，本次仅上传桌面安装包及总校验文件。"
fi

# ── 2. 更新日志 = tag 所指提交的提交信息 ──────────────────────
NOTES_FILE="$WORK_DIR/notes.txt"
git log -1 --format=%B "$TAG" > "$NOTES_FILE"

echo "→ GitHub Release（全部附件已校验）"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO" --clobber "${ASSETS[@]}"
  echo "  ↳ 已存在，附件覆盖上传"
else
  gh release create "$TAG" --repo "$REPO" --verify-tag --title "$TAG" --notes-file "$NOTES_FILE" "${ASSETS[@]}"
fi

# ── 3. 验收提示 ───────────────────────────────────────────────
echo
echo "发版收尾完成。核对："
echo "  [1] GitHub Release: https://github.com/$REPO/releases/tag/$TAG"
echo "  [2] Windows / macOS 安装包版本与 $TAG 一致"
echo "  [3] Linux amd64 / arm64 更新包、对应 .sha256 与 SHA256SUMS.txt 齐全"
echo "  [4] 本脚本不发布镜像；镜像沿用本仓库既有私有发布策略"
