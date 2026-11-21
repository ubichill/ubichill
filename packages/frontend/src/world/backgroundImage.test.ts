import { describe, expect, it } from 'vitest';
import { backgroundImageStyle } from './backgroundImage';

describe('backgroundImageStyle', () => {
    it('既定は広さいっぱいに広げ、tile なら並べる', () => {
        expect(backgroundImageStyle({ backgroundImage: 'https://ubi.example/a.webp' })).toMatchObject({
            backgroundImage: 'url("https://ubi.example/a.webp")',
            backgroundSize: 'cover',
        });
        expect(
            backgroundImageStyle({ backgroundImage: 'https://ubi.example/a.webp', backgroundImageFit: 'tile' }),
        ).toMatchObject({ backgroundRepeat: 'repeat' });
    });

    it('CSS の値を抜け出せない', () => {
        const style = backgroundImageStyle({ backgroundImage: 'https://ubi.example/a"); color: red; ("x' });
        expect(style?.backgroundImage).toBe('url("https://ubi.example/a%22);%20color:%20red;%20(%22x")');
        expect(backgroundImageStyle({ backgroundImage: 'javascript:alert(1)' })).toBeNull();
        expect(backgroundImageStyle({ backgroundImage: 'not a url' })).toBeNull();
        expect(backgroundImageStyle({})).toBeNull();
    });
});
