#!/usr/bin/env python3
"""Fail closed unless a GHCR package is private and denies anonymous pulls."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def request_json(url, token=None):
    headers = {"User-Agent": "AIBuddy-Panel-private-release", "Accept": "application/json"}
    if url.startswith("https://api.github.com/"):
        headers["Accept"] = "application/vnd.github+json"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        # Never include the response body or credentials in CI logs.
        return error.code, None


def check_private(repository, token, allow_missing=False, fetch=request_json, package_name=None, require_owner=False):
    owner, name = repository.lower().split("/", 1)
    name = package_name or name
    if not token:
        raise ValueError("发布凭据未配置；请在仓库 Actions Secrets 设置 GHCR_PUBLISH_TOKEN")
    if require_owner:
        status, user = fetch("https://api.github.com/user", token)
        if status != 200 or user.get("login", "").lower() != owner:
            raise ValueError("必须使用镜像命名空间所有者的个人发布 Token，不能使用公开仓库的 GITHUB_TOKEN")
    url = f"https://api.github.com/users/{owner}/packages/container/{urllib.parse.quote(name, safe='')}"
    status, package = fetch(url, token)
    if status == 404 and allow_missing:
        result = "目标包不存在或尚不可访问，首次发布使用个人 Token 的默认 private 可见性"
    elif status != 200:
        raise ValueError(f"无法读取包的可见性（HTTP {status}），停止发布")
    elif package.get("visibility") != "private":
        raise ValueError("目标包不是 private；请使用新的私有镜像包名称，停止发布")
    else:
        result = "已确认包的 visibility=private"

    query = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{owner}/{name}:pull"})
    status, anonymous = fetch("https://ghcr.io/token?" + query)
    if status == 200:
        anonymous_token = anonymous.get("token") or anonymous.get("access_token")
        if not anonymous_token:
            raise ValueError("匿名认证响应缺少 token，无法确认访问限制")
        status, _ = fetch(f"https://ghcr.io/v2/{owner}/{name}/tags/list", anonymous_token)
    if status not in (401, 403, 404):
        raise ValueError(f"匿名访问未被明确拒绝（HTTP {status}），停止发布")
    return result + "；匿名访问被拒绝"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()
    try:
        print(check_private(os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_TOKEN"), args.allow_missing,
                            package_name=os.environ.get("GHCR_PACKAGE_NAME"),
                            require_owner=os.environ.get("GHCR_REQUIRE_OWNER") == "1"))
    except (ValueError, KeyError, urllib.error.URLError, TimeoutError) as error:
        print("私有 GHCR 检查失败：" + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
