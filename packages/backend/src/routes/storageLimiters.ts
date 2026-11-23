/** 設定の「ストレージ」とワールドの画像の API の回数の制限（どちらの道から消しても同じ数で数える）。 */
import { perUserLimiter } from '../lib/rateLimit';

const TEN_MINUTES = 10 * 60 * 1000;

/** 一覧を読む（1 回 50 個。数千個ある人がスクロールで読み進めても足りる数） */
export const storageReadLimiter = perUserLimiter(
    'storage-reads',
    TEN_MINUTES,
    300,
    'ストレージの読み込みが多すぎます。少し待ってから試してください',
);

/** 消す（アップロードとは別に数える。容量を越えたら消してから上げ直すので、上げる数を食わない） */
export const storageDeleteLimiter = perUserLimiter(
    'storage-deletes',
    TEN_MINUTES,
    600,
    '画像を消す操作が多すぎます。少し待ってから試してください',
);
