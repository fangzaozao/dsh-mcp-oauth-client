# Security

## Credential storage

Bearer tokens, OAuth client secrets, custom headers, and stdio environment
variables entered in the management UI are stored as plain text in the active
DSH profile's `cordis.patch.yml`. Restrict access to that file and never commit
it to a repository.

OAuth access and refresh tokens obtained at runtime are held in memory and are
not persisted by this plugin.

## Reporting a vulnerability

Please report security issues privately to the repository maintainer. Do not
include live tokens, client secrets, or private MCP endpoints in a public issue.
