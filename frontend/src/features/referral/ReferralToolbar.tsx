// SPDX-License-Identifier: Apache-2.0
/** 内推列表的筛选与工具栏：关键词搜索、状态筛选、新建入口。
 *
 * 从 `ReferralPanel` 拆出只为控制文件长度：三个控件、文案与顺序都与拆前一致，
 * 状态与请求仍由面板持有（这里只是受控展示）。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Card, Input, Select, Space } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { REFERRAL_STATUS_LABELS_OPTIONS } from "./ReferralFormFields";

interface Props {
  status: string | undefined;
  onStatusChange: (value: string | undefined) => void;
  onSearch: (keyword: string) => void;
  onCreate: () => void;
}

export default function ReferralToolbar({ status, onStatusChange, onSearch, onCreate }: Props) {
  // `REFERRAL_STATUS_LABELS_OPTIONS()` 返回的是 `t()` 的结果，所以这里必须订阅语言变化；
  // 不订阅的话切语言后状态下拉会停在上一种语言（交接单 §8 的静默失效）。
  useLocale();
  return (
    <Card size="small" title={t("referralForm.toolbar.title")}>
      <Space wrap>
        <Input.Search
          allowClear
          placeholder={t("referralForm.toolbar.searchPlaceholder")}
          style={{ width: 240 }}
          onSearch={onSearch}
        />
        <Select
          allowClear
          placeholder={t("referralForm.toolbar.statusPlaceholder")}
          style={{ minWidth: 140 }}
          value={status}
          onChange={onStatusChange}
          options={REFERRAL_STATUS_LABELS_OPTIONS()}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          {t("referralForm.toolbar.create")}
        </Button>
      </Space>
    </Card>
  );
}
