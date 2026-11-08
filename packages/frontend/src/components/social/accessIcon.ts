import type { AccessType } from '@ubichill/shared';
import type { HudIconName } from '@/components/hud/HudIcon';

/** 公開範囲のアイコン（誰でも・フレンド・招待した人だけ）。 */
export function accessIcon(type: AccessType): HudIconName {
    switch (type) {
        case 'public':
            return 'globe';
        case 'friend_plus':
        case 'friend_only':
            return 'users';
        case 'invite_only':
            return 'lock';
    }
}
