/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the API lives. Empty in production (same origin); Vite proxies /v1
   *  to :8080 in development. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
