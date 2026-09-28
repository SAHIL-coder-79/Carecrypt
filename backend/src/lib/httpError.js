// An error with an HTTP status, a stable machine-readable code and a safe message.
// The central error handler turns it into { error: CODE, message }, or into
// `body` when a route needs a specific response shape.
export class HttpError extends Error {
  constructor(status, code, message, { headers, body } = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.headers = headers
    this.body = body
  }
}

export const badRequest = (message) => new HttpError(400, 'BAD_REQUEST', message)

// 401 responses carry a WWW-Authenticate challenge (RFC 6750).
export const unauthorized = (message, bearerError = 'invalid_token') =>
  new HttpError(401, 'UNAUTHORIZED', message, {
    headers: { 'WWW-Authenticate': `Bearer realm="carecrypt", error="${bearerError}"` },
  })

// 403 for an authenticated caller whose role is not allowed on the resource.
export const forbidden = ({ role, resource }) =>
  new HttpError(403, 'FORBIDDEN', `Role ${role} may not access ${resource}.`, {
    body: { error: 'FORBIDDEN', role, resource, access: 'DENIED' },
  })
