import { describe, expect, it } from 'vitest';
import { renderShell } from './shell';

const INDEX = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/icon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ubichill</title>
    <meta name="description" content="2D metaverse-style work sharing application" />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe('renderShell', () => {
    it('既定のタイトル・説明・アイコンを外し、組み立てたものを </head> の前に入れる', () => {
        const html = renderShell(INDEX, '<title>新</title>', '<p>shell</p>');
        expect(html.match(/<title>/g)).toHaveLength(1);
        expect(html).toContain('<title>新</title>\n</head>');
        expect(html).not.toContain('2D metaverse-style');
        expect(html).not.toContain('href="/icon.png"');
        expect(html).toContain('<meta name="viewport"');
        expect(html).toContain('<script type="module" crossorigin src="/assets/index-abc.js"></script>');
        expect(html).toContain('<div id="root"><p>shell</p></div>');
    });

    it("入れるものに $& や $' があっても、置き換えの記号として読まない", () => {
        const html = renderShell(INDEX, "<title>$& $' $`</title>", '$&');
        expect(html).toContain("<title>$& $' $`</title>");
        expect(html).toContain('<div id="root">$&</div>');
    });
});
