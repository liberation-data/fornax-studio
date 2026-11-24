/** What the desktop app's preload lends the page (preload.cjs); absent in a browser. */
interface StudioNative {
  readonly platform: string
  /** Shows a file the studio made in the system's file manager. */
  showFile(file: string): void
}

interface Window {
  studioNative?: StudioNative
}
