// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区底部工具栏（R06 之后的形状）：
 *
 * 左：`+`（附件 / 关联岗位 / 关联简历 / 技能，见 `composer/AddMenu.tsx`）→ 数据权限 → 允许联网；
 * 右：`ReasoningChip`（模型 · 推理等级）→ 语音 → 发送。
 *
 * R06 删掉的两块：附件独立按钮（挪进 `+` 面板）与整组「思考强度」（标签 + 问号 + 下拉 +
 * 自定义输入框，合并进右侧 chip）。技能仍不是这里的一个下拉——它按对话启用，
 * 入口在 `+` 面板的技能二级里，一个能力只有一个入口。
 *
 * 本文件只管排版与"谁能点"：模型名与档位的取数、自定义档位的输入态都在
 * `composer/ReasoningChip.tsx`，附件与上下文在 `composer/AddMenu.tsx`。语音按钮由语音线
 * （T12）填 voiceSlot，本文件不依赖它。
 */
import type { ReactNode } from "react";
import { Button, Switch, Tooltip } from "antd";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import type { ReasoningEffort } from "../../../../types/assistant";
import type { ContextUsage } from "../../../../types";
import AddMenu from "./AddMenu";
import type { AddMenuProps } from "./AddMenu";
import ContextUsageChip from "./ContextUsageChip";
import PermissionMenu from "./PermissionMenu";
import type { PermissionMenuProps } from "./PermissionMenu";
import ReasoningChip from "./ReasoningChip";
import { SendUpIcon, StopSquareIcon } from "./SendUpIcon";

export interface ComposerToolbarProps {
  compact: boolean;
  content: string;
  sending: boolean;
  attachmentsCount: number;
  attachmentReads: number;
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  /** 语音按钮槽位（T12 由语音线填入；这里只占位）。 */
  voiceSlot?: ReactNode;
  permission: PermissionMenuProps;
  /** 左侧「+」面板的全部输入（附件 / 关联 / 技能）。 */
  addMenu: AddMenuProps;
  /**
   * 上下文用量（需求 #6）。`null` = 还不知道（chip 显示「上下文 —」，不猜数字）。
   * 可选：输入区之外（如浅测试）不传时 chip 照常渲染，只是没有数字。
   */
  contextUsage?: ContextUsage | null;
  /** 弹层里改了上下文窗口后，让上层本地重算百分比。 */
  onContextWindowSaved?: (windowTokens: number) => void;
  /** 压缩 / 还原按会话调用（#10）；不传时弹层里的压缩动作禁用。 */
  contextConversationId?: number | null;
  /** 压缩或还原成功后让上层重取用量。 */
  onContextChanged?: () => void;
  onWebSearchChange: (value: boolean) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onSend: () => void;
  onStop: () => void;
}

export default function ComposerToolbar({
  compact,
  content,
  sending,
  attachmentsCount,
  attachmentReads,
  webSearch,
  reasoningEffort,
  voiceSlot,
  permission,
  addMenu,
  contextUsage = null,
  onContextWindowSaved,
  contextConversationId = null,
  onContextChanged,
  onWebSearchChange,
  onReasoningEffortChange,
  onSend,
  onStop,
}: ComposerToolbarProps) {
  useLocale();
  // 空输入且没有附件时不能发：禁用态靠"降不透明度 + not-allowed + 保留 Tooltip"三样一起
  // 表达（文字去掉之后，只靠颜色在小尺寸下几乎看不出不可点）。
  const sendDisabled = attachmentReads > 0 || (!content.trim() && attachmentsCount === 0);

  return (
    <div className="assistant-composer-actions">
      <div className="assistant-composer-utility">
        <AddMenu {...addMenu} />
        <PermissionMenu {...permission} />
        <div className="assistant-context-toggles">
          {/*
            开关语义是「允许联网」而不是「每次搜索」：动作用 label 文字表达（用户能读懂这是
            许可），边界用原生 `title` 补一句（不用 antd Tooltip——compact 形态下浮层与
            工具栏层级会打架）。`title` 只挂在 label 上，accessible name 仍来自 label 文本。
          */}
          <label
            className="assistant-context-toggle"
            title={t("assistantComposer.toggle.webSearchHint")}
          >
            <Switch size="small" checked={webSearch} onChange={onWebSearchChange} />
            <span>{t("assistantComposer.toggle.webSearch")}</span>
          </label>
          {/* 上下文用量（需求 #6）：与「允许联网」「数据权限」同一排，点开是五段构成。 */}
          <ContextUsageChip
            usage={contextUsage}
            onWindowSaved={onContextWindowSaved}
            conversationId={contextConversationId}
            onContextChanged={onContextChanged}
          />
        </div>
      </div>
      <div className="assistant-composer-submit">
        <ReasoningChip
          compact={compact}
          sending={sending}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
        />
        {voiceSlot}
        {/*
          发送 / 停止：只留图标，不渲染文字（`action.send` / `action.stop` 只给 Tooltip 用，
          `aria.*` 保留给读屏）。外层 `<span>` 不是多余的：disabled 的 antd Button 不派发
          鼠标事件，不包一层 Tooltip 在空输入时永远不出现。
        */}
        {sending ? (
          <Tooltip title={t("assistantComposer.action.stop")} placement="top">
            <span className="assistant-composer-send-wrap">
              <Button
                shape="circle"
                color="danger"
                variant="filled"
                className="assistant-composer-send"
                aria-label={t("assistantComposer.aria.stop")}
                icon={<StopSquareIcon />}
                onClick={onStop}
              />
            </span>
          </Tooltip>
        ) : (
          <Tooltip title={t("assistantComposer.action.send")} placement="top">
            <span className="assistant-composer-send-wrap">
              <Button
                type="primary"
                shape="circle"
                className="assistant-composer-send"
                aria-label={t("assistantComposer.aria.send")}
                icon={<SendUpIcon />}
                disabled={sendDisabled}
                onClick={onSend}
              />
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
