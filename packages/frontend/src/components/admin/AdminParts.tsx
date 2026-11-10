import { UserAvatar } from '@/components/social';
import { EXPIRY_PRESETS, type ExpiryPreset, isExpiryPreset } from '@/lib/admin/roleForm';
import { adminField, adminHandle, adminIdentity, adminName } from './adminStyles';

export function UserIdentity({ user }: { user: { name: string; handle: string; image: string | null } }) {
    return (
        <>
            <UserAvatar user={user} size="sm" />
            <span className={adminIdentity}>
                <span className={adminName}>{user.name}</span>
                <span className={adminHandle}>@{user.handle}</span>
            </span>
        </>
    );
}

/** アサインの期限の選択。 */
export function ExpirySelect({
    value,
    disabled,
    onChange,
}: {
    value: ExpiryPreset;
    disabled?: boolean;
    onChange: (next: ExpiryPreset) => void;
}) {
    return (
        <select
            className={adminField({ compact: true })}
            value={value}
            disabled={disabled}
            aria-label="期限"
            onChange={(e) => {
                if (isExpiryPreset(e.target.value)) onChange(e.target.value);
            }}
        >
            {EXPIRY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                    {p.label}
                </option>
            ))}
        </select>
    );
}
