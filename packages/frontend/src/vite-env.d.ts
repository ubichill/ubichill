/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** バックエンド（SNS API）の URL。`VITE_API_URL` は旧名。 */
    readonly VITE_BACKEND_URL?: string;
    readonly VITE_API_URL?: string;
    /** mod の配信元。省略時はフロント自身の `/mods`。 */
    readonly VITE_MOD_CDN_URL?: string;
    readonly VITE_COMMIT_HASH?: string;
    readonly VITE_ENVIRONMENT?: string;
    /** 指定すると SNS を使わず、この Go インスタンスサーバーへ直接接続する単体モードになる。 */
    readonly VITE_INSTANCE_SERVER_URL?: string;
    /** 単体モードで入るインスタンスの ID。省略時は `standalone`。 */
    readonly VITE_INSTANCE_ID?: string;
}
