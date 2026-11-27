/** What the desktop app's preload lends the page (preload.cjs); absent in a browser. */
interface StudioNative {
  readonly platform: string
  /** Shows a file the studio made in the system's file manager. */
  showFile(file: string): void
  /** Whether a Hugging Face token is kept (and whether this system has a keychain to keep one); never the token. */
  hubToken(): Promise<{ set: boolean; usable: boolean } | null>
  /** Keeps the token in the keychain and gives it to the backend; null or blank clears it. */
  saveHubToken(token: string | null): Promise<{ set: boolean; usable: boolean } | null>
}

interface Window {
  studioNative?: StudioNative
}
