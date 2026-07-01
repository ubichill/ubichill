/**
 * モバイル時の左右ドックパネル開閉 + Stage の snap on/off。
 * ページ本体から UI flag をまとめて引き剥がしただけの thin state hook。
 */
import { useCallback, useState } from 'react';

export interface UseMobilePanelsResult {
    leftOpen: boolean;
    rightOpen: boolean;
    snapEnabled: boolean;
    openLeft: () => void;
    closeLeft: () => void;
    openRight: () => void;
    closeRight: () => void;
    toggleSnap: () => void;
}

export function useMobilePanels(): UseMobilePanelsResult {
    const [leftOpen, setLeftOpen] = useState(false);
    const [rightOpen, setRightOpen] = useState(false);
    const [snapEnabled, setSnapEnabled] = useState(false);

    const openLeft = useCallback(() => setLeftOpen(true), []);
    const closeLeft = useCallback(() => setLeftOpen(false), []);
    const openRight = useCallback(() => setRightOpen(true), []);
    const closeRight = useCallback(() => setRightOpen(false), []);
    const toggleSnap = useCallback(() => setSnapEnabled((p) => !p), []);

    return { leftOpen, rightOpen, snapEnabled, openLeft, closeLeft, openRight, closeRight, toggleSnap };
}
