// SPDX-License-Identifier: Apache-2.0
/**
 * 深链落点提示：搜索命中的板块不在当前方案里。
 *
 * 不静默失败（用户点了结果却看不到东西是最难诊断的一类"跳错页"）：说明原因，并给
 * 一个真的能解决问题的动作——把该板块加回当前方案的参与清单。加回后深链会自动
 * 重跑（参与状态变化会换 signature），展开并滚到该板块。
 */
import { Alert, Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  sectionName: string;
  onShow: () => void;
}

export default function ProfileDeepLinkNotice({ sectionName, onShow }: Props) {
  useLocale();
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      title={t("profileLibrary.deepLink.hiddenTitle", { name: sectionName })}
      action={
        <Button size="small" onClick={onShow}>
          {t("profileLibrary.deepLink.showInScheme")}
        </Button>
      }
    />
  );
}
