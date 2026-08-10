import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const pre = document.createElement('link')
pre.rel = 'preconnect'
pre.href = 'https://fonts.gstatic.com'
pre.crossOrigin = 'anonymous'
document.head.appendChild(pre)

const font = document.createElement('link')
font.rel = 'stylesheet'
font.href =
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap'
document.head.appendChild(font)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
