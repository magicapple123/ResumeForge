// SPDX-License-Identifier: Apache-2.0
/**
 * 简历编辑器的头部：一行"说明 + 快捷动作"（项 9）。
 *
 * 抽出来的两个理由：
 * 1. 说明文字与「填入我的资料全部数据」原来各占一行（两段独立 DOM + 两个 `margin-bottom`），
 *    在多出一块"按钮行"之后表单被整体往下推。合并成一行后说明自己占满剩余宽度、按钮贴
 *    最右，窄屏（≤640px）自动换行。
 * 2. `ResumeEditorModal` 已经贴到单文件 500 行预算，头部再长东西就必须先搬出去。
 *
 * `headerExtra` 是为项 11（简历名称输入移进编辑器顶部）预留的插槽：渲染在说明行**之上**，
 * 这样那一项落地时不必再动这个文件。
 */
import { ImportOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 说明文字。不传则不占位（例如编辑已保存简历时不需要额外解释）。 */
  description?: string;
  /**
   * 提供后渲染「填入我的资料全部数据」次按钮。
   *
   * 用"回调存在与否"表达"要不要这个入口"，而不是再加一个布尔开关：两者永远同步，
   * 多一个布尔就有"开着按钮却没有处理函数"的状态。
   */
  onFillAll?: () => void;
  /** 渲染在说明行之上的额外内容（项 11 的简历名称输入）。 */
  headerExtra?: ReactNode;
}

export default function EditorHeader({ description, onFillAll, headerExtra }: Props) {
  useLocale();
  // 三样都没有时不渲染任何东西：否则会留下一个只有下边距的空盒子。
  if (!description && !onFillAll && !headerExtra) return null;

  return (
    <>
      {headerExtra}
      {description || onFillAll ? (
        <div className="resume-editor-hint-row">
          {description ? (
            <Typography.Text type="secondary" className="resume-editor-description">
              {description}
            </Typography.Text>
          ) : null}
          {onFillAll ? (
            <Button
              size="small"
              icon={<ImportOutlined />}
              aria-label={t("editor.header.fillAll")}
              onClick={onFillAll}
            >
              {t("editor.header.fillAll")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
