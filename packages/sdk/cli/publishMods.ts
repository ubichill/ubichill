/**
 * `ubichill publish <mods のビルド出力>`: mod の配布物に作者アカウント付きで署名する。
 *
 * `ubichill build` が出力した `v<version>/lock.json` ごとに、兄弟の `lock.sig.json` を書き出す（出力の配置は modLayout.ts）。
 * 署名に使う鍵と作者アカウントはワールドと同じ（`ubichill login`、CI は UBICHILL_CREDENTIALS）。
 * mod はサーバーへ送らない。署名済みの出力をそのまま GitHub Pages などへ置く。
 */
import { join } from 'node:path';
import { MOD_SIGNATURE_FILE, ModLockEntrySchema, signMod, type WorldSigningKey } from '@ubichill/shared';
import type { Credential } from './credentials.ts';
import { type ModVersionDir, modVersionDirs } from './modLayout.ts';

export interface PublishModsDeps {
    fs: {
        readText: (path: string) => string | undefined;
        writeText: (path: string, text: string) => void;
        /** 直下のディレクトリ名（無ければ空）。 */
        listDirs: (path: string) => string[];
    };
    key: WorldSigningKey;
    crypto: Parameters<typeof signMod>[2];
    log: (message: string) => void;
}

export interface PublishModsOptions {
    modsDir: string;
    credential: Pick<Credential, 'account'>;
}

function readLock(deps: PublishModsDeps, target: ModVersionDir) {
    const lockPath = join(target.dir, 'lock.json');
    const text = deps.fs.readText(lockPath);
    if (text === undefined) return undefined;
    const parsed = ModLockEntrySchema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success) throw new Error(`${lockPath} を lock として読めません（ubichill build し直してください）`);
    // Host は <modId>/v<version>/ から取得するので、置き場所と中身が違う lock には署名しない
    const { id, version } = parsed.data;
    if ((target.modId !== undefined && id !== target.modId) || `v${version}` !== target.versionDir) {
        throw new Error(`${lockPath} の中身（${id}@${version}）が置き場所（${target.label}）と違います`);
    }
    return parsed.data;
}

/** 出力にある全 mod・全版に署名し、書き出した署名ファイルのパスを返す。1 つも無ければ失敗（パスの指定ミスに気付けるように）。 */
export async function publishMods(deps: PublishModsDeps, options: PublishModsOptions): Promise<string[]> {
    const locks = modVersionDirs(options.modsDir, deps.fs.listDirs).flatMap((target) => {
        const entry = readLock(deps, target);
        return entry ? [{ ...target, entry }] : [];
    });
    if (locks.length === 0) {
        throw new Error(`${options.modsDir} に署名する mod がありません（先に ubichill build を実行してください）`);
    }
    const written: string[] = [];
    for (const { dir, entry } of locks) {
        const signature = await signMod(entry, deps.key, deps.crypto, { author: options.credential.account });
        const sigPath = join(dir, MOD_SIGNATURE_FILE);
        deps.fs.writeText(sigPath, `${JSON.stringify(signature, null, 2)}\n`);
        deps.log(`🔏 ${sigPath}（${entry.id}@${entry.version}、作者 @${options.credential.account}）`);
        written.push(sigPath);
    }
    return written;
}
