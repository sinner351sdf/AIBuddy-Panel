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
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        # Never include the response body or credentials in CI logs.
        return error.code, None


def check_private(repository, token, allow_missing=False, fetch=request_json):
    owner, name = repository.lower().split("/", 1)
    if not token:
        raise ValueError("GITHUB_TOKEN 未配置，无法确认私有性")
    url = f"https://api.github.com/users/{owner}/packages/container/{urllib.parse.quote(name, safe='')}"
    status, package = fetch(url, token)
    if status == 404 and allow_missing:
        result = "目标包不存在或尚不可访问，首次发布将采用 GHCR 默认的 private 可见性"
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
        print(check_private(os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_TOKEN"), args.allow_missing))
    except (ValueError, KeyError, urllib.error.URLError, TimeoutError) as error:
        print("私有 GHCR 检查失败：" + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
