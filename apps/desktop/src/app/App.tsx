import { useEffect, useState } from 'react'
import { Header } from './Header'
import { StatusBar } from './StatusBar'
import { Workspace } from './Workspace'

/** Desktop 应用壳层：Header、Map-first Workspace 和 StatusBar。 */
export default function App() {
  const [status, setStatus] = useState('就绪')

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'

    function handleCommandStatus(event: Event): void {
      setStatus((event as CustomEvent<string>).detail)
    }

    window.addEventListener('desktop-webgis:command-status', handleCommandStatus)
    return () => window.removeEventListener('desktop-webgis:command-status', handleCommandStatus)
  }, [])

  return (
    <div className="desktop-app">
      <Header />
      <Workspace />
      <StatusBar message={status} />
    </div>
  )
}
