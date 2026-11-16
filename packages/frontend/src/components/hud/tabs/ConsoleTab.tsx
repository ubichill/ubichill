import { ConsolePanel } from '@/components/console/ConsolePanel';
import { useConsoleEntries } from '@/components/console/useConsoleEntries';
import { appConsole } from '@/lib/console/consoleStore';
import { css } from '@/styled-system/css';

/** この部屋のコンソール。読み込めなかった mod（再試行はここから）・mod のログ・ワールドの警告。 */
export function ConsoleTab() {
    const entries = useConsoleEntries();
    return (
        <div className={panel}>
            <ConsolePanel entries={entries} onClear={appConsole.clear} />
        </div>
    );
}

const panel = css({
    w: 'full',
    maxW: '1040px',
    mx: 'auto',
    h: 'full',
    minH: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border',
    borderRadius: '12px',
});
