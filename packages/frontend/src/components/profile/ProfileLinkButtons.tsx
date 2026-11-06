import { PROFILE_LINK_LABELS, type ProfileLink } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { ProfileLinkIcon } from './ProfileLinkIcon';
import { roundIconButton } from './profileStyles';

/** 正規形の URL のホスト名（punycode のまま。見た目の似た別ドメインと区別できるように）。 */
const hostOf = (url: string): string => {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
};

/** リンクの丸いボタンの列。どこへ行くかは名前とホスト名で示す。 */
export function ProfileLinkButtons({ links }: { links: readonly ProfileLink[] }) {
    if (links.length === 0) return null;
    return (
        <ul className={css({ display: 'flex', flexWrap: 'wrap', gap: '2.5', listStyle: 'none', p: 0, m: 0 })}>
            {links.map((link) => {
                const label = `${PROFILE_LINK_LABELS[link.kind]}（${hostOf(link.url)}）`;
                return (
                    <li key={link.url}>
                        {/* 本人が自分のページだと示す（rel=me）。開いた先にこのページを触らせない */}
                        <a
                            href={link.url}
                            target="_blank"
                            rel="me noopener noreferrer"
                            aria-label={label}
                            title={label}
                            className={roundIconButton({ size: 'md' })}
                        >
                            <ProfileLinkIcon kind={link.kind} />
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}
