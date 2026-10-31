// SPDX-License-Identifier: Apache-2.0
/** 新建条目的临时键（从 ProfileEntrySection 拆出：组件文件只导出组件）。 */
let tempCounter = 0;

/** 新建条目的临时键：保存成功后由服务端 entry_id 替换。 */
export function makeTempEntryKey(): string {
  tempCounter += 1;
  return "new:" + Date.now().toString(36) + ":" + tempCounter;
}
