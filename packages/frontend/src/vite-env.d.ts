/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_MOCK_TOKEN_CONTRACT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
