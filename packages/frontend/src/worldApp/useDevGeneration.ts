/**
 * dev サーバーの世代を SSE で受け取る。最初の `generation` でその世代の lock を取って使い始め、
 * 別の世代が届いたらページを読み直す。SSE が切れても EventSource が繋ぎ直し、サーバーは接続の直後に今の世代を送る。
 */
import { type ModLock, ModLockSchema } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import {
    type DevEvent,
    type DevGeneration,
    generationAction,
    generationLockUrl,
    parseDevEvent,
    recordFailure,
} from './devSession';

export interface DevState {
    generation: (DevGeneration & { lock: ModLock }) | null;
    failures: DevEvent[];
    /** SSE が繋がっているか。 */
    connected: boolean;
}

const EVENT_NAMES = ['generation', 'build-error', 'world-error'] as const;

export function useDevGeneration(): DevState {
    const [state, setState] = useState<DevState>({ generation: null, failures: [], connected: false });

    useEffect(() => {
        const source = new EventSource('/__ubichill/events');
        const adopted = { current: null as DevGeneration | null };
        const onEvent = (name: string) => async (raw: MessageEvent) => {
            const event = parseDevEvent(name, String(raw.data));
            if (!event) return;
            if (event.type !== 'generation') {
                setState((prev) => ({ ...prev, failures: recordFailure(prev.failures, event) }));
                return;
            }
            const action = generationAction(adopted.current, event);
            if (action === 'reload') {
                window.location.reload();
                return;
            }
            if (action === 'keep') return;
            adopted.current = event;
            const response = await fetch(generationLockUrl(event.buildId), { cache: 'no-store' });
            if (!response.ok) {
                // 世代が既に消えている（切り替えが速かった）。読み直して今の世代から始める（待っていても次の通知が来るとは限らない）
                window.location.reload();
                return;
            }
            const lock = ModLockSchema.parse(await response.json());
            setState((prev) => ({ ...prev, generation: { ...event, lock } }));
        };
        const listeners = EVENT_NAMES.map((name) => [name, onEvent(name)] as const);
        for (const [name, listener] of listeners) source.addEventListener(name, listener);
        source.onopen = () => setState((prev) => ({ ...prev, connected: true }));
        source.onerror = () => setState((prev) => ({ ...prev, connected: false }));
        return () => {
            for (const [name, listener] of listeners) source.removeEventListener(name, listener);
            source.close();
        };
    }, []);

    return state;
}
