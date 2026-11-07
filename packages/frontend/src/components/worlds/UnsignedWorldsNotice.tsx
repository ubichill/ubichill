import { isPublishable, type WorldIdentity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';

/**
 * 自分のワールドのうち署名がなく一覧に出ていないものがあれば知らせる（作者署名の導入に伴う移行案内）。
 * 何もしなくても消えたように見えるのを防ぎ、設定の「ワールド」（署名して公開できる場所）を HUD の中で開く。
 * 公開プロフィールには公開済みのワールドしか出ないので、そこへは案内しない。
 */
export function UnsignedWorldsNotice() {
    const hud = useHudNavigation();
    const { data: session } = useSession();
    const [count, setCount] = useState(0);
    const userId = session?.user.id;

    useEffect(() => {
        if (!userId) return;
        const ignore = { current: false };
        fetch(`${API_BASE}/api/v1/users/me/worlds`, { credentials: 'include', cache: 'no-store' })
            .then((res) => (res.ok ? (res.json() as Promise<{ worlds: Array<{ identity?: WorldIdentity }> }>) : null))
            .then((data) => {
                if (!ignore.current && data) setCount(data.worlds.filter((w) => !isPublishable(w.identity)).length);
            })
            .catch(() => undefined);
        return () => {
            ignore.current = true;
        };
    }, [userId]);

    if (!userId || count === 0 || !hud) return null;
    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '3',
                flexWrap: 'wrap',
                mb: '3',
                px: '4',
                py: '3',
                bg: 'errorBg',
                color: 'errorText',
                borderRadius: '12px',
                fontSize: '13px',
                lineHeight: '1.6',
            })}
        >
            <span className={css({ flex: 1, minW: '200px' })}>
                あなたのワールドのうち {count} 個は作者アカウントで署名されていないため、一覧に表示されていません（URL
                からは入れます）。署名すると公開されます。
            </span>
            <button
                type="button"
                onClick={() => hud.openSettings('worlds')}
                className={css({
                    px: '3',
                    py: '6px',
                    bg: 'surface',
                    color: 'text',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    _hover: { bg: 'surfaceHover' },
                })}
            >
                署名して公開する
            </button>
        </div>
    );
}
