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
            'フレンドに、いま入っているインスタンスを見せます（公開範囲で見えないインスタンスなら、どこかのインスタンスにいることだけ）。',
    },
    {
        value: 'online',
        label: 'オンラインだけ',
        description: 'フレンドには、オンラインかどうかだけを見せます。どのインスタンスにいるかは見せません。',
    },
    {
        value: 'hidden',
        label: '見せない',
        description: 'フレンドからは、いつもオフラインに見えます。同じインスタンスにいる人には見えます。',
    },
];
