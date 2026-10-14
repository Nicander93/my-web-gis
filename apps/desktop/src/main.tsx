import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'ol/ol.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/antd-workbench.css'
import App from './app/App'
import { DesktopUiProvider } from './components/ui/DesktopUiProvider'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <DesktopUiProvider><App /></DesktopUiProvider>
  </StrictMode>
)
