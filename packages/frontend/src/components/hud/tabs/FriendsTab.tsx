import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

export function FriendsTab() {
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>フレンド一覧</h2>
                <div
                    className={css({
                        p: '8',
                        bg: 'secondary',
                        borderRadius: '12px',
                        textAlign: 'center',
                        color: 'textMuted',
                        fontSize: '15px',
                    })}
                >
                    Coming Soon...
                </div>
            </div>
        </div>
    );
}
