import { reportDiagnostic } from '@ubichill/sandbox';
import { UbiErrorCode, type VNode } from '@ubichill/shared';
import { renderVNode } from '@ubichill/ui-renderer';
import { useLayoutEffect, useRef } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface ModUIMountProps {
    targetId: string;
    vnode: VNode | null;
    sendAction: (targetId: string, handlerIndex: number, eventType: string, detail?: unknown) => void;
    style?: React.CSSProperties;
    /** 描けなかったときの診断に載せる mod の ID。 */
    modId?: string;
}

function reportRenderFailure(modId: string | undefined, error: unknown): void {
    reportDiagnostic({
        level: 'error',
        modId: modId ?? 'unknown',
        code: UbiErrorCode.RPC_HANDLER_ERROR,
        message: `UI を描けませんでした: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
}

/** mod の UI を Shadow DOM に描く。描けない UI はその mod の分だけ消し、Host のほかの画面は止めない。 */
export function ModUIMount(props: ModUIMountProps) {
    return (
        <ErrorBoundary fallback={null} onError={(error) => reportRenderFailure(props.modId, error)}>
            <ModUIShadow {...props} />
        </ErrorBoundary>
    );
}

function ModUIShadow({ targetId, vnode, sendAction, style, modId }: ModUIMountProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const prevVnodeRef = useRef<VNode | null | undefined>(undefined);
    /** 失敗が続く間は診断を 1 回だけ出す。 */
    const failedRef = useRef(false);

    // 初回マウント時にのみ Shadow Root を構築
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || innerRef.current) return;
        const shadow = host.attachShadow({ mode: 'open' });
        const inner = document.createElement('div');
        inner.style.display = 'contents';
        shadow.appendChild(inner);
        innerRef.current = inner;
    }, []);

    useLayoutEffect(() => {
        const inner = innerRef.current;
        if (!inner) return;
        if (Object.is(prevVnodeRef.current, vnode)) return;
        prevVnodeRef.current = vnode;
        try {
            renderVNode(vnode, inner, (handlerIndex, eventType, detail) => {
                sendAction(targetId, handlerIndex, eventType, detail);
            });
            failedRef.current = false;
        } catch (error) {
            inner.textContent = '';
            if (!failedRef.current) reportRenderFailure(modId, error);
            failedRef.current = true;
        }
    }, [vnode, targetId, sendAction, modId]);

    return <div ref={hostRef} style={style} />;
}
