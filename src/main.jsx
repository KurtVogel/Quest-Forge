import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
// The one sanctioned src/dev/ import (exempted in eslint.config.js): the seeder
// must run SYNCHRONOUSLY before GameProvider reads persisted settings, and it
// self-gates on import.meta.env.DEV so a production build no-ops.
import { seedDevSettings } from './dev/devSettingsSeed.js'

seedDevSettings()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
