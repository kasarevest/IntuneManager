import { useEffect } from 'react'
import {
  createHashRouter,
  RouterProvider,
  Navigate,
  Outlet,
  useNavigate,
  useLocation
} from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TenantProvider } from './contexts/TenantContext'
import { ipcAuthFirstRunCheck } from './lib/api'

import Login from './pages/Login'
import FirstRun from './pages/FirstRun'
import Dashboard from './pages/Dashboard'
import InstalledApps from './pages/InstalledApps'
import Deploy from './pages/Deploy'
import AppCatalog from './pages/AppCatalog'
import Devices from './pages/Devices'
import Settings from './pages/Settings'
import NewUserSetup from './pages/NewUserSetup'
import GeneralTab from './settings/GeneralTab'
import TenantTab from './settings/TenantTab'
import UsersTab from './settings/UsersTab'

// Guard: redirect to /login if not authenticated; redirect mustChangePassword users to /new-user-setup
function RequireAuth() {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/login', { replace: true })
    } else if (!isLoading && user?.mustChangePassword && location.pathname !== '/new-user-setup') {
      navigate('/new-user-setup', { replace: true })
    }
  }, [user, isLoading, navigate, location.pathname])

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-400)' }}>
        Loading...
      </div>
    )
  }

  return user ? <Outlet /> : null
}

// Root: check first-run on every startup
function Root() {
  const navigate = useNavigate()

  useEffect(() => {
    const check = async () => {
      const res = await ipcAuthFirstRunCheck()
      if (res.isFirstRun) {
        navigate('/first-run', { replace: true })
      } else {
        navigate('/login', { replace: true })
      }
    }
    check()
  }, [navigate])

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-400)' }}>
      Starting...
    </div>
  )
}

const router = createHashRouter([
  { path: '/', element: <Root /> },
  { path: '/login', element: <Login /> },
  { path: '/first-run', element: <FirstRun /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/new-user-setup', element: <NewUserSetup /> },
      { path: '/dashboard', element: <Dashboard /> },
      { path: '/installed-apps', element: <InstalledApps /> },
      { path: '/catalog', element: <AppCatalog /> },
      { path: '/deploy', element: <Deploy /> },
      { path: '/devices', element: <Devices /> },
      {
        path: '/settings',
        element: <Settings />,
        children: [
          { index: true, element: <Navigate to="/settings/general" replace /> },
          { path: 'general', element: <GeneralTab /> },
          { path: 'tenant', element: <TenantTab /> },
          { path: 'users', element: <UsersTab /> }
        ]
      }
    ]
  },
  { path: '*', element: <Navigate to="/" replace /> }
])

export default function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <RouterProvider router={router} />
      </TenantProvider>
    </AuthProvider>
  )
}
