import { renderVNode } from '@ubichill/sandbox';
import type { VNode } from '@ubichill/shared';
import { useLayoutEffect, useRef } from 'react';

interface PluginUIMountProps {
    targetId: string;
    vnode: VNode | null;
    sendAction: (targetId: string, handlerIndex: number, eventType: string, detail?: unknown) => void;
    style?: React.CSSProperties;
}

export function PluginUIMount({ targetId, vnode, sendAction, style }: PluginUIMountProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const prevVnodeRef = useRef<VNode | null | undefined>(undefined);

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
        renderVNode(vnode, inner, (handlerIndex, eventType, detail) => {
            sendAction(targetId, handlerIndex, eventType, detail);
        });
    }, [vnode, targetId, sendAction]);

    return <div ref={hostRef} style={style} />;
}
