import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/context.js'

// Sends signed-out users to the login page. This is navigation only: every API
// call is still authorised by the server.
export default function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
