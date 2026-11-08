// SPDX-License-Identifier: Apache-2.0
/**
 * 已废弃（T14）：技能改为按对话启用，实现与文档都在 `./useConversationSkills`。
 *
 * 保留文件而不是直接删掉：同一工作区里多条任务线并行，删除文件容易踩到其它工具/分支
 * 的引用；这里只做转发，真正逻辑只有一份。
 */
export { useConversationSkills } from "./useConversationSkills";
