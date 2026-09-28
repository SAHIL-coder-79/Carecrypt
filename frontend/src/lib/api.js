const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// An API response with a non-2xx status. `body` is the parsed JSON error, e.g.
// { error: 'FORBIDDEN', role, resource, access, reason }.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? body?.error ?? `Request failed with HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export async function apiRequest(path, { token, method = 'GET', body } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, { error: 'NETWORK_ERROR', message: 'Cannot reach the CareCrypt server.' })
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export function getHealth() {
  return apiRequest('/api/health')
}
