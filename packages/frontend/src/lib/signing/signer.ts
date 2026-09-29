import type { WorldSigningKey } from '@ubichill/shared';

/** 署名に使う鍵と、署名に載せる作者アカウント。 */
export interface WorldSigner {
    key: WorldSigningKey;
    /** 鍵がアカウントの公開環境に登録済みのときだけ付ける（未登録の鍵で名乗っても作者表示されないため）。 */
    author?: string;
}
