/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Reown AppKit project ID (client-side). */
  readonly VITE_APPKIT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
