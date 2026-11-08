import { ridingSyncRef } from '@ubichill/react';
import { useEffect } from 'react';
import { hasOpenDialog } from '@/components/ui/dialogLayer';
import { isLaunchpadToggle, isTypingTarget } from './launchpadKey';

/**
 * Esc でランチパッドを開け閉めする。ランチパッドの入力欄で打っているときは、まず入力欄から抜ける。
 * 乗り物に乗っている間は開かない（mod の「Esc で降りる」を先に通す）。
 */
export function useLaunchpadHotkey(open: boolean, setOpen: (next: boolean) => void) {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const typing = isTypingTarget(e.target);
            const context = { open, typing, otherDialogOpen: hasOpenDialog(), riding: ridingSyncRef.get() !== null };
            if (isLaunchpadToggle(e, context)) {
                setOpen(!open);
                return;
            }
            if (open && typing && e.key === 'Escape' && !e.isComposing && e.target instanceof HTMLElement) {
                if (e.target.closest('[data-launchpad]')) e.target.blur();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, setOpen]);
}
