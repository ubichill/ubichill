/**
 * mod の取得元。Host（SNS の画面・world.html）がワールドを動かすときに決めて `WorldView` に渡す。
 * 個々の mod が別の置き場所から配られている場合は、lock のエントリの `baseUrl` がこれより優先される。
 */
export interface ModSource {
    /** 既定の取得元（例: `/mods`、外部 CDN）。末尾スラッシュなし。 */
    baseUrl: string;
    /**
     * 開発用の Host か。true なら、自分のオリジンから配る署名の無い mod を「署名なし（開発）」として動かし、
     * 作者のサーバー（localhost）に http でも問い合わせる。署名があれば常に確かめる。
     */
    devHost: boolean;
}
