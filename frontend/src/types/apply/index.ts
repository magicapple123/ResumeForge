/**
 * 「自动采集 + 匹配度分析 + 自动投递」的前端类型镜像（子模块 barrel）。
 *
 * 这里的字符串字面量联合类型与 `backend/app/models/apply.py` 的常量**逐字一致**，
 * 改一处必须同步另一处（设计 §9 ⑨）。界面只读后端返回的 `admission` / `requires_confirm`，
 * **不在这里再判一次准入**——判断的权威只有后端 `admission_of()` 一处。
 *
 * 消费方仍经 `../types` barrel（`export * from "./apply"`）使用，本文件保持
 * `export *` 语义与原单文件版完全一致。
 */
export * from "./match";
export * from "./tasks";
export * from "./failures";
export * from "./config";
export * from "./queue";
export * from "./sites";
