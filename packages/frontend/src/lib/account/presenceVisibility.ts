import type { PresenceVisibility } from '@ubichill/shared';

export interface PresenceVisibilityOption {
    value: PresenceVisibility;
    label: string;
    description: string;
}

/** オンライン状態の見せ方の選択肢（広い順）。 */
export const PRESENCE_VISIBILITY_OPTIONS: readonly PresenceVisibilityOption[] = [
    {
        value: 'location',
        label: 'いる場所まで',
        description:
            'フレンドに、いま入っている部屋を見せます（部屋の公開範囲で見えない部屋なら、部屋にいることだけ）。',
    },
    {
        value: 'online',
        label: 'オンラインだけ',
        description: 'フレンドには、オンラインかどうかだけを見せます。どの部屋にいるかは見せません。',
    },
    {
        value: 'hidden',
        label: '見せない',
        description: 'フレンドからは、いつもオフラインに見えます。同じ部屋にいる人には見えます。',
    },
];
