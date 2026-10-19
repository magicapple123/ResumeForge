/**
 * 备份包下载名（R15）：前端先填一个默认值，用户可以在导出弹窗里改。
 *
 * 规则与后端 `services/data_backup/naming.py` 一致（`<名字>-YYYYMMDD-HHMMSS`），
 * 但**这里不做字符清洗**：清洗只应有后端一份，前端预填的名字是给用户看的、也是给人改的；
 * 两边各写一份清洗规则，迟早会在"哪个字符算非法"上分叉。
 */
export function defaultExportName(label: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${label}-${stamp}`;
}
