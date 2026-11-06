/**
 * pin 済み mod のバージョンを最新へ更新し、world.yaml を書き換えてロックを再生成する
 * （`ubichill update`）。実体は `@ubichill/loader` の updateDependencies。
 */
export { runUpdate } from '@ubichill/loader/update-dependencies';
