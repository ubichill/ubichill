import { eq, sql } from 'drizzle-orm';
import { retiredAccounts } from '../schema';
import type { Tx } from './credentialUser';

/**
 * ID（handle）ごとに直列にしてから、退会した ID かを確かめる。ID でユーザーを作るときと退会するときの両方で取る。
 * 確かめるのと users に書くのが別々だと、確かめた後に同じ ID の人が退会して users から消え、退会した ID で作れてしまう
 * （仮登録の確認コードは ID を押さえないので、送った後に別人がその ID で登録・退会できる）。
 */
export async function lockHandle(tx: Tx, handle: string): Promise<{ retired: boolean }> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`handles:${handle}`}, 0))`);
    const [row] = await tx
        .select({ handle: retiredAccounts.handle })
        .from(retiredAccounts)
        .where(eq(retiredAccounts.handle, handle));
    return { retired: !!row };
}
