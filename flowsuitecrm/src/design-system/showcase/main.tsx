import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import '../design-system.css'
import { Showcase } from './Showcase'

// Solo desarrollo: esta página no forma parte del build de producción (ver vite.config.ts).
const theme = new URLSearchParams(window.location.search).get('theme')
document.body.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
)
