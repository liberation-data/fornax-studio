'use client'

import dynamic from 'next/dynamic'

// The desk measures the window as it lays itself out, so the studio renders in the browser only.
const App = dynamic(() => import('../studio/App').then(m => {
  m.openFromQuery(window.location.search)
  return m.App
}), { ssr: false })

export default function Page() {
  return <App />
}
