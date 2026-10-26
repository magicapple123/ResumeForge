// SPDX-License-Identifier: Apache-2.0
/**
 * 参数行右侧那颗「恢复到打开时的值」按钮。
 *
 * 单独成文件的两个理由：
 * 1. 六个控件（行距 / 页边距 / 字号 / 字体 / 照片 / 间距 / 颜色）都要用它，
 *    各写一遍图标 + Tooltip + 无障碍名必然分叉；
 * 2. 它的**出现条件与恢复语义**不在按钮里（按钮只负责"长什么样、点了叫什么"），
 *    判据与数据搬动在 `utils/paramRestore`。这样按钮可以毫无歧义地复用到别的行。
 *
 * 为什么不是"双击标题"：双击是给老用户的快捷方式，新用户看不见。用户要的是
 * **看得见、点得到**的入口，所以它占用的是来源胶囊（「随模板」）那一格——
 * 那一格在参数被改过之后本来就是空的，正好由它接管。
 */
import { UndoOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 参数名（行距 / 页边距 / 字号…）：只用于无障碍名与气泡，不显示在按钮上。 */
  label: string;
  onReset: () => void;
}

export default function ParamResetButton({ label, onReset }: Props) {
  useLocale();
  return (
    <Tooltip title={t("workbench.param.restoreToOpened")}>
      <Button
        size="small"
        type="text"
        className="resume-param-restore"
        icon={<UndoOutlined />}
        aria-label={t("workbench.param.restoreToOpenedAria", { label })}
        onClick={onReset}
      />
    </Tooltip>
  );
}
