/**
 * API の失敗レスポンスから利用者に見せる文言を取り出す（本文の `error`、無ければ HTTP の状態）。
 * `lib/api.ts` は読み込むだけで window を読むので分けている（node で動く保存処理のテストからも使う）。
 */
export async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}
