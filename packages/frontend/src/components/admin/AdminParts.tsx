import { EXPIRY_PRESETS, type ExpiryPreset, isExpiryPreset } from '@/lib/admin/roleForm';
import { adminAvatar, adminField, adminHandle, adminIdentity, adminName } from './adminStyles';

export function UserAvatar({ name, image }: { name: string; image: string | null }) {
    if (image) return <img src={image} alt="" className={adminAvatar} />;
    return (
        <span className={adminAvatar} aria-hidden="true">
            {Array.from(name)[0] ?? '?'}
        </span>
    );
}

export function UserIdentity({ user }: { user: { name: string; handle: string; image: string | null } }) {
    return (
        <>
            <UserAvatar name={user.name} image={user.image} />
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
