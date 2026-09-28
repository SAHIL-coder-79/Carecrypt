import {
  BarChartIcon,
  ClipboardIcon,
  DashboardIcon,
  FileTextIcon,
  HistoryIcon,
  KeyIcon,
  QrIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparkIcon,
  TrendIcon,
  UserIcon,
  UsersIcon,
  AlertTriangleIcon,
} from '../components/icons.jsx'

// Navigation per role. This only decides what the menu offers: every page can be
// opened by URL, and the server decides whether any data comes back.
export function navigationFor(user) {
  switch (user?.role) {
    case 'CLINICIAN':
      return [
        { to: '/clinician/dashboard', label: 'Dashboard', icon: DashboardIcon },
        { to: '/clinician/patients', label: 'Patients', icon: UsersIcon },
        { to: '/clinician/scan', label: 'QR Scanner', icon: QrIcon },
        { to: '/clinician/smartcare', label: 'SmartCare', icon: SparkIcon },
        { to: '/clinician/visits', label: 'Visits', icon: ClipboardIcon },
      ]
    case 'ADMIN':
      return [
        { to: '/admin/analytics', label: 'Population Dashboard', icon: BarChartIcon },
        { to: '/admin/trends', label: 'Disease Trends', icon: TrendIcon },
        { to: '/admin/privacy', label: 'Privacy', icon: ShieldCheckIcon },
      ]
    case 'SECURITY_ADMIN':
      return [
        { to: '/security/dashboard', label: 'Security Dashboard', icon: ShieldAlertIcon },
        { to: '/security/audit', label: 'Audit Logs', icon: FileTextIcon },
        { to: '/security/events', label: 'Security Events', icon: AlertTriangleIcon },
      ]
    case 'PATIENT':
      return [
        { to: user.patientId ? `/patients/${user.patientId}` : '/', label: 'My Record', icon: UserIcon },
        { to: '/patient/consent', label: 'Consent', icon: KeyIcon },
        { to: '/patient/access-history', label: 'Access History', icon: HistoryIcon },
      ]
    default:
      return []
  }
}

export function homePathFor(user) {
  if (user?.role === 'PATIENT') return user.patientId ? `/patients/${user.patientId}` : '/'
  return navigationFor(user)[0]?.to ?? '/'
}

// Pages that belong to other roles, offered so anyone can see the server refuse
// them. Nothing is hidden for security: the API is the boundary.
export const OTHER_ROLE_PAGES = [
  { role: 'CLINICIAN', to: '/patients', label: 'Clinician: patient list' },
  { role: 'ADMIN', to: '/admin/analytics', label: 'Admin: population analytics' },
  { role: 'SECURITY_ADMIN', to: '/security/audit', label: 'Security: audit logs' },
  { role: 'PATIENT', to: '/patient/access-history', label: 'Patient: access history' },
]
