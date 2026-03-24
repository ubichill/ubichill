/**
 * @ubichill/sandbox — Worker-safe entry point.
 *
 * Guest（Worker内部）の型のみをエクスポートする。
 * DOM に依存するホスト側 API（PluginHostManager 等）は @ubichill/sandbox/host から。
 */
export * from './guest/index';
