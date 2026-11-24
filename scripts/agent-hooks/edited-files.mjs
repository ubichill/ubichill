/**
 * PostToolUse の tool_input から、書き込んだファイルの絶対パスを取り出す。
 * Claude Code（Edit・Write・MultiEdit）は `file_path`、Codex（apply_patch）は `command` にパッチの本文が入る。
 */
import { isAbsolute, join } from 'node:path';

// codex-rs/apply-patch の見出し。消したファイル（Delete File）は整形しない
const PATCH_TARGET = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm;

/**
 * @param {unknown} toolInput
 * @param {string} cwd 相対パスの基準（Codex のパッチは作業ディレクトリからの相対パスで書かれる）
 * @returns {string[]}
 */
export const editedFiles = (toolInput, cwd) => {
    const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
    const absolute = (path) => (isAbsolute(path) ? path : join(cwd, path));
    if (typeof input.file_path === 'string') return [absolute(input.file_path)];
    if (typeof input.command !== 'string' || !input.command.includes('*** Begin Patch')) return [];
    const paths = [...input.command.matchAll(PATCH_TARGET)].map((m) => absolute(m[1].trim()));
    return [...new Set(paths)];
};
