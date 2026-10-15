import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { MiniPlayer } from './components/MiniPlayer'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing from index.html')

// The mini-player window loads this same bundle with `?mini=1` and renders
// only the widget (see src/main/mini.ts).
const isMini = new URLSearchParams(window.location.search).get('mini') === '1'

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {isMini ? <MiniPlayer /> : <App />}
  </React.StrictMode>
)
