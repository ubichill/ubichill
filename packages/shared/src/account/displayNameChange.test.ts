import { describe, expect, it } from 'vitest';
import {
    DISPLAY_NAME_CHANGE_COOLDOWN_DAYS,
    decideDisplayNameChange,
    displayNameChangeAvailableAt,
    displayNameChangeCutoff,
} from './displayNameChange';
import { displayNameKey } from './handle';

const DAY = 24 * 60 * 60 * 1000;
const changedAt = new Date('2026-01-01T00:00:00Z');
const after = (ms: number) => new Date(changedAt.getTime() + ms);
const state = { currentKey: displayNameKey('Youkan'), availableAt: displayNameChangeAvailableAt(changedAt) };

describe('decideDisplayNameChange', () => {
    it('一度も変えていなければ変えられ、期間を数え始める（登録時の名前は数えない）', () => {
        expect(decideDisplayNameChange({ ...state, availableAt: null }, 'Mochi', changedAt)).toEqual({
            kind: 'allowed',
            startsCooldown: true,
        });
    });

    it('期間中は別の名前に変えられず、変えられる時刻を返す', () => {
        expect(decideDisplayNameChange(state, 'Mochi', after(DAY))).toEqual({
            kind: 'cooldown',
            availableAt: after(DISPLAY_NAME_CHANGE_COOLDOWN_DAYS * DAY),
        });
    });

    it('ちょうど期間が明けた瞬間から変えられる（1ms 前はまだ）', () => {
        const end = DISPLAY_NAME_CHANGE_COOLDOWN_DAYS * DAY;
        expect(decideDisplayNameChange(state, 'Mochi', after(end - 1)).kind).toBe('cooldown');
        expect(decideDisplayNameChange(state, 'Mochi', after(end)).kind).toBe('allowed');
    });

    it('一意キーが同じ（大文字小文字・全角半角・空白だけの違い）なら期間中でも変えられ、期間を延ばさない', () => {
        for (const name of ['youkan', 'ＹＯＵＫＡＮ', '  Youkan  ']) {
            expect(decideDisplayNameChange(state, name, after(DAY))).toEqual({
                kind: 'allowed',
                startsCooldown: false,
            });
        }
    });

    it('見た目だけの変更で期間を延ばさないので、名前を取り直す抜け道にもならない', () => {
        // 見た目だけ変えても変更時刻は進まない → 別の名前への変更は元の期間のまま
        const cosmetic = decideDisplayNameChange(state, 'YOUKAN', after(DAY));
        expect(cosmetic).toEqual({ kind: 'allowed', startsCooldown: false });
        expect(decideDisplayNameChange(state, 'Mochi', after(2 * DAY)).kind).toBe('cooldown');
    });

    it('他人と重複していた（一意キーが無い）ユーザーは期間中でも直せ、期間を数えない', () => {
        expect(
            decideDisplayNameChange({ currentKey: null, availableAt: state.availableAt }, 'Mochi', after(DAY)),
        ).toEqual({
            kind: 'allowed',
            startsCooldown: false,
        });
    });

    it('時計が戻っても（未来に変更した記録があっても）制限は外れない', () => {
        expect(decideDisplayNameChange(state, 'Mochi', after(-DAY)).kind).toBe('cooldown');
    });
});

describe('displayNameChangeAvailableAt', () => {
    it('変えたことが無ければ制限なし', () => {
        expect(displayNameChangeAvailableAt(null)).toBeNull();
    });
    it('最後に変えた時刻から期間ぶん後', () => {
        expect(displayNameChangeAvailableAt(changedAt)).toEqual(after(DISPLAY_NAME_CHANGE_COOLDOWN_DAYS * DAY));
    });
});

describe('displayNameChangeCutoff', () => {
    it('decideDisplayNameChange と同じ境界になる（DB の条件と画面の判定がずれない）', () => {
        const end = DISPLAY_NAME_CHANGE_COOLDOWN_DAYS * DAY;
        for (const now of [after(end - 1), after(end), after(end + 1)]) {
            const allowedByDb = changedAt <= displayNameChangeCutoff(now);
            expect(allowedByDb).toBe(decideDisplayNameChange(state, 'Mochi', now).kind === 'allowed');
        }
    });
});
