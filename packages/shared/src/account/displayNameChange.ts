/**
 * 表示名の変更の制限（クールダウン）。画面と API で同じ規則を使う。
 *
 * 表示名は一意なので、何度でも変えられると人気のある名前を取っては手放せてしまう。
 * そこで「他人と区別される名前（{@link displayNameKey} の値）」を変えるのは一定期間に 1 回にする。
 */
import { displayNameKey } from './handle';

export const DISPLAY_NAME_CHANGE_COOLDOWN_DAYS = 90;
const COOLDOWN_MS = DISPLAY_NAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export interface DisplayNameChangeState {
    /** 今の一意キー。移行時に他人と重複していたユーザーは null。 */
    currentKey: string | null;
    /** 次に一意キーを変えられる時刻（{@link displayNameChangeAvailableAt}）。制限が無ければ null。 */
    availableAt: Date | null;
}

export type DisplayNameChangeDecision =
    /** `startsCooldown` が true なら、変更した時刻を記録して次の変更を制限する。 */
    { kind: 'allowed'; startsCooldown: boolean } | { kind: 'cooldown'; availableAt: Date };

/** 最後に一意キーを変えた時刻から、次に変えられる時刻を求める。一度も変えていなければ（登録時の名前は数えない）null。 */
export function displayNameChangeAvailableAt(lastChangedAt: Date | null): Date | null {
    return lastChangedAt ? new Date(lastChangedAt.getTime() + COOLDOWN_MS) : null;
}

/** この時刻以前に最後に変えていれば、`now` に変えられる（DB の条件付き UPDATE で使う）。 */
export function displayNameChangeCutoff(now: Date): Date {
    return new Date(now.getTime() - COOLDOWN_MS);
}

/**
 * - 一意キーが同じ変更（大文字小文字・全角半角・空白だけ）は、他人の名前を取らないのでいつでもでき、期間も数えない
 * - 他人と重複していたユーザーが直すのは、こちらの都合で求めた変更なので制限せず、期間も数えない
 */
export function decideDisplayNameChange(
    state: DisplayNameChangeState,
    nextName: string,
    now: Date,
): DisplayNameChangeDecision {
    if (state.currentKey === null) return { kind: 'allowed', startsCooldown: false };
    if (displayNameKey(nextName) === state.currentKey) return { kind: 'allowed', startsCooldown: false };
    if (state.availableAt && now < state.availableAt) return { kind: 'cooldown', availableAt: state.availableAt };
    return { kind: 'allowed', startsCooldown: true };
}
