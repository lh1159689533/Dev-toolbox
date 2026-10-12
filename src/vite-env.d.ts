/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROJECT_PATH?: string;
  readonly VITE_BRANCH?: string;
  readonly VITE_AUTHOR?: string;
  readonly VITE_WORKSPACE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
