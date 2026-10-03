/**
 * 岗位广场的筛选选项与批量操作类型。
 * （自 JobsPage 拆出的共享常量：筛选栏与批量工具栏都用 STATUS_OPTIONS。）
 */

export const JOB_TYPE_OPTIONS = ["校招", "实习", "社招", "其他"].map((value) => ({ value, label: value }));
export const STATUS_OPTIONS = ["开放中", "已截止", "已投递"].map((value) => ({ value, label: value }));
// 与后端 `source_kind` 查询参数一一对应；标签用「自动采集 / 手动添加」是因为这是用户能
// 一眼理解的二分，而不是把 recognition_source 的原始值直接搬上来。
export const SOURCE_KIND_OPTIONS = [
  { value: "collected", label: "自动采集" },
  { value: "manual", label: "手动添加" },
];

export type BatchAction = "status" | "delete" | null;
export type MatchBatchRunMode = "immediate" | "background";
