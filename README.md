# dsh-mcp-oauth-client

A universal MCP manager and client bridge for [DeepSeek Harness (DSH)]. Despite
the historical package name, the plugin supports both authenticated and
unauthenticated MCP servers.

## Features

- Visual MCP management in **Settings → MCP**
- Streamable HTTP with no authentication, OAuth 2.1 + PKCE, Bearer tokens, or
  custom request headers
- Local stdio MCP servers with command, arguments, environment variables, and
  working-directory configuration
- Add, remove, enable, disable, reconnect, and inspect registered tool counts
- Automatic OAuth browser authorization and loopback callback handling
- OAuth refresh-token support through the official MCP SDK

## Requirements

- Node.js 20 or newer
- A DSH version that supports bundle plugins and web client contributions

## Install

### npm

```sh
dsh plugin --profile web add dsh-mcp-oauth-client
```

### Local tarball

```sh
pnpm pack
dsh plugin --profile web add ./dsh-mcp-oauth-client-0.3.0.tgz
```

### Git

Git dependencies run this package's `prepare` script. With pnpm 10 or newer,
the user must explicitly allow that script in the DSH profile's
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-mcp-oauth-client: true
```

Then install a trusted, pinned commit:

```sh
dsh plugin --profile web add github:OWNER/REPOSITORY#COMMIT_SHA
```

Review the source before enabling a Git dependency's build script. Do not use a
moving branch name for production installations.

## Use

Start the web profile, open **Settings → MCP**, and select **Add server**.

For Streamable HTTP, choose one authentication mode:

- **None** — public or network-protected endpoint
- **OAuth 2.1 / PKCE** — dynamic registration or an explicit client ID/secret
- **Bearer Token** — a static token sent as `Authorization: Bearer ...`
- **Custom headers** — API keys or provider-specific headers

For stdio, provide the executable and put one argument on each line. Environment
variables use one `KEY=VALUE` pair per line.

The bundle only installs the manager. It intentionally ships without a default
MCP endpoint, credential, or local command. Servers added in the UI are stored
in the active profile's `cordis.patch.yml`.

## Direct configuration

An HTTP OAuth entry can also be added to the profile patch manually:

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

A stdio entry looks like this:

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

Only one entry should have `manager: true`; the bundle-provided manager already
fills that role.

## Security

Credentials entered in the UI are written in plain text to the active DSH
profile's `cordis.patch.yml`. Never commit that profile file. OAuth access and
refresh tokens are held in memory and are not persisted by this plugin. See
[SECURITY.md](./SECURITY.md).

## Development

```sh
pnpm install
pnpm run check
pnpm run pack:check
```

Install the working directory into a development profile:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-oauth-client
```

Verify the composed profile:

```sh
dsh --profile web --dump-config
```

## License

MIT

[DeepSeek Harness (DSH)]: https://github.com/deepseek-ai/deepseek-harness
