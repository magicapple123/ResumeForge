// SPDX-License-Identifier: Apache-2.0
/**
 * 助手技能类型。
 *
 * 名字统一带 `AssistantSkill` 前缀：`Skill`（个人资料技能）和 `ResumeSkill`
 * （简历里的技能）已经占用了短名字，三者含义完全不同，不能混。
 */

/** 一份已导入的技能。提示词正文不回传，列表只需要元信息。 */
export interface AssistantSkill {
  id: number;
  name: string;
  /** 适用场景，来自技能包里的 frontmatter 或工作台填写。 */
  description: string;
  enabled: boolean;
  /** 导入时的文件名；工作台创建的技能为「技能工作台」。 */
  source_name: string;
  /** 提示词长度：界面用它提示"这个技能有多大"。 */
  prompt_chars: number;
  /** 附带的知识文件名清单（正文由助手按需读取）。 */
  files: string[];
  updated_at: string;
  // ===== 0016（#31D/E/F 技能学习）：四段内容、版本与验证状态 =====
  /** 何时使用（四段内容之一；老技能为空串）。 */
  when_to_use?: string;
  /** 步骤（换行分隔的文本；老技能为空串）。 */
  steps?: string;
  /** 反例与注意事项（老技能为空串）。 */
  pitfalls?: string;
  /** 技能版本；自动生成/更新时自增。 */
  version?: number;
  /** 是否由对话自动生成（true 时默认待验证、不自动启用）。 */
  generated?: boolean;
  /** 验证状态："" = 无需验证 / pending = 待验证 / validated = 已验证。 */
  validation_status?: string;
  /** 最近一次被加载进系统提示的时间（90 天未加载 → 提示归档）。 */
  last_loaded_at?: string | null;
}

export interface AssistantSkillFileInfo {
  path: string;
  size_bytes: number;
  /** 文件正文；因超出上限未加载时为空串（同时 files_truncated 为 true）。 */
  content: string;
}

/** 技能详情：查看与编辑时需要提示词正文。 */
export interface AssistantSkillDetail extends AssistantSkill {
  prompt: string;
  file_details: AssistantSkillFileInfo[];
  /** 有知识文件没带正文：编辑时不要覆盖式提交 files，避免写丢内容。 */
  files_truncated: boolean;
}

export interface AssistantSkillFileInput {
  path: string;
  content: string;
}

export interface AssistantSkillCreatePayload {
  name: string;
  description?: string;
  prompt: string;
  enabled?: boolean;
  files?: AssistantSkillFileInput[];
}

export interface AssistantSkillUpdatePayload {
  name?: string;
  description?: string;
  prompt?: string;
  enabled?: boolean;
  files?: AssistantSkillFileInput[];
}
