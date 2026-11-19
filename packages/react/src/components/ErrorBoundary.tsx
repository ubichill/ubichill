import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
    /** 子が描けなくなったときに代わりに出すもの。 */
    fallback: ReactNode;
    onError?: (error: unknown, info: ErrorInfo) => void;
    children: ReactNode;
}

/** 子の描画の例外を、その範囲だけで止める（React は境界が無いとツリー全体を外す）。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    componentDidCatch(error: unknown, info: ErrorInfo): void {
        this.props.onError?.(error, info);
    }

    render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}
