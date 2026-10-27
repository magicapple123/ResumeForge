// SPDX-License-Identifier: Apache-2.0
/** 导出入口：全页面唯一的「导出」按钮，点击打开统一的导出面板。
 *
 * 历史上这里有「下载 PDF」+「更多格式」两个入口，预览页另有一套「导出选项」、再加一个
 * 「一键脱敏」。三套入口各自拼参数，于是"预览里调过的字号/行距没进导出"这类问题只出现
 * 在其中一条路径上。现在收成一个入口 + 一份请求体（见 ExportOptionsModal）。
 */
import { ExportOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useState } from "react";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import type { ResumeLayout } from "../types";
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
}

export default function ExportButtons({
  recordId,
  layout,
  pdfDirectAvailable = true,
  onOpen,
}: Props) {
  useLocale();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="primary"
        icon={<ExportOutlined />}
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
      >
        {t("componentsMisc.exportButtons.export")}
      </Button>
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
