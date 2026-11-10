import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotifications } from '@/components/notifications';
import { type ConversationState, messageSignalOf, withConversationPage, withSentMessage } from '@/lib/messages';
import { fetchConversation, markConversationRead, sendMessage } from '@/lib/messagesApi';

/**
 * 1 人との会話。開いている間は、その人からメッセージが届くたびに最新を取り直して既読にする
 * （その人からのトーストは出さない）。
 */
export function useConversation(peerId: string) {
    const { feed, setOpenConversation } = useNotifications();
    const signal = messageSignalOf(feed.items, peerId);
    const [state, setState] = useState<ConversationState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const loadingOlder = useRef(false);

    useEffect(() => {
        setOpenConversation(peerId);
        return () => setOpenConversation(null);
    }, [peerId, setOpenConversation]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: signal は取り直しの合図（値そのものは使わない）
    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchConversation(peerId)
            .then((page) => {
                if (ctrl.cancelled) return;
                setState((s) => withConversationPage(s?.user.id === peerId ? s : null, page, 'latest'));
                setError(null);
                return markConversationRead(peerId);
            })
            .catch((e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めません'));
        return () => {
            ctrl.cancelled = true;
        };
    }, [peerId, signal]);

    const loadOlder = useCallback(async () => {
        const cursor = state?.nextCursor;
        if (!cursor || loadingOlder.current) return;
        loadingOlder.current = true;
        try {
            const page = await fetchConversation(peerId, cursor);
            setState((s) => withConversationPage(s, page, 'older'));
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めません');
        } finally {
            loadingOlder.current = false;
        }
    }, [peerId, state?.nextCursor]);

    /** 送れたら true（入力を消してよい）。 */
    const send = useCallback(
        async (content: string): Promise<boolean> => {
            setSending(true);
            setError(null);
            try {
                const message = await sendMessage(peerId, content);
                setState((s) => (s ? withSentMessage(s, message) : s));
                return true;
            } catch (e) {
                setError(e instanceof Error ? e.message : '送れませんでした');
                return false;
            } finally {
                setSending(false);
            }
        },
        [peerId],
    );

    return { state, error, sending, loadOlder, send };
}
