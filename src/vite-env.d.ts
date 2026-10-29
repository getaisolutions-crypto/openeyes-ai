/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected at build time by the openeyes-build-info plugin in vite.config.ts. */
declare const __APP_BUILD__: { version: string; buildId: string; builtAt: string };
