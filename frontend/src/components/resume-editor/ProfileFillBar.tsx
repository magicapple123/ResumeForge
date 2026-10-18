/**
 * 「从我的资料填入」的下拉 + 按钮。
 *
 * 手写简历的第一版是从资料**预填**的，所以那时没什么可填的；真正缺的是"预填之后我又在
 * 资料里补了一段实习/一个项目，想加到这份简历里"。让人复制粘贴一遍是最常见的做法，
 * 但也最容易漏字段（时间、技术栈），所以这里给一条一键路径。
 *
 * 三条约束：
 * - **只做加法**：不替换、不覆盖用户已经改过的内容；
 * - **已经在简历里的项禁用**（label 后缀「已加入」）：重复点一次就是重复一条，而重复
 *   的教育/项目在打印出来之后才看得出来；
 * - **不传候选就什么都不渲染**：编辑已保存简历时，这条入口没有意义。
 */

import { ImportOutlined } from "@ant-design/icons";
import { Button, Select, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import type { ProfileFillItem } from "../../features/profile/profileFillOptions";

interface Props {
  /** 模块名（"教育经历" / "项目经历"…），用于按钮文案与无障碍标签。 */
  label: string;
  /** 该模块的全部候选（已按资料顺序、已去重）。 */
  items: ProfileFillItem[];
  /** 表单里已有条目的去重键：命中的候选项禁用并标「已加入」。 */
  existingKeys: Set<string>;
  /** 填入选中的那一条。 */
  onFill: (item: ProfileFillItem) => void;
}

export default function ProfileFillBar({ label, items, existingKeys, onFill }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 候选为空时连控件都不出现：一个永远没有选项的下拉比没有更让人困惑。
  if (items.length === 0) return null;

  const options = items.map((item) => {
    const added = existingKeys.has(item.key);
    return {
      value: item.key,
      // `optionFilterProp="label"` 搜的是这个字段：主标题 + 次要说明都参与搜索，
      // 用户记得"公司名"或"2024"都能找到。
      label: item.hint
        ? `${item.label}（${item.hint}）${added ? " 已加入" : ""}`
        : `${item.label}${added ? " 已加入" : ""}`,
      disabled: added,
      title: item.hint,
    };
  });
  const selected = items.find((item) => item.key === selectedKey) ?? null;
  const allAdded = items.every((item) => existingKeys.has(item.key));

  const fill = () => {
    if (!selected || existingKeys.has(selected.key)) return;
    onFill(selected);
    // 填完清掉选择：同一条已经进了简历，再点一次只会被禁用，留着选中态反而像"没成功"。
    setSelectedKey(null);
  };

  return (
    <Space size={6} wrap className="resume-profile-fill">
      <Typography.Text type="secondary">从我的资料填入</Typography.Text>
      <Select
        size="small"
        style={{ minWidth: 220 }}
        placeholder={`选择${label}`}
        aria-label={`从我的资料选择${label}`}
        showSearch
        optionFilterProp="label"
        value={selectedKey}
        options={options}
        onChange={(value: string | null) => setSelectedKey(value ?? null)}
        notFoundContent="没有可填入的条目"
      />
      <Tooltip title={allAdded ? `资料里的${label}都已经在这份简历里了` : ""}>
        <Button
          size="small"
          icon={<ImportOutlined />}
          disabled={!selected || allAdded}
          aria-label={`填入选中的${label}`}
          onClick={fill}
        >
          填入
        </Button>
      </Tooltip>
    </Space>
  );
}
