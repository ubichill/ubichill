import { type ProfileLanguageCode, profileLanguageLabel } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { chip, profileSectionTitle } from './profileStyles';

/** 話せる言語。名前はその言語自身の呼び名で、lang を付けて正しい字形で出す。 */
export function ProfileLanguageChips({ languages }: { languages: readonly ProfileLanguageCode[] }) {
    if (languages.length === 0) return null;
    return (
        <section>
            <h2 className={profileSectionTitle}>言語</h2>
            <ul className={css({ display: 'flex', flexWrap: 'wrap', gap: '2', listStyle: 'none', p: 0, m: 0 })}>
                {languages.map((code) => (
                    <li key={code} lang={code} className={chip()}>
                        {profileLanguageLabel(code)}
                    </li>
                ))}
            </ul>
        </section>
    );
}
