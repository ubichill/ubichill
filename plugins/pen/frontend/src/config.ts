// Pen機能の設定
export const PEN_CONFIG = {
    COLORS: {
        BLACK: '#000000',
        RED: '#FF0000',
        BLUE: '#0000FF',
        GREEN: '#00FF00',
    },
    OFFSETS: {
        BLACK: -150,
        RED: -50,
        BLUE: 50,
        GREEN: 150,
    },
    DEFAULT_Y: 40,
    TRAY_X_BASE: 600,
} as const;

export const DEFAULT_PENS = [
    { color: PEN_CONFIG.COLORS.BLACK, x: PEN_CONFIG.OFFSETS.BLACK },
    { color: PEN_CONFIG.COLORS.RED, x: PEN_CONFIG.OFFSETS.RED },
    { color: PEN_CONFIG.COLORS.BLUE, x: PEN_CONFIG.OFFSETS.BLUE },
    { color: PEN_CONFIG.COLORS.GREEN, x: PEN_CONFIG.OFFSETS.GREEN },
];

export const PEN_FEATURE_CONFIG = {
    id: 'pen',
    defaultPens: DEFAULT_PENS,
};
