// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录面板的筛选区（纯展示子组件，PR-18 拆分批从 ApplyRecordsPanel 纯搬迁）：
 * 关键词搜索、结果筛选、刷新按钮与「去求职进度跟进」入口。
 * 全部状态与请求都在主组件，这里只接收 props 渲染、回调上报，不改任何行为。
 */
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Select, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 结果筛选项：`value` 是提交给后端的协议值，展示名在渲染处按 labelKey 取。 */
const RESULT_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "success", labelKey: "applyUi.toolbar.resultSuccess" },
  { value: "failed", labelKey: "applyUi.toolbar.resultFailed" },
  { value: "skipped", labelKey: "applyUi.toolbar.resultSkipped" },
];

interface Props {
  searchText: string;
  result: string;
  onSearchTextChange: (value: string) => void;
  onSearch: (value: string) => void;
  onResultChange: (value: string) => void;
  onReload: () => void;
}

export default function ApplyRecordsToolbar({
  searchText,
  result,
  onSearchTextChange,
  onSearch,
  onResultChange,
  onReload,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后筛选区停在旧文案。
  useLocale();
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Input.Search
        placeholder={t("applyUi.toolbar.searchPlaceholder")}
        allowClear
        enterButton={<SearchOutlined />}
        style={{ width: 260 }}
        value={searchText}
        onChange={(event) => onSearchTextChange(event.target.value)}
        onSearch={onSearch}
      />
      <Select
        placeholder={t("applyRecords.column.result")}
        allowClear
        style={{ width: 130 }}
        options={RESULT_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={result || undefined}
        onChange={(value) => onResultChange(value ?? "")}
      />
      <Button icon={<ReloadOutlined />} onClick={onReload}>
        {t("common.action.refresh")}
      </Button>
      {/* 投递记录的"下一步"在求职进度：补一个小入口，不用用户自己找。 */}
      <Link to="/tracker">
        <Button type="link" size="small" style={{ padding: 0 }}>
          {t("applyUi.toolbar.goTracker")}
        </Button>
      </Link>
      <Typography.Text type="secondary">{t("applyUi.toolbar.groupHint")}</Typography.Text>
    </Space>
  );
}
