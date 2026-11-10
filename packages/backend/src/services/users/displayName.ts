/**
 * 表示名の確認と変更。一意（全角半角・大文字小文字・空白の違いは同じ名前）。ID と違い変更できるが、別の名前にするのは
 * 一定期間に 1 回（規則は shared の displayNameChange）。
 */
import { userRepository } from '@ubichill/db';
import {
    DisplayNameSchema,
    decideDisplayNameChange,
    displayNameChangeAvailableAt,
    displayNameChangeCutoff,
    displayNameKey,
} from '@ubichill/shared';
import { invalidateAuthorKey } from '../authors/authorKeyService';
import { selfAccount } from '../authors/authorKeys';
import { federation } from '../federation';
import { worldRegistry } from '../worlds/worldRegistry';

/** 次に別の名前へ変えられる時刻（変えたことが無ければ null）。 */
export const displayNameAvailableAtOf = (changedAt: Date | null): string | null =>
    displayNameChangeAvailableAt(changedAt)?.toISOString() ?? null;

/** 表示名が使えるか（自分が使っている名前は使える）。 */
export async function displayNameAvailability(
    name: string,
    viewerId: string | undefined,
): Promise<{ available: boolean; error: string | null }> {
    const parsed = DisplayNameSchema.safeParse(name);
    if (!parsed.success) return { available: false, error: parsed.error.issues[0]?.message ?? '表示名が不正です' };
    const existing = await userRepository.findByDisplayNameKey(displayNameKey(parsed.data));
    const own = existing && viewerId && existing.id === viewerId;
    return { available: !existing || !!own, error: existing && !own ? 'この表示名は既に使用されています' : null };
}

export type DisplayNameChangeOutcome =
    | { ok: true; name: string; displayNameChangeAvailableAt: string | null }
    | { ok: false; reason: 'invalid'; error: string }
    | { ok: false; reason: 'not-found' | 'taken' }
    | { ok: false; reason: 'cooldown'; availableAt: Date };

export async function changeDisplayName(userId: string, name: string): Promise<DisplayNameChangeOutcome> {
    const parsed = DisplayNameSchema.safeParse(name);
    if (!parsed.success) {
        return { ok: false, reason: 'invalid', error: parsed.error.issues[0]?.message ?? '表示名が不正です' };
    }
    const current = await userRepository.findById(userId);
    if (!current) return { ok: false, reason: 'not-found' };
    const now = new Date();
    const decision = decideDisplayNameChange(
        {
            currentKey: current.displayNameKey,
            availableAt: displayNameChangeAvailableAt(current.displayNameChangedAt),
        },
        parsed.data,
        now,
    );
    if (decision.kind === 'cooldown') return { ok: false, reason: 'cooldown', availableAt: decision.availableAt };
    const key = displayNameKey(parsed.data);
    const existing = await userRepository.findByDisplayNameKey(key);
    if (existing && existing.id !== userId) return { ok: false, reason: 'taken' };
    try {
        // 期間の判定は書き込みと同じ UPDATE でもう一度行う（同時に 2 回変えられないように）
        const updated = await userRepository.setDisplayName(
            userId,
            parsed.data,
            key,
            decision.startsCooldown ? { changedAt: now, notChangedAfter: displayNameChangeCutoff(now) } : {},
        );
        if (!updated) {
            const latest = await userRepository.findById(userId);
            const availableAt = displayNameChangeAvailableAt(latest?.displayNameChangedAt ?? null);
            return availableAt ? { ok: false, reason: 'cooldown', availableAt } : { ok: false, reason: 'not-found' };
        }
        // ワールドの作者名は表示時にアカウントから引くので、キャッシュ済みの解決結果だけ捨てればよい
        invalidateAuthorKey(selfAccount(updated.handle));
        worldRegistry.invalidateResolvedWorlds();
        federation?.profileChanged(userId);
        return {
            ok: true,
            name: updated.name,
            displayNameChangeAvailableAt: displayNameAvailableAtOf(updated.displayNameChangedAt),
        };
    } catch {
        return { ok: false, reason: 'taken' };
    }
}
