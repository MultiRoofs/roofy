/// <reference types="vite-plus/client" />
/// <reference types="@react-three/fiber" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
