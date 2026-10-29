// SPDX-License-Identifier: Apache-2.0
/**
 * 「自定义」分组卡片底部：空态提示 + 编辑态的「添加自定义字段」。
 *
 * 为什么长在卡片里而不是所有分组之后的页面底部：这张卡片**默认就是空的**，加字段的入口
 * 当然要长在它身上（用户原话："默认有一个空的自定义板块"，自然也要能在这里加）。
 *
 * 输入框与按钮仍是 `WebFormProfileCustomFieldAdder`（同一份实现，不复制），这里只负责
 * 组织"空的时候说什么"。
 */
import { Typography } from "antd";
import type { CSSProperties } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import WebFormProfileCustomFieldAdder from "./WebFormProfileCustomFieldAdder";

interface Props {
  /** 本组一个字段都没有：显示空态提示。 */
  empty: boolean;
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}

/** 稳定引用：这个对象以前每 render 新建，白给 React 制造 diff 工作量。 */
const HINT_STYLE: CSSProperties = { display: "block", marginBottom: 8 };

export default function WebFormProfileCustomGroupFooter({
  empty,
  editing,
  value,
  onChange,
  onAdd,
}: Props) {
  useLocale();
  return (
    <>
      {empty ? (
        <Typography.Text type="secondary" style={HINT_STYLE}>
          {/* 文案按态分句：查看态没有输入框，不能说"可在下方添加"。 */}
          {t(
            editing
              ? "profileLibrary.webform.customEmptyEditing"
              : "profileLibrary.webform.customEmpty",
          )}
        </Typography.Text>
      ) : null}
      {editing ? (
        <WebFormProfileCustomFieldAdder value={value} onChange={onChange} onAdd={onAdd} />
      ) : null}
    </>
  );
}
