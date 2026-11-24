/**
 * index.html（Vite の成果物）に、組み立てた <head> と SSR シェルを入れる。
 * index.html に書いてある既定のタイトル・説明・アイコンは、組み立てたものと重ならないよう外す（Vite の開発サーバーはそのまま使う）。
 */
export function renderShell(indexHtml: string, headTags: string, bodyShell = ''): string {
    // 置換値は関数で渡す（文字列だと headTags・bodyShell の `$&` `$'` などが特別に読まれ、HTML が壊れる）
    return indexHtml
        .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
        .replace(/<meta\s+name="description"[^>]*>\s*/i, '')
        .replace(/<link\s+rel="icon"[^>]*>\s*/i, '')
        .replace('</head>', () => `${headTags}\n</head>`)
        .replace(/<div id="root"><\/div>/, () => `<div id="root">${bodyShell}</div>`);
}
