import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { URL } from 'node:url'
import yaml from 'js-yaml'
import z from '@deepseek-ai/schemastery'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

export const name = 'dsh-mcp-oauth-client'
export const inject = ['tools', 'connection']

export const Config = z.object({
  managerOnly: z.boolean().default(false),
  manager: z.boolean().default(false),
  entryId: z.string().required(false),
  serverName: z.string().default('mcp'),
  transport: z.union(['streamable-http', 'stdio']).default('streamable-http'),
  authType: z.union(['none', 'oauth', 'bearer']).default('oauth'),
  resourceUrl: z.string().required(false),
  command: z.string().required(false),
  args: z.array(z.string()).default([]),
  env: z.dict(z.string(), z.string()).default({}),
  cwd: z.string().required(false),
  headers: z.dict(z.string(), z.string()).default({}),
  bearerToken: z.string().required(false),
  clientId: z.string().required(false),
  clientSecret: z.string().required(false),
  scope: z.string().required(false),
  toolCallTimeoutMs: z.number().step(1).min(1).default(60000),
  patchFile: z.string().required(false),
  managedBy: z.string().required(false),
})

const RPC_CHANNEL = '/mcp-oauth-manager'
const MANAGED_MARKER = 'dsh-mcp-oauth-manager'
const REGISTRY_KEY = Symbol.for('dsh-mcp-oauth-client.registry')

const MAX_TOOL_NAME = 64

function registry() {
  if (!globalThis[REGISTRY_KEY]) globalThis[REGISTRY_KEY] = new Map()
  return globalThis[REGISTRY_KEY]
}

function patchPath(config) {
  return config?.patchFile || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml')
}

function readPatch(file) {
  if (!existsSync(file)) return []
  const value = yaml.load(readFileSync(file, 'utf8'))
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`MCP patch must be an array: ${file}`)
  return value
}

function writePatch(file, rows) {
  mkdirSync(dirname(file), { recursive: true })
  const body = rows.length ? yaml.dump(rows, { lineWidth: 120, noRefs: true }) : '[]\n'
  writeFileSync(file, `# MCP servers managed by dsh-mcp-oauth-client.\n${body}`, 'utf8')
}

function managedEntries(rows) {
  const result = []
  for (const row of rows) {
    const entries = Array.isArray(row?.insert) ? row.insert : [row]
    for (const entry of entries) {
      if (entry?.name === 'dsh-mcp-oauth-client' && entry?.config?.managedBy === MANAGED_MARKER) result.push(entry)
    }
  }
  return result
}

function editManagedEntry(rows, id, edit) {
  const next = []
  for (const row of rows) {
    if (Array.isArray(row?.insert)) {
      const insert = row.insert.flatMap((entry) => entry?.id === id && entry?.config?.managedBy === MANAGED_MARKER ? edit(entry) : [entry])
      if (insert.length) next.push({ ...row, insert })
    } else if (row?.id === id && row?.config?.managedBy === MANAGED_MARKER) {
      next.push(...edit(row))
    } else {
      next.push(row)
    }
  }
  return next
}

function validateServerInput(value) {
  const serverName = String(value?.serverName ?? '').trim()
  const transport = value?.transport === 'stdio' ? 'stdio' : 'streamable-http'
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) throw new Error('serverName 只能包含字母、数字、_、-，长度 1–32')
  if (transport === 'stdio') {
    const command = String(value?.command ?? '').trim()
    if (!command) throw new Error('stdio MCP 必须填写启动命令')
    return {
      serverName,
      transport,
      command,
      args: Array.isArray(value?.args) ? value.args.map(String).filter(Boolean) : [],
      env: value?.env && typeof value.env === 'object' ? value.env : {},
      ...(String(value?.cwd ?? '').trim() ? { cwd: String(value.cwd).trim() } : {}),
    }
  }
  const resourceUrl = String(value?.resourceUrl ?? '').trim()
  const parsed = new URL(resourceUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('服务地址必须使用 http 或 https')
  const authType = ['none', 'oauth', 'bearer'].includes(value?.authType) ? value.authType : 'none'
  const bearerToken = String(value?.bearerToken ?? '').trim()
  if (authType === 'bearer' && !bearerToken) throw new Error('Bearer 认证必须填写 Token')
  return {
    serverName, transport, resourceUrl, authType,
    headers: value?.headers && typeof value.headers === 'object' ? value.headers : {},
    ...(bearerToken ? { bearerToken } : {}),
    ...(String(value?.scope ?? '').trim() ? { scope: String(value.scope).trim() } : {}),
    ...(String(value?.clientId ?? '').trim() ? { clientId: String(value.clientId).trim() } : {}),
    ...(String(value?.clientSecret ?? '').trim() ? { clientSecret: String(value.clientSecret).trim() } : {}),
  }
}

function toolName(serverName, rawName) {
  const value = `mcp__${serverName}__${rawName}`.replace(/[^A-Za-z0-9_-]/g, '_')
  return value.slice(0, MAX_TOOL_NAME)
}

function visibleText(content, fallback) {
  if (!Array.isArray(content)) return fallback
  const lines = content
    .filter((item) => item && typeof item === 'object' && item.type === 'text')
    .map((item) => String(item.text ?? ''))
    .filter(Boolean)
  return lines.length ? lines.join('\n') : fallback
}

class CallbackBroker {
  constructor(logger) {
    this.logger = logger
    this.queue = []
    this.waiters = []
  }

  async start() {
    this.server = createServer((req, res) => this.handle(req, res))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Could not allocate OAuth callback port')
    this.redirectUrl = `http://127.0.0.1:${address.port}/oauth/callback`
    return this.redirectUrl
  }

  setExpectedState(state) {
    this.expectedState = state
  }

  nextCode() {
    if (this.queue.length) return Promise.resolve(this.queue.shift())
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  deliver(code) {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(code)
    else this.queue.push(code)
  }

  fail(error) {
    const waiter = this.waiters.shift()
    if (waiter) waiter.reject(error)
    else this.logger.error(error.message)
  }

  handle(req, res) {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (requestUrl.pathname !== '/oauth/callback') {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const error = requestUrl.searchParams.get('error')
    const code = requestUrl.searchParams.get('code')
    const state = requestUrl.searchParams.get('state')
    if (error) {
      const failure = new Error(`OAuth authorization failed: ${error}`)
      this.fail(failure)
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<h2>DSH OAuth 授权失败</h2><p>可以关闭此窗口。</p>')
      return
    }
    if (!code || !state || state !== this.expectedState) {
      const failure = new Error('OAuth callback is missing a valid code/state pair')
      this.fail(failure)
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<h2>DSH OAuth 回调无效</h2><p>code 或 state 校验失败。</p>')
      return
    }

    this.expectedState = undefined
    this.deliver(code)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h2>DSH OAuth 授权成功</h2><p>可以关闭此窗口并返回 DSH。</p><script>setTimeout(() => window.close(), 1200)</script>')
  }

  close() {
    this.server?.close()
    const error = new Error('OAuth callback server stopped')
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }
}

class OAuthProvider {
  constructor(config, redirectUrl, broker, logger) {
    this.redirectUrl = redirectUrl
    this.broker = broker
    this.logger = logger
    this.clientMetadata = {
      client_name: config.clientName ?? 'DSH MCP OAuth Client',
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: config.clientSecret ? 'client_secret_post' : 'none',
      ...(config.scope ? { scope: config.scope } : {}),
    }
    if (config.clientId) {
      this.clientInfo = {
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      }
    }
  }

  async state() {
    const value = randomBytes(24).toString('hex')
    this.broker.setExpectedState(value)
    return value
  }

  clientInformation() { return this.clientInfo }
  saveClientInformation(value) { this.clientInfo = value }
  tokens() { return this.oauthTokens }
  saveTokens(value) { this.oauthTokens = value }
  saveCodeVerifier(value) { this.verifier = value }
  codeVerifier() {
    if (!this.verifier) throw new Error('OAuth PKCE verifier is missing')
    return this.verifier
  }
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') this.clientInfo = undefined
    if (scope === 'all' || scope === 'tokens') this.oauthTokens = undefined
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined
  }
  redirectToAuthorization(url) {
    this.logger.info('Opening OAuth authorization page: %s', String(url))
    spawn('open', [String(url)], { detached: true, stdio: 'ignore' }).unref()
  }
}

function createTransport(config, provider) {
  if (config.transport === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args : [],
      ...(config.env && Object.keys(config.env).length ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: 'pipe',
    })
  }
  const headers = { ...(config.headers ?? {}) }
  if (config.authType === 'bearer' && config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`
  return new StreamableHTTPClientTransport(new URL(config.resourceUrl), {
    ...(provider ? { authProvider: provider } : {}),
    ...(Object.keys(headers).length ? { requestInit: { headers } } : {}),
  })
}

function looksLikeAuthFailure(error) {
  if (error instanceof UnauthorizedError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /(?:401|unauthori[sz]ed|bearer\s+token|缺少\s*bearer)/i.test(message)
}

async function completeAuthorization(resourceUrl, provider, broker, transport, logger, alreadyRedirected) {
  if (!alreadyRedirected) {
    const result = await auth(provider, { serverUrl: resourceUrl })
    if (result === 'AUTHORIZED') return
  }
  logger.info('OAuth authorization is required; waiting for browser callback')
  const code = await broker.nextCode()
  await transport.finishAuth(code)
}

async function connect(config, provider, broker, logger) {
  const open = async () => {
    const client = new Client({ name, version: '0.2.0' }, { capabilities: {} })
    const transport = createTransport(config, provider)
    try {
      await client.connect(transport)
      return { client, transport }
    } catch (error) {
      await client.close().catch(() => {})
      if (!provider || !broker || !looksLikeAuthFailure(error)) throw error
      await completeAuthorization(config.resourceUrl, provider, broker, transport, logger, error instanceof UnauthorizedError)
      return open()
    }
  }
  return open()
}

function definition(client, transport, provider, broker, resourceUrl, serverName, tool, timeoutMs, logger) {
  const publicName = toolName(serverName, tool.name)
  return {
    name: publicName,
    description: tool.description ?? '',
    parameters: tool.inputSchema,
    output: {
      schema: {
        type: 'object',
        properties: { content: { type: 'array', items: {} }, structuredContent: {} },
        required: ['content'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: visibleText(value.content, `(${tool.name} returned no text)`) }]
      },
    },
    async execute(args, exec) {
      const call = () => client.callTool(
        { name: tool.name, arguments: args && typeof args === 'object' ? args : {} },
        undefined,
        { signal: exec.signal, timeout: timeoutMs },
      )
      let result
      try {
        result = await call()
      } catch (error) {
        if (!provider || !broker || !looksLikeAuthFailure(error)) throw error
        await completeAuthorization(resourceUrl, provider, broker, transport, logger, error instanceof UnauthorizedError)
        result = await call()
      }
      if (result.isError) throw new Error(visibleText(result.content, `MCP tool ${tool.name} failed`))
      return {
        content: Array.isArray(result.content) ? result.content : [],
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      }
    },
  }
}

export function apply(ctx, config) {
  const managerOnly = config?.managerOnly === true
  const serverName = config?.serverName ?? 'sunon'
  const transportType = config?.transport === 'stdio' ? 'stdio' : 'streamable-http'
  const authType = transportType === 'stdio' ? 'none' : (config?.authType ?? 'oauth')
  const resourceUrl = config?.resourceUrl
  const runtimeConfig = { ...(config ?? {}), transport: transportType, authType }
  const entryId = config?.entryId ?? `mcp-oauth-${serverName}`
  const isManager = config?.manager !== false
  const file = patchPath(config)
  const timeoutMs = config?.toolCallTimeoutMs ?? 60000
  if (!managerOnly && transportType === 'streamable-http' && !resourceUrl) throw new Error('dsh-mcp-oauth-client: config.resourceUrl is required')
  if (!managerOnly && transportType === 'stdio' && !config?.command) throw new Error('dsh-mcp-oauth-client: config.command is required for stdio')
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) throw new Error('dsh-mcp-oauth-client: invalid serverName')

  const logger = ctx.logger(`mcp:${serverName}`)
  const status = {
    id: entryId,
    serverName,
    transport: transportType,
    authType,
    resourceUrl: resourceUrl ?? config?.command,
    enabled: true,
    userManaged: config?.managedBy === MANAGED_MARKER,
    phase: 'idle',
    toolCount: 0,
    message: '',
    updatedAt: Date.now(),
  }
  let broker
  let client
  let disposers = []
  let disposed = false
  let runId = 0
  const controls = { status, reconnect: () => launch() }

  const updateStatus = (phase, message = '') => {
    status.phase = phase
    status.message = message
    status.updatedAt = Date.now()
  }

  const clearRuntime = () => {
    broker?.close()
    broker = undefined
    for (const dispose of disposers) dispose()
    disposers = []
    status.toolCount = 0
    void client?.close()
    client = undefined
  }

  const syncTools = async (transport, provider) => {
    const next = []
    let cursor
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      for (const tool of page.tools) {
        next.push(ctx.tools.register(definition(client, transport, provider, broker, resourceUrl, serverName, tool, timeoutMs, logger)))
      }
      cursor = page.nextCursor
    } while (cursor)
    for (const dispose of disposers) dispose()
    disposers = next
    status.toolCount = disposers.length
    updateStatus('connected', `${disposers.length} tools`)
    logger.info('Registered %d MCP tools for %s', disposers.length, serverName)
  }

  const launch = async () => {
    const currentRun = ++runId
    clearRuntime()
    updateStatus('connecting')
    try {
      let provider
      if (transportType === 'streamable-http' && authType === 'oauth') {
        broker = new CallbackBroker(logger)
        const redirectUrl = await broker.start()
        provider = new OAuthProvider(runtimeConfig, redirectUrl, broker, logger)
      }
      const connectionPromise = connect(runtimeConfig, provider, broker, logger)
      setTimeout(() => {
        if (currentRun === runId && status.phase === 'connecting') {
          updateStatus(authType === 'oauth' ? 'authorizing' : 'connecting', authType === 'oauth' ? 'Waiting for OAuth or MCP response' : 'Connecting to MCP server')
        }
      }, 600)
      const connection = await connectionPromise
      if (disposed || currentRun !== runId) {
        await connection.client.close()
        return
      }
      client = connection.client
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        void syncTools(connection.transport, provider).catch((error) => {
          updateStatus('error', String(error))
          logger.error('Tool resync failed: %s', String(error))
        })
      })
      await syncTools(connection.transport, provider)
    } catch (error) {
      if (disposed || currentRun !== runId) return
      const message = error instanceof Error ? error.message : String(error)
      updateStatus('error', message)
      logger.error('MCP startup failed: %s', error instanceof Error ? error.stack ?? error.message : String(error))
    }
  }

  ctx.effect(() => {
    if (!managerOnly) registry().set(serverName, controls)
    const stopRpc = isManager ? ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
      try {
        if (endpoint === 'status' || endpoint === 'list') {
          const rows = readPatch(file)
          const managed = new Map(managedEntries(rows).map((entry) => [entry.config.serverName, entry]))
          const servers = Array.from(registry().values()).map(({ status: item }) => ({
            ...item,
            enabled: managed.has(item.serverName) ? managed.get(item.serverName).disabled !== true : true,
          }))
          for (const entry of managed.values()) {
            if (!registry().has(entry.config.serverName)) {
              servers.push({
                id: entry.id,
                serverName: entry.config.serverName,
                transport: entry.config.transport ?? 'streamable-http',
                authType: entry.config.authType ?? 'none',
                resourceUrl: entry.config.resourceUrl ?? entry.config.command,
                enabled: entry.disabled !== true,
                userManaged: true,
                phase: entry.disabled === true ? 'disabled' : 'idle',
                toolCount: 0,
                message: '',
                updatedAt: Date.now(),
              })
            }
          }
          return { ok: true, value: { servers, patchFile: file } }
        }
        if (endpoint === 'add') {
          const input = validateServerInput(payload)
          const rows = readPatch(file)
          if (input.serverName === serverName || managedEntries(rows).some((entry) => entry.config.serverName === input.serverName)) {
            throw new Error(`serverName “${input.serverName}” 已存在`)
          }
          const id = `mcp-oauth-${input.serverName}`
          if (rows.some((row) => row?.id === id || row?.insert?.some?.((entry) => entry?.id === id))) throw new Error(`条目 ID “${id}” 已存在`)
          rows.push({ insert: [{
            id,
            name: 'dsh-mcp-oauth-client',
            config: { ...input, entryId: id, manager: false, managedBy: MANAGED_MARKER },
          }] })
          writePatch(file, rows)
          return { ok: true, value: { id } }
        }
        if (endpoint === 'remove') {
          const id = String(payload?.id ?? '')
          const rows = readPatch(file)
          if (!managedEntries(rows).some((entry) => entry.id === id)) throw new Error('只能删除在此界面添加的 MCP 服务')
          writePatch(file, editManagedEntry(rows, id, () => []))
          return { ok: true, value: { id } }
        }
        if (endpoint === 'setEnabled') {
          const id = String(payload?.id ?? '')
          const enabled = payload?.enabled === true
          const rows = readPatch(file)
          if (!managedEntries(rows).some((entry) => entry.id === id)) throw new Error('只能停用在此界面添加的 MCP 服务')
          writePatch(file, editManagedEntry(rows, id, (entry) => [{ ...entry, disabled: !enabled }]))
          return { ok: true, value: { id, enabled } }
        }
        if (endpoint === 'reconnect' || endpoint === 'reauthorize') {
          const target = endpoint === 'reauthorize' ? serverName : String(payload?.serverName ?? '')
          const control = registry().get(target)
          if (!control) throw new Error(`MCP 服务 “${target}” 当前未运行`)
          void control.reconnect()
          return { ok: true, value: { started: true } }
        }
        return { ok: false, error: { code: 'unknown-endpoint', message: String(endpoint), details: {} } }
      } catch (error) {
        return { ok: false, error: { code: 'operation-failed', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    }, { authority: 'loopback' }) : undefined
    if (!managerOnly) void launch()
    return () => {
      disposed = true
      runId += 1
      clearRuntime()
      if (!managerOnly && registry().get(serverName) === controls) registry().delete(serverName)
      if (stopRpc) void stopRpc()
    }
  }, `dsh-mcp-oauth:${serverName}`)
}
