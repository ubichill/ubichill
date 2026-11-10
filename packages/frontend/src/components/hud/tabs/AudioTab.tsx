import { useId } from 'react';
import { useMediaOutput } from '@/lib/settings/mediaOutputSetting';
import { css, cva } from '@/styled-system/css';
import { HudIcon } from '../HudIcon';
import { tabPanel, tabSection } from './shared';

/** 音声タブ: ワールドの動画・音楽の全体の音量とミュート。mod が決めた音量に掛け合わせる。 */
export function AudioTab() {
    const [level, setLevel] = useMediaOutput();
    const sliderId = useId();
    const percent = Math.round(level.volume * 100);

    return (
        <div className={tabPanel}>
            <div className={tabSection}>
                <div className={css({ display: 'flex', alignItems: 'center', gap: '4' })}>
                    <button
                        type="button"
                        aria-pressed={level.muted}
                        aria-label={level.muted ? 'ミュートを解除' : 'ミュート'}
                        className={muteButton({ muted: level.muted })}
                        onClick={() => setLevel({ muted: !level.muted })}
                    >
                        <HudIcon name={level.muted ? 'mute' : 'volume'} size={24} />
                    </button>
                    <div className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column', gap: '2' })}>
                        <label
                            htmlFor={sliderId}
                            className={css({
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '14px',
                                fontWeight: '700',
                                color: 'text',
                            })}
                        >
                            ワールドのメディア
                            <span className={css({ fontVariantNumeric: 'tabular-nums', color: 'textMuted' })}>
                                {level.muted ? 'ミュート中' : `${percent}%`}
                            </span>
                        </label>
                        <input
                            id={sliderId}
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={percent}
                            onChange={(e) => setLevel({ volume: Number(e.target.value) / 100, muted: false })}
                            className={css({ w: 'full', accentColor: 'primary', cursor: 'pointer' })}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

const muteButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        w: '52px',
        h: '52px',
        flexShrink: 0,
        borderRadius: '14px',
        border: '1px solid',
        borderColor: 'border',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
    },
    variants: {
        muted: {
            true: { bg: 'errorBg', color: 'errorText', borderColor: 'errorBg' },
            false: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { bg: 'primaryHover' } },
        },
    },
});
