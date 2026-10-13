/**
 * 投递记录面板的筛选区（纯展示子组件，PR-18 拆分批从 ApplyRecordsPanel 纯搬迁）：
 * 关键词搜索、结果筛选、刷新按钮与「去求职进度跟进」入口。
 * 全部状态与请求都在主组件，这里只接收 props 渲染、回调上报，不改任何行为。
 */
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Select, Space, Typography } from "antd";
import { Link } from "react-router-dom";

const RESULT_OPTIONS = [
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "skipped", label: "已跳过" },
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
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Input.Search
        placeholder="搜索岗位 / 公司"
        allowClear
        enterButton={<SearchOutlined />}
        style={{ width: 260 }}
        value={searchText}
        onChange={(event) => onSearchTextChange(event.target.value)}
        onSearch={onSearch}
      />
      <Select
        placeholder="结果"
        allowClear
        style={{ width: 130 }}
        options={RESULT_OPTIONS}
        value={result || undefined}
        onChange={(value) => onResultChange(value ?? "")}
      />
      <Button icon={<ReloadOutlined />} onClick={onReload}>
        刷新
      </Button>
      {/* 投递记录的"下一步"在求职进度：补一个小入口，不用用户自己找。 */}
      <Link to="/tracker">
        <Button type="link" size="small" style={{ padding: 0 }}>
          去求职进度跟进
        </Button>
      </Link>
      <Typography.Text type="secondary">
        按投递批次分组：一次投出的多个岗位归在一组，点击展开看明细
      </Typography.Text>
    </Space>
  );
}
