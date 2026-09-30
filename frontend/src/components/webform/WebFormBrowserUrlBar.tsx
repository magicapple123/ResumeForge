import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Space, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import type { WebFormUrlHistory } from "../../types";

interface Props {
  value: string;
  history: WebFormUrlHistory[];
  busy: boolean;
  onChange: (value: string) => void;
  onOpen: () => void;
  onSelectHistory: (item: WebFormUrlHistory) => void;
  onDeleteHistory: (item: WebFormUrlHistory) => void;
}

export default function WebFormBrowserUrlBar({
  value,
  history,
  busy,
  onChange,
  onOpen,
  onSelectHistory,
  onDeleteHistory,
}: Props) {
  const items: MenuProps["items"] = history.map((item) => ({
    key: String(item.id),
    label: (
      <Space style={{ maxWidth: 420 }} onClick={() => onSelectHistory(item)}>
        <Typography.Text ellipsis={{ tooltip: item.url }} style={{ width: 330 }}>
          {item.title || item.url}
        </Typography.Text>
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label={`删除网址 ${item.url}`}
          onClick={(event) => {
            event.stopPropagation();
            onDeleteHistory(item);
          }}
        />
      </Space>
    ),
  }));

  return (
    <div className="webform-url-bar">
      <Input
        className="webform-url-input"
        value={value}
        prefix={<LinkOutlined />}
        placeholder="输入要填写网申的目标网址（http:// 或 https://）"
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onOpen}
        aria-label="网申投递网址"
      />
      <Space className="webform-url-actions" size={8} wrap>
        <Tooltip title="在网申专用浏览器中打开，不会覆盖已有网页">
          <Button type="primary" loading={busy} disabled={busy} onClick={onOpen}>
            打开目标页
          </Button>
        </Tooltip>
        <Dropdown menu={{ items }} disabled={busy || history.length === 0} trigger={["click"]}>
          <Button disabled={busy || history.length === 0}>历史网址</Button>
        </Dropdown>
      </Space>
    </div>
  );
}
