export type McpTransport = 'streamable-http' | 'stdio'
export type McpAuthType = 'none' | 'oauth' | 'bearer'

export interface Config {
  managerOnly?: boolean
  manager?: boolean
  entryId?: string
  serverName?: string
  transport?: McpTransport
  authType?: McpAuthType
  resourceUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  headers?: Record<string, string>
  bearerToken?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  toolCallTimeoutMs?: number
  patchFile?: string
  managedBy?: string
}

export declare const name: 'dsh-mcp-oauth-client'
export declare const inject: readonly ['tools', 'connection']
export declare const Config: unknown
export declare function apply(ctx: any, config?: Config): void
