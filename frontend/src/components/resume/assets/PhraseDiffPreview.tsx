// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产保存/插入前的**轻量差异预览**（W17 / D16「更新先看差异」）。
 *
 * 复用版本对比的 `wordDiff` 与 `DiffTokenText`（同一套三态配色），不另写 diff 算法。
 * 组件无副作用：确认动作由宿主在执行；本组件只回答"将替换成什么"。
 */
import { Space, Typography } from "antd";
import { DiffTokenText } from "../../ResumeDiffView";
import { wordDiff } from "../../../utils/resumeFieldDiff";
import { at } from "../../../features/resume-assets/i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export default function PhraseDiffPreview({ before, after, beforeLabel, afterLabel }: Props) {
  useLocale();
  if (before === after) {
    return <Typography.Text type="secondary">{at("assets.diff.noChange")}</Typography.Text>;
  }
  const { oldTokens, newTokens } = wordDiff(before, after);
  return (
    <div data-phrase-diff="1">
      <Space orientation="vertical" size={6} style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {beforeLabel ?? at("assets.diff.before")}
          </Typography.Text>
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <DiffTokenText tokens={oldTokens} />
          </div>
        </div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {afterLabel ?? at("assets.diff.after")}
          </Typography.Text>
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <DiffTokenText tokens={newTokens} />
          </div>
        </div>
      </Space>
    </div>
  );
}
