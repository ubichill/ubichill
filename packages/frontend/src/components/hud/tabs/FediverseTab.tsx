import { FediverseFollowers } from '@/components/profile/FediverseFollowers';
import { css } from '@/styled-system/css';
import { useHudNavigation } from '../HudNavigationContext';
import { tabPanel, tabSection } from './shared';

const settingsLink = css({
    alignSelf: 'flex-start',
    p: 0,
    bg: 'transparent',
    border: 'none',
    color: 'primaryHighlight',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    _hover: { textDecoration: 'underline' },
});

/** フェディバース（Mastodon・Misskey など）: アカウントとフォロワー。承認制などの設定は「プライバシー」へ。 */
export function FediverseTab() {
    const hud = useHudNavigation();
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={tabSection}>
                <FediverseFollowers />
                {hud && (
                    <button type="button" className={settingsLink} onClick={() => hud.openSettings('privacy')}>
                        承認制・検索に出すかの設定
                    </button>
                )}
            </div>
        </div>
    );
}
