// SPDX-License-Identifier: Apache-2.0
/** 导出入口：全页面唯一的「导出」按钮，点击打开统一的导出面板。
 *
 * 历史上这里有「下载 PDF」+「更多格式」两个入口，预览页另有一套「导出选项」、再加一个
 * 「一键脱敏」。三套入口各自拼参数，于是"预览里调过的字号/行距没进导出"这类问题只出现
 * 在其中一条路径上。现在收成一个入口 + 一份请求体（见 ExportOptionsModal）。
 */
import { ExportOutlined } from "@ant-design/icons";
import { Badge, Button, Tooltip } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeLayout } from "../../../types";
import ExportOptionsModal from "./ExportOptionsModal";

interface Props {
  recordId: number;
  /** 预览当前的版式草稿：导出必须与眼前所见同参数。 */
  layout?: ResumeLayout;
  /** 服务端是否找到中文字体；为 false 时面板里只给浏览器打印。 */
  pdfDirectAvailable?: boolean;
  /**
   * 由父组件接管弹窗（父组件还需要从「简历制作台」等地方打开同一个面板时用）。
   * 提供时本组件只画按钮，不再自己挂一份弹窗——两份实例会各自持有一份表单状态。
   */
  onOpen?: () => void;
  /**
   * 还没人工核对过的条数（2026-11 问题 8）：> 0 时按钮右上角挂一颗琥珀点。
   *
   * 核对项被压成一行后，用户可能不展开就直接导出；角标把"还有东西没看"留在视野里。
   * 这只是**提示**，不拦导出——拦截会让"我就想先导出看看"变成一条死路。
   */
  pendingReview?: number;
}

export default function ExportButtons({
  recordId,
  layout,
  pdfDirectAvailable = true,
  onOpen,
  pendingReview = 0,
}: Props) {
  useLocale();
  const [open, setOpen] = useState(false);

  const button = (
    <Button
      type="primary"
      icon={<ExportOutlined />}
      onClick={() => (onOpen ? onOpen() : setOpen(true))}
    >
      {t("componentsMisc.exportButtons.export")}
    </Button>
  );

  return (
    <>
      {pendingReview > 0 ? (
        <Tooltip title={t("resume.footer.exportPending", { count: pendingReview })}>
          {/* 包一层 span：Tooltip 需要一个能接 ref 的元素，Badge 的 dot 也挂在它内部。 */}
          <span className="resume-export-pending">
            <Badge dot color="gold">
              {button}
            </Badge>
          </span>
        </Tooltip>
      ) : (
        button
      )}
      {onOpen ? null : (
        <ExportOptionsModal
          recordId={recordId}
          open={open}
          initialPageLimit={layout?.page_limit}
          initialFontScale={layout?.font_scale}
          initialFormatConfig={layout?.format_config}
          initialLanguage={layout?.language}
          pdfDirectAvailable={pdfDirectAvailable}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
