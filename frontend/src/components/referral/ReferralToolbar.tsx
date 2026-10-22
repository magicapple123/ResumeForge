// SPDX-License-Identifier: Apache-2.0
/** 内推列表的筛选与工具栏：关键词搜索、状态筛选、新建入口。
 *
 * 从 `ReferralPanel` 拆出只为控制文件长度：三个控件、文案与顺序都与拆前一致，
 * 状态与请求仍由面板持有（这里只是受控展示）。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Card, Input, Select, Space } from "antd";
import { REFERRAL_STATUS_LABELS_OPTIONS } from "./ReferralFormFields";

interface Props {
  status: string | undefined;
  onStatusChange: (value: string | undefined) => void;
  onSearch: (keyword: string) => void;
  onCreate: () => void;
}

export default function ReferralToolbar({ status, onStatusChange, onSearch, onCreate }: Props) {
  return (
    <Card size="small" title="内推记录">
      <Space wrap>
        <Input.Search
          allowClear
          placeholder="搜索公司 / 岗位 / 内推人"
          style={{ width: 240 }}
          onSearch={onSearch}
        />
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ minWidth: 140 }}
          value={status}
          onChange={onStatusChange}
          options={REFERRAL_STATUS_LABELS_OPTIONS()}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          新建内推
        </Button>
      </Space>
    </Card>
  );
}
