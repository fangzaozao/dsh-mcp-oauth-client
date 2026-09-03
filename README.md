# dsh-mcp-oauth-client

一个面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的通用 MCP 管理与客户端桥接插件。虽然包名保留了 oauth 历史名称，但它同时支持有认证和无认证的 MCP 服务。

> 本插件面向 DeepSeek Harness 开发者预览版。DSH 仍在快速迭代，后续版本可能包含破坏性变更。使用前请阅读 [DSH 安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/SECURITY.md)。

## 功能

- 在 DSH「设置 → MCP」中可视化管理服务。
- 支持可流式 HTTP（Streamable HTTP）：无认证、OAuth 2.1 + PKCE、Bearer 令牌和自定义请求头。
- 支持本地标准输入输出（stdio）MCP：启动命令、参数、环境变量和工作目录均可配置。
- 支持添加、删除、启用、停用、重新连接和查看工具数量。
- OAuth 自动打开浏览器授权，并通过本机回调地址完成授权。
- 使用官方 MCP SDK 支持 OAuth 刷新令牌。

## 要求

- Node.js 20 或更高版本。
- 支持组合包和 Web 客户端扩展的 DSH 版本。

## 安装

### npm

```sh
dsh plugin --profile web add dsh-mcp-oauth-client
```

### 本地 tarball

```sh
pnpm pack
dsh plugin --profile web add ./dsh-mcp-oauth-client-0.3.0.tgz
```

### Git

从 Git 安装时会执行本包的 `prepare` 脚本。pnpm 10 及以上版本需要在 DSH profile 的 `pnpm-workspace.yaml` 中明确允许该构建脚本：

```yaml
allowBuilds:
  dsh-mcp-oauth-client: true
```

然后使用可信且固定的 commit 安装：

```sh
dsh plugin --profile web add github:OWNER/REPOSITORY#COMMIT_SHA
```

生产环境不要使用会变化的分支名。安装前请审查源码，并只对可信代码启用构建脚本。

## 使用

启动 Web profile，打开「设置 → MCP」，点击「添加服务器」。

HTTP 服务可选择以下认证方式：

- **无认证**：适用于公开或由网络层保护的端点。
- **OAuth 2.1 / PKCE**：支持动态注册，也支持填写客户端 ID 和客户端密钥。
- **Bearer 令牌**：发送 `Authorization: Bearer <token>`。
- **自定义请求头**：适用于 API Key 或服务商专用请求头。

stdio 服务需要填写可执行命令；命令参数每行填写一个，环境变量使用 `名称=值` 格式。

插件包只安装管理器，不内置默认 MCP 地址、凭据或本地命令。通过界面添加的服务会保存到当前 profile 的 `cordis.patch.yml`。

## 手动配置

HTTP OAuth 服务示例：

```yaml
- insert:
    - id: mcp-example
      name: dsh-mcp-oauth-client
      config:
        entryId: mcp-example
        manager: false
        serverName: example
        transport: streamable-http
        authType: oauth
        resourceUrl: https://mcp.example.com/mcp
```

stdio 服务示例：

```yaml
- insert:
    - id: mcp-files
      name: dsh-mcp-oauth-client
      config:
        entryId: mcp-files
        manager: false
        serverName: files
        transport: stdio
        command: npx
        args:
          - -y
          - '@modelcontextprotocol/server-filesystem'
          - /path/to/allowed/directory
```

只有管理器条目需要设置 `manager: true`；组合包提供的管理器已经承担该角色。

## 安全说明

界面中填写的凭据会以明文写入当前 DSH profile 的 `cordis.patch.yml`，请勿将该文件提交到 Git。OAuth 访问令牌和刷新令牌只保存在插件进程内存中，不会由本插件持久化。详见 [SECURITY.md](./SECURITY.md)。

## 开发与验证

```sh
pnpm install
pnpm run check
pnpm run pack:check
```

将当前工作目录安装到开发 profile：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-oauth-client
```

检查组合后的 profile：

```sh
dsh --profile web --dump-config
```

## 许可证

MIT

## 反馈与发现

欢迎在 [GitHub 仓库](https://github.com/fangzaozao/dsh-mcp-oauth-client) 提交反馈或 bug。仓库已使用 `dsh-plugin` 话题，便于在 DSH 社区中发现。
