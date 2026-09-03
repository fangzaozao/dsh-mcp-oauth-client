window.__ModuleLoader__.load({
  id: 'dsh-mcp-oauth-client',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const RPC_CHANNEL = '/mcp-oauth-manager'
    const STYLE_ID = 'dsh-mcp-oauth-manager-styles'

    const phaseMeta = {
      idle: ['待连接', '#8a8f98', '#f1f3f5'],
      connecting: ['连接中', '#1677ff', '#e8f3ff'],
      authorizing: ['等待授权', '#d97706', '#fff4dc'],
      connected: ['已连接', '#16803c', '#e9f8ee'],
      disabled: ['已停用', '#737982', '#f1f3f5'],
      error: ['连接失败', '#d93025', '#fff0ef'],
    }

    async function callRpc(ctx, endpoint, payload = null) {
      const result = await ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
      if (result?.ok) return result.value
      throw new Error(result?.error?.message ?? 'MCP 管理接口调用失败')
    }

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        .mcp-oauth-page{padding:28px 30px;max-width:920px;color:var(--color-text, #202124)}
        .mcp-oauth-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
        .mcp-oauth-title{margin:0;font-size:25px;line-height:1.25;font-weight:650}
        .mcp-oauth-subtitle{margin:8px 0 0;color:var(--color-text-secondary, #737982);font-size:14px}
        .mcp-oauth-list{display:grid;gap:14px}.mcp-oauth-card{border:1px solid var(--color-border, #e2e4e8);border-radius:18px;padding:22px;background:var(--color-bg, #fff)}
        .mcp-oauth-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
        .mcp-oauth-name{font-size:19px;font-weight:650;overflow-wrap:anywhere}
        .mcp-oauth-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
        .mcp-oauth-dot{width:8px;height:8px;border-radius:50%;background:currentColor}
        .mcp-oauth-grid{display:grid;grid-template-columns:1fr 140px;gap:12px 24px;margin-top:22px;padding-top:20px;border-top:1px solid var(--color-border, #eceef1)}
        .mcp-oauth-label{font-size:12px;color:var(--color-text-secondary, #7a8089);margin-bottom:6px}
        .mcp-oauth-value{font-size:14px;line-height:1.5;overflow-wrap:anywhere}
        .mcp-oauth-tools{font-size:25px;font-weight:650}
        .mcp-oauth-message{margin-top:16px;padding:11px 13px;border-radius:10px;background:var(--color-bg-secondary, #f6f7f9);font-size:13px;line-height:1.45;overflow-wrap:anywhere}
        .mcp-oauth-actions{display:flex;gap:10px;margin-top:20px}
        .mcp-oauth-button{appearance:none;border:1px solid var(--color-border, #d9dce1);border-radius:10px;padding:9px 15px;background:var(--color-bg, #fff);color:inherit;font:inherit;font-size:14px;cursor:pointer}
        .mcp-oauth-button:hover{background:var(--color-bg-secondary, #f4f5f7)}
        .mcp-oauth-button.primary{border-color:#17191c;background:#17191c;color:#fff}
        .mcp-oauth-button.primary:hover{background:#303338}
        .mcp-oauth-button.danger{color:#d93025;border-color:#f0c7c4}
        .mcp-oauth-button:disabled{cursor:not-allowed;opacity:.55}
        .mcp-oauth-error{padding:14px;border:1px solid #ffd3d0;border-radius:12px;background:#fff4f3;color:#b3261e}
        .mcp-oauth-form{margin-bottom:18px;border:1px solid var(--color-border, #e2e4e8);border-radius:16px;padding:20px;background:var(--color-bg-secondary, #f8f9fa)}
        .mcp-oauth-form-title{font-size:17px;font-weight:650;margin-bottom:16px}.mcp-oauth-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .mcp-oauth-field.full{grid-column:1/-1}.mcp-oauth-input{box-sizing:border-box;width:100%;border:1px solid var(--color-border, #d9dce1);border-radius:9px;padding:10px 11px;background:var(--color-bg, #fff);color:inherit;font:inherit;font-size:14px;outline:none}
        .mcp-oauth-input:focus{border-color:#1677ff;box-shadow:0 0 0 2px rgba(22,119,255,.12)}.mcp-oauth-empty{text-align:center;padding:44px;color:var(--color-text-secondary, #737982)}
        @media(max-width:640px){.mcp-oauth-page{padding:20px 16px}.mcp-oauth-grid{grid-template-columns:1fr}.mcp-oauth-head{display:block}.mcp-oauth-head .mcp-oauth-button{margin-top:14px}}
      `
      document.head.appendChild(style)
    }

    function ManagerSection({ ctx }) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [showAdd, setShowAdd] = useState(false)
      const emptyForm = { serverName: '', transport: 'streamable-http', authType: 'none', resourceUrl: '', bearerToken: '', headersText: '', scope: '', clientId: '', clientSecret: '', command: '', argsText: '', envText: '', cwd: '' }
      const [form, setForm] = useState(emptyForm)

      const refresh = useCallback(async () => {
        try {
          setData(await callRpc(ctx, 'list'))
          setError('')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [ctx])

      useEffect(() => {
        let active = true
        const poll = async () => { if (active) await refresh() }
        void poll()
        const timer = setInterval(() => void poll(), 2000)
        return () => { active = false; clearInterval(timer) }
      }, [refresh])

      const operation = async (key, endpoint, payload) => {
        setBusy(key)
        try {
          await callRpc(ctx, endpoint, payload)
          await refresh()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const addServer = async (event) => {
        event.preventDefault()
        setBusy('add')
        try {
          const parseMap = (text, separator, label) => Object.fromEntries(String(text).split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
            const at = line.indexOf(separator)
            if (at < 1) throw new Error(`${label}格式错误：${line}`)
            return [line.slice(0, at).trim(), line.slice(at + separator.length).trim()]
          }))
          await callRpc(ctx, 'add', {
            ...form,
            args: form.argsText.split('\n').map((line) => line.trim()).filter(Boolean),
            env: parseMap(form.envText, '=', '环境变量'),
            headers: parseMap(form.headersText, ':', '请求头'),
          })
          setShowAdd(false)
          setForm(emptyForm)
          await refresh()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const field = (name, label, placeholder, full = false, type = 'text') => {
        const props = { className: 'mcp-oauth-input', name, value: form[name], placeholder, required: name === 'serverName' || name === 'resourceUrl' || name === 'command', onChange: (event) => setForm({ ...form, [name]: event.target.value }) }
        return h('label', { className: `mcp-oauth-field${full ? ' full' : ''}` },
          h('div', { className: 'mcp-oauth-label' }, label),
          type === 'textarea' ? h('textarea', { ...props, rows: 4 }) : h('input', { ...props, type }),
        )
      }

      const selectField = (name, label, options) => h('label', { className: 'mcp-oauth-field' },
        h('div', { className: 'mcp-oauth-label' }, label),
        h('select', { className: 'mcp-oauth-input', value: form[name], onChange: (event) => setForm({ ...form, [name]: event.target.value }) },
          ...options.map(([value, text]) => h('option', { value, key: value }, text)),
        ),
      )

      const serverCard = (status) => {
        const phase = status.enabled === false ? 'disabled' : status.phase ?? 'idle'
        const [phaseLabel, phaseColor, phaseBg] = phaseMeta[phase] ?? phaseMeta.idle
        return h('div', { className: 'mcp-oauth-card', key: status.id },
          h('div', { className: 'mcp-oauth-row' },
            h('div', { className: 'mcp-oauth-name' }, status.serverName),
            h('span', { className: 'mcp-oauth-badge', style: { color: phaseColor, background: phaseBg } }, h('span', { className: 'mcp-oauth-dot' }), phaseLabel),
          ),
          h('div', { className: 'mcp-oauth-grid' },
            h('div', null,
              h('div', { className: 'mcp-oauth-label' }, status.transport === 'stdio' ? '启动命令' : '服务地址'),
              h('div', { className: 'mcp-oauth-value' }, status.resourceUrl),
              h('div', { className: 'mcp-oauth-label', style: { marginTop: 7 } }, status.transport === 'stdio' ? 'stdio' : `Streamable HTTP · ${status.authType === 'oauth' ? 'OAuth' : status.authType === 'bearer' ? 'Bearer' : '无认证'}`),
            ),
            h('div', null, h('div', { className: 'mcp-oauth-label' }, '已注册工具'), h('div', { className: 'mcp-oauth-tools' }, String(status.toolCount ?? 0))),
          ),
          status.message && h('div', { className: 'mcp-oauth-message' }, status.message),
          h('div', { className: 'mcp-oauth-actions' },
            status.enabled !== false && h('button', { className: 'mcp-oauth-button primary', disabled: !!busy, onClick: () => operation(`reconnect:${status.id}`, 'reconnect', { serverName: status.serverName }) }, busy === `reconnect:${status.id}` ? '正在启动…' : '重新授权 / 重连'),
            status.userManaged && h('button', { className: 'mcp-oauth-button', disabled: !!busy, onClick: () => operation(`toggle:${status.id}`, 'setEnabled', { id: status.id, enabled: status.enabled === false }) }, status.enabled === false ? '启用' : '停用'),
            status.userManaged && h('button', { className: 'mcp-oauth-button danger', disabled: !!busy, onClick: () => { if (window.confirm(`删除 MCP 服务“${status.serverName}”？`)) void operation(`remove:${status.id}`, 'remove', { id: status.id }) } }, '删除'),
          ),
        )
      }

      return h('div', { className: 'mcp-oauth-page' },
        h('div', { className: 'mcp-oauth-head' },
          h('div', null,
            h('h2', { className: 'mcp-oauth-title' }, 'MCP 管理'),
            h('p', { className: 'mcp-oauth-subtitle' }, '管理 HTTP、OAuth、Bearer 和 stdio MCP 服务器。'),
          ),
          h('div', { className: 'mcp-oauth-actions', style: { marginTop: 0 } },
            h('button', { className: 'mcp-oauth-button', onClick: refresh, disabled: !!busy }, '刷新'),
            h('button', { className: 'mcp-oauth-button primary', onClick: () => setShowAdd(!showAdd), disabled: !!busy }, showAdd ? '取消' : '+ 添加服务器'),
          ),
        ),
        error && h('div', { className: 'mcp-oauth-error' }, error),
        showAdd && h('form', { className: 'mcp-oauth-form', onSubmit: addServer },
          h('div', { className: 'mcp-oauth-form-title' }, '添加 MCP 服务器'),
          h('div', { className: 'mcp-oauth-fields' },
            field('serverName', 'serverName', '例如 notion'),
            selectField('transport', '传输方式', [['streamable-http', 'Streamable HTTP'], ['stdio', 'stdio（本地命令）']]),
            form.transport === 'streamable-http' && selectField('authType', '认证方式', [['none', '无认证'], ['oauth', 'OAuth 2.1 / PKCE'], ['bearer', 'Bearer Token']]),
            form.transport === 'streamable-http' && field('resourceUrl', 'MCP 服务地址', 'https://example.com/mcp', true),
            form.transport === 'streamable-http' && form.authType === 'bearer' && field('bearerToken', 'Bearer Token', 'Token 内容（无需 Bearer 前缀）', true, 'password'),
            form.transport === 'streamable-http' && field('headersText', '自定义请求头（可选，每行 Key: Value）', 'X-API-Key: xxx', true, 'textarea'),
            form.transport === 'streamable-http' && form.authType === 'oauth' && field('scope', 'OAuth scope（可选）', '例如 tools.read'),
            form.transport === 'streamable-http' && form.authType === 'oauth' && field('clientId', 'Client ID（可选）', '支持动态注册时留空'),
            form.transport === 'streamable-http' && form.authType === 'oauth' && field('clientSecret', 'Client Secret（可选）', '', false, 'password'),
            form.transport === 'stdio' && field('command', '启动命令', '例如 npx', true),
            form.transport === 'stdio' && field('argsText', '命令参数（可选，每行一个）', '-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Documents', true, 'textarea'),
            form.transport === 'stdio' && field('envText', '环境变量（可选，每行 KEY=VALUE）', 'API_KEY=xxx', true, 'textarea'),
            form.transport === 'stdio' && field('cwd', '工作目录（可选）', '/Users/me/project', true),
          ),
          h('div', { className: 'mcp-oauth-actions' },
            h('button', { className: 'mcp-oauth-button primary', type: 'submit', disabled: !!busy }, busy === 'add' ? '正在添加…' : '添加并连接'),
          ),
        ),
        data && h('div', { className: 'mcp-oauth-list' }, ...(data.servers ?? []).map(serverCard)),
        data && !(data.servers ?? []).length && h('div', { className: 'mcp-oauth-card mcp-oauth-empty' }, '尚未配置 MCP 服务器'),
        !data && !error && h('div', { className: 'mcp-oauth-card' }, '正在读取连接状态…'),
      )
    }

    const inject = ['slots', 'connection']
    function apply(ctx) {
      ctx.effect(() => {
        injectStyles()
        return () => document.getElementById(STYLE_ID)?.remove()
      }, 'mcp-oauth-manager: styles')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'mcp',
        order: 18,
        label: () => 'MCP',
        inject: () => ({ ctx }),
      }, ManagerSection))
    }

    module.exports = { inject, apply }
    return module.exports
  },
})
