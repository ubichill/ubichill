import { UserIdentity } from '@/components/social';
import { EXPIRY_PRESETS, type ExpiryPreset, isExpiryPreset } from '@/lib/admin/roleForm';
import { adminField } from './adminStyles';

/** 一覧の行の人（名前は省略せずに折り返す）。 */
export function AdminUser({ user }: { user: { name: string; handle: string; image: string | null } }) {
    return <UserIdentity user={user} size="sm" wrap sub={`@${user.handle}`} />;
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
