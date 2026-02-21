import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import './index.css'
import App from './app/App'
import { AuthProvider } from './auth/AuthProvider'
import { UsersProvider } from './data/UsersProvider'
import { ToastProvider } from './components/Toast'

const savedTheme = localStorage.getItem('flowsuite.theme')
if (savedTheme === 'light') {
  document.body.classList.add('theme-light')
} else {
  document.body.classList.add('theme-dark')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <UsersProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </UsersProvider>
    </AuthProvider>
  </StrictMode>,
)
