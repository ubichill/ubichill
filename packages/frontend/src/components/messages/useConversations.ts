import type { ConversationSummary } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNotifications } from '@/components/notifications';
import { messageSignalOf } from '@/lib/messages/messages';
import { fetchConversations } from '@/lib/messages/messagesApi';

/** 会話の一覧。メッセージが届くたび（通知が作り直されるたび）に取り直す。 */
export function useConversations() {
    const signal = messageSignalOf(useNotifications().feed.items);
    const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: signal は取り直しの合図（値そのものは使わない）
    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchConversations()
            .then((list) => {
                if (ctrl.cancelled) return;
                setConversations(list);
                setError(null);
            })
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めません'));
        return () => {
            ctrl.cancelled = true;
        };
    }, [signal]);

    return { conversations, error };
}
