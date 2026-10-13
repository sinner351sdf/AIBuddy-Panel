# 私有 GHCR 发布与部署

镜像地址：`ghcr.io/sinner351sdf/aibuddy-panel`。

当前服务端基础版本为 3.0.2。首个定制发行标签采用
`v3.0.2-aibuddy.1`，镜像标签对应 `3.0.2-aibuddy.1`、
`v3.0.2-aibuddy.1` 和 `latest`。不移动或覆盖上游的版本标签。

## 发布

`.github/workflows/docker.yml` 只向 GHCR 推送 AMD64 / ARM64 镜像。
使用 Actions 的 `GITHUB_TOKEN`，无需配置 Docker Hub 凭据。
推送 `v*` 标签会触发发布；也可在 Actions 手动运行，输入匹配
Cargo 基础版本的发布版本，或留空只发布 `dev`。

发布前必须通过包可见性与匿名访问检查。新包默认 private；已有包
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
docker pull ghcr.io/sinner351sdf/aibuddy-panel:3.0.2-aibuddy.1
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
Actions 的构建步骤验证两个 Linux 架构，发布后的检查验证远端包
可见性；本地测试不作为远端发布成功的证明。
