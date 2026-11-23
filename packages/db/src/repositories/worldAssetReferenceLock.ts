import { sql } from 'drizzle-orm';
import type { Tx } from './credentialUser';

const KEY = sql`hashtextextended('world-asset-references', 0)`;

/**
 * ワールドの定義（下書き・版）を書くトランザクションと、使われていない画像の掃除の順番を決める。
 * 掃除の 1 文のスナップショットより後にコミットした保存は見えないので、その保存が指す古い画像を消してしまう。
 * 書く側は共有で、掃除は排他で取る。掃除の DELETE はロックを取った後の文なので、それまでにコミットした保存がすべて見え、
 * 掃除の間に来た保存は掃除のコミットを待つ。
 *
 * 書く側はトランザクションの最初に取る（ほかのロックを持ったまま待つと、掃除の排他の後ろに並んだ保存と互いに待ち合う）。
 * 掃除は待つ時間を区切る（排他を待つ間、後から来た保存はその後ろに並ぶ。取れなければ次の回に回す）。
 */
export async function lockWorldAssetReferences(tx: Tx, mode: 'write' | 'sweep'): Promise<void> {
    if (mode === 'write') {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(${KEY})`);
        return;
    }
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(${KEY})`);
}
