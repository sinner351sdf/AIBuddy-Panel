# 私有 GHCR 发布与部署

镜像地址：`ghcr.io/sinner351sdf/aibuddy-panel-private`。

当前服务端基础版本为 3.0.2。私有定制发行标签采用
`v3.0.2-aibuddy.2`，镜像标签对应 `3.0.2-aibuddy.2`、
`v3.0.2-aibuddy.2` 和 `latest`。不移动或覆盖上游的版本标签。

## 发布

`.github/workflows/docker.yml` 只向 GHCR 推送 AMD64 / ARM64 镜像。
使用账号所有者的 classic PAT，在仓库 Actions Secrets 中保存为
`GHCR_PUBLISH_TOKEN`，授予 `read:packages`、`write:packages`。
不要使用公开仓库的 `GITHUB_TOKEN` 创建新包：本次实际发布证明
该路径会继承公开仓库的可见性。无需配置 Docker Hub 凭据。
推送 `v*` 标签会触发发布；也可在 Actions 手动运行，输入匹配
Cargo 基础版本的发布版本，或留空只发布 `dev`。

发布前必须通过包可见性与匿名访问检查。个人 Token 创建新包默认 private；已有包
必须为 private，公开包会阻止发布。发布后再次验证
`visibility=private` 和匿名拉取被拒绝。检查出错时工作流失败，
不能将网络失败或权限不足当作私有性证明。

若历史包已公开，GitHub 不允许将其重新设为 private，需采用新的
镜像包名称。不要把这个包设置为 Public。

## 服务器拉取

在 GitHub 为部署创建 classic PAT，仅授予 `read:packages`，
并确保 Token 所属账号具有该包的读取权限。凭据只在部署机器上
输入或由其 Secret 管理工具提供，不提交到 Git，也不写入镜像。

```sh
docker login ghcr.io -u sinner351sdf
# 在 Password 提示中输入 PAT（不是 GitHub 登录密码）。
docker pull ghcr.io/sinner351sdf/aibuddy-panel-private:3.0.2-aibuddy.2
```

部署时使用上述固定标签，或发布结果中的 SHA256 digest，便于回滚。
容器需挂载持久化目录到 `/data`；管理员和网关 Key 由环境变量
或面板设置，不包含在发行镜像内。

当前 `docker-compose.yml` 仍使用本地源码构建。发布镜像不会替换
现有服务，部署私有镜像需另行配置 Compose 的 `image` 并去掉 `build`。
启动新实例时不要将公网端口开放后再设置管理员和网关 Key。

## 验证

`python3 scripts/test-ghcr-private.py` 覆盖新包、私有包、公开包、
匿名访问、缺少凭据、权限不足和网络错误等发布判断。
额外检查发布 Token 属于 sinner351sdf，拒绝使用 Actions 机器人
身份创建新包；移除 OCI source 标签，避免私有包继承公开仓库权限。
Actions 的构建步骤验证两个 Linux 架构，发布后的检查验证远端包
可见性；本地测试不作为远端发布成功的证明。

## 首次发行兼容性修正

`v3.0.2-aibuddy.1` 首次构建推送成功，但发布后的检查检测到公开
可见性，工作流失败。该公开包经批准后由专用清理流程核对创建时间、摘要
和标签，已成功删除，私有发布改用新的 `aibuddy-panel-private` 包名称。
一次性清理工作流在成功后移除，避免后续发布再次执行删除。
GitHub Actions 文档明确说明 GITHUB_TOKEN 创建的包可能继承仓库
可见性，不能仅凭“新包默认私有”推断发布成功。
