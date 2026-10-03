import { ACCESS_TYPE_LABELS, type AccessType } from '@ubichill/shared';
import { css } from '@/styled-system/css';

const DESCRIPTIONS: Record<AccessType, string> = {
    public: '誰でも一覧から入れる',
    friend_plus: '参加している人のフレンドまで',
    friend_only: 'あなたのフレンドだけ',
    invite_only: '一覧に出さない。URL を渡した人だけ',
};

const ORDER: AccessType[] = ['public', 'friend_plus', 'friend_only', 'invite_only'];

/** 新しく作るインスタンスの公開範囲。 */
export function AccessTypeSelect({ value, onChange }: { value: AccessType; onChange: (next: AccessType) => void }) {
    return (
        <label
            className={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '1',
                fontSize: '12px',
                color: 'textMuted',
            })}
        >
            公開範囲
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as AccessType)}
                className={css({
                    px: '3',
                    py: '2',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '10px',
                    bg: 'surface',
                    color: 'text',
                    fontSize: '13px',
                })}
            >
                {ORDER.map((type) => (
                    <option key={type} value={type}>
                        {ACCESS_TYPE_LABELS[type]}（{DESCRIPTIONS[type]}）
                    </option>
                ))}
            </select>
        </label>
    );
}
