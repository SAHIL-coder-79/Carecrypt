import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'
import Layout from './components/Layout.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import { LoadingState } from './components/ui.jsx'
import ClinicianArea from './pages/clinician/ClinicianArea.jsx'
import DashboardHome from './pages/clinician/DashboardHome.jsx'
import PatientsPage from './pages/clinician/PatientsPage.jsx'
import PatientWorkspace from './pages/clinician/PatientWorkspace.jsx'
import ScannerPage from './pages/clinician/ScannerPage.jsx'
import SmartCarePage from './pages/clinician/SmartCarePage.jsx'
import VisitsPage from './pages/clinician/VisitsPage.jsx'
import HomePage from './pages/HomePage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import AccessHistoryPage from './pages/patient/AccessHistoryPage.jsx'
import ConsentPage from './pages/patient/ConsentPage.jsx'
import PatientRecordPage from './pages/PatientRecordPage.jsx'
import AuditLogsPage from './pages/security/AuditLogsPage.jsx'
import SecurityDashboard from './pages/security/SecurityDashboard.jsx'
import SecurityEventsPage from './pages/security/SecurityEventsPage.jsx'

// The charting library is large; load it only for the analytics pages.
const PopulationDashboard = lazy(() => import('./pages/admin/PopulationDashboard.jsx'))
const DiseaseTrendsPage = lazy(() => import('./pages/admin/DiseaseTrendsPage.jsx'))
const PrivacyPage = lazy(() => import('./pages/admin/PrivacyPage.jsx'))
// Likewise the QR code generator for the patient card page.
const MyCardPage = lazy(() => import('./pages/patient/MyCardPage.jsx'))

const lazyPage = (Page) => (
  <Suspense fallback={<LoadingState />}>
    <Page />
  </Suspense>
)

// Routes are not filtered by role. Any signed-in user can navigate to any page;
// the API decides what data, if any, comes back. The sidebar only offers each
// role its own sections.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />

        <Route path="clinician" element={<ClinicianArea />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardHome />} />
          <Route path="dashboard/patients/:patientId" element={<LegacyWorkspaceRedirect />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/:patientId" element={<PatientWorkspace />} />
          <Route path="scan" element={<ScannerPage />} />
          <Route path="smartcare" element={<SmartCarePage />} />
          <Route path="visits" element={<VisitsPage />} />
        </Route>

        <Route path="admin/analytics" element={lazyPage(PopulationDashboard)} />
        <Route path="admin/trends" element={lazyPage(DiseaseTrendsPage)} />
        <Route path="admin/privacy" element={lazyPage(PrivacyPage)} />

        <Route path="security/dashboard" element={<SecurityDashboard />} />
        <Route path="security/events" element={<SecurityEventsPage />} />
        <Route path="security/audit" element={<AuditLogsPage />} />

        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:patientId" element={<PatientRecordPage />} />
        <Route path="patient/consent" element={<ConsentPage />} />
        <Route path="patient/access-history" element={<AccessHistoryPage />} />
        <Route path="patient/card" element={lazyPage(MyCardPage)} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

// Old workspace URLs keep working.
function LegacyWorkspaceRedirect() {
  const { patientId } = useParams()
  return <Navigate to={`/clinician/patients/${patientId}`} replace />
}
