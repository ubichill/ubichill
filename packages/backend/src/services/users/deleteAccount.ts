/**
 * アカウントの削除（退会）。取り消せないので、確かめてから順に行う。
 * 1. 公式アカウントは消せない（公式ワールドの作者・サーバーの管理者）
 * 2. 本人が ID（handle）を入れ直して確かめる（別のアカウントのつもりで消さないように）
 * 3. 自分が開いている部屋を先に閉じる（DB だけ消すと、インスタンスのサーバーに部屋が残る）。閉じられなければ消さない
 * 4. ユーザーを消し、ID を退会の記録に残す（持ち物は FK で一緒に消える。ID は二度と使わせない）
 * 5. 3 の後に別のタブで作られた部屋も一緒に消えるので、その Go の部屋を閉じる（作成の途中の部屋は、作成の側が
 *    DB の行が消えたのを見て閉じる。instanceManager.closeIfGone）
 */
import { OFFICIAL_HANDLE } from '@ubichill/shared';

export interface DeleteAccountDeps {
    findUser(userId: string): Promise<{ id: string; handle: string } | undefined>;
    /** そのユーザーが開いている部屋の ID */
    openRooms(userId: string): Promise<string[]>;
    /** 部屋を閉じる。閉じられなければ false */
    closeRoom(roomId: string, userId: string): Promise<boolean>;
    retire(userId: string): Promise<{ status: 'retired'; handle: string; roomIds: string[] } | { status: 'not-found' }>;
    /** 退会で DB から消えた部屋を、インスタンスのサーバーで閉じる（DB の行はもう無い）。閉じられなければ false */
    closeOrphanedRoom(roomId: string): Promise<boolean>;
    /** 退会で消えた部屋を閉じられなかった（Go に残る。運用で見つけられるように記録する） */
    warnOrphanedRoom(roomId: string): void;
    /** 消した後の後始末（ワールドの一覧などの覚えた結果を捨てる） */
    afterDeleted(userId: string, handle: string): void;
}

export type DeleteAccountOutcome = { ok: true } | { ok: false; status: 400 | 403 | 404 | 503; error: string };

export async function deleteAccount(
    deps: DeleteAccountDeps,
    input: { userId: string; confirmHandle: unknown },
): Promise<DeleteAccountOutcome> {
    const user = await deps.findUser(input.userId);
    if (!user) return { ok: false, status: 404, error: 'アカウントが見つかりません' };
    if (user.handle === OFFICIAL_HANDLE) {
        return { ok: false, status: 403, error: '公式アカウントは削除できません' };
    }
    if (input.confirmHandle !== user.handle) {
        return { ok: false, status: 400, error: '確認のため、自分の ID を正しく入力してください' };
    }
    for (const roomId of await deps.openRooms(user.id)) {
        if (!(await deps.closeRoom(roomId, user.id))) {
            return {
                ok: false,
                status: 503,
                error: '開いているインスタンスを閉じられませんでした。しばらくしてからやり直してください',
            };
        }
    }
    const retired = await deps.retire(user.id);
    if (retired.status === 'not-found') return { ok: false, status: 404, error: 'アカウントが見つかりません' };
    for (const roomId of retired.roomIds) {
        // 退会は済んだので、閉じられなくても失敗にはしない（記録だけ残す）
        if (!(await deps.closeOrphanedRoom(roomId).catch(() => false))) deps.warnOrphanedRoom(roomId);
    }
    deps.afterDeleted(user.id, retired.handle);
    return { ok: true };
}
