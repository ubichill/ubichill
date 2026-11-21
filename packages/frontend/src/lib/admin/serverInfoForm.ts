import type { ServerInfo } from '@ubichill/shared';

/** 入力欄の中身（空の欄は ''）。 */
export type ServerInfoDraft = { [K in keyof ServerInfo]: string };

export function serverInfoDraft(info: ServerInfo): ServerInfoDraft {
    return {
        name: info.name,
        description: info.description ?? '',
        maintainerName: info.maintainerName ?? '',
        maintainerEmail: info.maintainerEmail ?? '',
        tosUrl: info.tosUrl ?? '',
        privacyPolicyUrl: info.privacyPolicyUrl ?? '',
        inquiryUrl: info.inquiryUrl ?? '',
        repositoryUrl: info.repositoryUrl ?? '',
        impressumUrl: info.impressumUrl ?? '',
    };
}

/** 保存したものから変えたか（前後の空白だけの違いは変えていない扱い。サーバーが落とすため） */
export function serverInfoChanged(info: ServerInfo, draft: ServerInfoDraft): boolean {
    const saved = serverInfoDraft(info);
    return (Object.keys(saved) as Array<keyof ServerInfoDraft>).some((key) => saved[key] !== draft[key].trim());
}
