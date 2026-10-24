// SPDX-License-Identifier: Apache-2.0
/**
 * W07 的属性来源胶囊（三态 + 角色一档）：来自模板 / 来自版式 / 同类段落已调整 / 本条已调整。
 *
 * 为什么单独成文件：角色面板的每一行、对象面板的每一行、格式刷的说明都用同一个判定。
 * 各写一个 `<span>` + 一套文案，第一个漂移的地方一定是"到底哪一档该说'本篇'"。
 *
 * 术语按 `docs/ui-copy-guide.md` 与 wave2 契约 §2.5：来源必须让用户能判断"我这一拖动
 * 会影响多少内容"——所以三档之外，角色档单独说成"同类段落已调整"，不能并进"整份简历"
 * 或"这一条"（并进任一侧都会说错作用范围）。
 */
import { Tooltip } from "antd";
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import type { ResumeStyleSource } from "../../../features/resume-layout/styleOverrides";

/** 胶囊上显示的字。 */
const SOURCE_LABEL: Record<ResumeStyleSource, MessageKey> = {
  template: "typography.source.template",
  resume: "typography.source.resume",
  role: "typography.source.role",
  object: "typography.source.object",
};

/** 胶囊的 Tooltip：把"为什么是这一档"说清（键盘可聚焦，不依赖悬停）。 */
const SOURCE_HINT: Record<ResumeStyleSource, MessageKey> = {
  template: "typography.source.template.title",
  resume: "typography.source.resume.title",
  role: "typography.source.role.title",
  object: "typography.source.object.title",
};

interface Props {
  source: ResumeStyleSource;
}

export default function StyleSourceTag({ source }: Props) {
  return (
    <Tooltip title={t(SOURCE_HINT[source])}>
      <span
        className={`resume-measure-source resume-typography-source is-${source}`}
        data-source={source}
        style={{ width: "auto", whiteSpace: "nowrap" }}
      >
        {t(SOURCE_LABEL[source])}
      </span>
    </Tooltip>
  );
}
