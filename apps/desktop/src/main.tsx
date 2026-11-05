import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'ol/ol.css'
import './ui/components/styles/tokens.css'
import './ui/components/styles/app.css'
import './ui/components/styles/antd-workbench.css'
import App from '@/ui/workbench/App'
import { DesktopUiProvider } from '@/ui/components/DesktopUiProvider'
import './ui/components/styles/desktop-ux.css'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <DesktopUiProvider><App /></DesktopUiProvider>
  </StrictMode>
)
