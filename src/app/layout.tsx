import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@liberation-data/desk/desk.css'
import '../studio/theme.css'
import '../studio/studio.css'

export const metadata: Metadata = {
  title: 'Kiln Studio',
  description: 'Try models with Kiln: chat, images and songs, on your GPU, in one JVM.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
