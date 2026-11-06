/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** バックエンド（SNS API）の URL。`VITE_API_URL` は旧名。 */
    readonly VITE_BACKEND_URL?: string;
    readonly VITE_API_URL?: string;
    /** mod の配信元。省略時はフロント自身の `/mods`。 */
    readonly VITE_MOD_CDN_URL?: string;
    readonly VITE_COMMIT_HASH?: string;
    readonly VITE_ENVIRONMENT?: string;
}
