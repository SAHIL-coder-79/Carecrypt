import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/context.js'

// Loads `path` from the API with the caller's token.
// Returns { data, error, loading, reload }. While reloading, the previous data
// for the same path stays available so the screen does not flash empty.
// Pass a falsy path to load nothing.
export function useApiData(path) {
  const { request } = useAuth()
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState(null)
  const key = path ? `${path}#${version}` : null

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    request(path)
      .then((data) => !cancelled && setResult({ key, path, data, error: null }))
      .catch((error) => !cancelled && setResult({ key, path, data: null, error }))
    return () => {
      cancelled = true
    }
  }, [key, path, request])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const samePath = result?.path === path

  return {
    data: samePath ? result.data : null,
    error: samePath ? result.error : null,
    loading: Boolean(key) && result?.key !== key,
    reload,
  }
}
