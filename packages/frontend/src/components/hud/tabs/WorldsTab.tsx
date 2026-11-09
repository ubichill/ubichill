import { useMyAccount } from '@/components/profile';
import { MyWorldsSection } from '@/components/profile/MyWorldsSection';
import { WorldBrowser, type WorldBrowserTab } from '@/components/worlds/WorldBrowser';
import { css } from '@/styled-system/css';
import { SplitTab, type SplitTabItem } from './SplitTab';
import type { JoinInstanceHandler } from './shared';

export type WorldsSection = WorldBrowserTab | 'mine';

const SECTIONS: ReadonlyArray<SplitTabItem<WorldsSection>> = [
    { id: 'local', label: 'ローカル', icon: 'server' },
    { id: 'global', label: 'グローバル', icon: 'globe' },
    { id: 'favorites', label: 'お気に入り', icon: 'star' },
    { id: 'mine', label: '自分のワールド', icon: 'user' },
];

/** ワールド: このサーバー・連合・お気に入り・自分のワールド（署名・削除などの管理）を左で切り替える。 */
export function WorldsTab({
    section,
    onSectionChange,
    onJoinInstance,
    currentInstanceId,
    onNavigate,
}: {
    section: WorldsSection;
    onSectionChange: (next: WorldsSection) => void;
    onJoinInstance: JoinInstanceHandler;
    currentInstanceId?: string;
    onNavigate?: () => void;
}) {
    return (
        <SplitTab label="ワールド" items={SECTIONS} current={section} onSelect={onSectionChange}>
            {section === 'mine' ? (
                <MyWorlds onJoinInstance={onJoinInstance} onNavigate={onNavigate} />
            ) : (
                <WorldBrowser tab={section} onJoinInstance={onJoinInstance} currentInstanceId={currentInstanceId} />
            )}
        </SplitTab>
    );
}

/** 自分のアカウントはこの欄を開いたときだけ読み込む。 */
function MyWorlds({ onJoinInstance, onNavigate }: { onJoinInstance: JoinInstanceHandler; onNavigate?: () => void }) {
    const account = useMyAccount();
    if (account.error) return <p className={css({ fontSize: '13px', color: 'errorText' })}>{account.error}</p>;
    if (account.loading) return <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>;
    return <MyWorldsSection account={account} onNavigate={onNavigate} onJoinInstance={onJoinInstance} />;
}
