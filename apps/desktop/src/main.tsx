import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'ol/ol.css'
import './ui/styles/tokens.css'
import './ui/styles/app.css'
import './ui/styles/antd-workbench.css'
import App from '@/shell/App'
import { DesktopUiProvider } from '@/ui/DesktopUiProvider'
import './ui/styles/desktop-ux.css'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <DesktopUiProvider><App /></DesktopUiProvider>
  </StrictMode>
)
