// SPDX-License-Identifier: Apache-2.0
/**
 * 一条表达资产（W17 / D16）的卡片：正文 + 四维元信息（类型/语言/来源/使用）+ 岗位标签 + 动作。
 *
 * ## 边界
 *
 * 组件**不**执行副作用：插入/删除/复制都只是回调，由宿主决定插到哪、怎么确认、要不要 Toast。
 * 这样同一个卡片能同时服务制作台（插入当前简历）、资产库页（只管理）与生成流程（只读）。
 *
 * ## 为什么正文要剥掉 `**`
 *
 * 资产库列表是**预览**，不是渲染：用户要判断"这句表达值不值得用"，标记符号只会干扰阅读。
 * 剥标记复用预览链路已有的 `stripMarkers`（与后端 `resume_rich_text` 同口径），不写第二份解析。
 *
 * 2026-10-25（任务 C2）：排版从内联样式搬进 `assets.css`（正文 13px/1.6、标签行与动作行
 * 间距 8px、动作右对齐）。回调、aria-label 与文案 key 一律不动。
 *
 * 2026-11-01（#19）：
 * - 元信息补维度前缀：类型 / 语言 / 来源 / 已用于 N 份简历（"未标注/用过"这类裸词读不出维度）；
 * - 复制 / 编辑 / 删除收进「⋯」菜单（antd Dropdown 自带 Enter 打开、方向键选择、Esc 关闭），
 *   每条动作的 aria-label 保留；插入仍是独立主按钮（它才是这一屏的主动作）。
 */
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { Button, Dropdown, Tag, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { stripMarkers } from "../../resume-preview/richText";
import { at } from "../../../features/resume-assets/i18n";
import { phraseSourceKind, type ResumePhrase } from "../../../features/resume-assets/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  phrase: ResumePhrase;
  /** 1-based，仅用于 aria-label（"把资产第 N 条插入到简历"）。 */
  index: number;
  /** 当前有没有可插入的简历（没有时按钮禁用并说明原因）。 */
  insertEnabled: boolean;
  /** 禁用插入的原因（tooltip 文案由宿主给：没选中位置 / 有未保存修改是两回事）。 */
  insertDisabledReason?: string;
  onInsert?: (phrase: ResumePhrase) => void;
  onRequestDelete?: (phrase: ResumePhrase) => void;
  onCopy?: (phrase: ResumePhrase) => void;
  /** 打开编辑弹窗（正文/类型/语言/岗位标签）；不传 = 菜单里不出现编辑项。 */
  onEdit?: (phrase: ResumePhrase) => void;
}

function kindLabel(phrase: ResumePhrase): string {
  return at(("assets.kind." + phrase.kind) as Parameters<typeof at>[0]);
}

function languageLabel(phrase: ResumePhrase): string {
  if (!phrase.language) return at("assets.language.unknown");
  if (phrase.language === "zh-CN") return at("assets.language.zh-CN");
  if (phrase.language === "en-US") return at("assets.language.en-US");
  return phrase.language;
}

function sourceLabel(phrase: ResumePhrase): string {
  const kind = phraseSourceKind(phrase);
  if (kind === "claim") return at("assets.source.claim");
  if (kind === "resume") return at("assets.source.resume");
  return at("assets.source.manual");
}

export default function PhraseCard({
  phrase,
  index,
  insertEnabled,
  insertDisabledReason,
  onInsert,
  onRequestDelete,
  onCopy,
  onEdit,
}: Props) {
  useLocale();
  const plainText = stripMarkers(phrase.text);
  // #19：四个维度必须能被读出来（"未标注"要说清标的是语言，"用过"要给单位）。
  const meta = [
    at("assets.meta.kind", { value: kindLabel(phrase) }),
    at("assets.meta.language", { value: languageLabel(phrase) }),
    at("assets.meta.source", { value: sourceLabel(phrase) }),
    at("assets.meta.usage", { count: phrase.usage_count }),
  ].join(" · ");

  const menuItems: MenuProps["items"] = [];
  if (onEdit)
    menuItems.push({ key: "edit", icon: <EditOutlined />, label: at("assets.action.edit") });
  if (onCopy)
    menuItems.push({ key: "copy", icon: <CopyOutlined />, label: at("assets.action.copy") });
  if (onRequestDelete) {
    menuItems.push({
      key: "delete",
      icon: <DeleteOutlined />,
      label: at("assets.action.delete"),
      danger: true,
    });
  }
  const handleMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "edit") onEdit?.(phrase);
    else if (key === "copy") onCopy?.(phrase);
    else if (key === "delete") onRequestDelete?.(phrase);
  };
  // 「⋯」菜单的键盘层级（#19）：Enter 打开后焦点仍在触发按钮上，必须把 ↓/↑ 交给菜单，
  // 否则"方向键选择"只有鼠标能用；Esc 只关菜单并拦住冒泡（别让工作台的 Esc 关掉整窗）。
  const [menuOpen, setMenuOpen] = useState(false);
  const handleMoreKeyDown = (event: React.KeyboardEvent) => {
    if (!menuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const menu = globalThis.document.querySelector<HTMLElement>(
      ".resume-phrase-card-menu .ant-dropdown-menu",
    );
    if (!menu) return;
    event.preventDefault();
    menu.focus();
  };

  return (
    <div data-phrase-id={phrase.id} className="resume-phrase-card">
      <p className="resume-phrase-card-text">{plainText}</p>
      <div className="resume-phrase-card-meta">{meta}</div>
      {phrase.job_tags.length > 0 ? (
        <div className="resume-phrase-card-tags">
          {phrase.job_tags.map((tag) => (
            <Tag key={tag} color="geekblue">
              {tag}
            </Tag>
          ))}
        </div>
      ) : null}
      <div className="resume-phrase-card-actions">
        <Tooltip
          title={
            insertEnabled
              ? undefined
              : insertDisabledReason || at("assets.action.insertUnavailable")
          }
        >
          {/* antd 的 disabled Button 不派发鼠标事件；套一层 span 才能让 tooltip 有 hover 目标。 */}
          <span className="resume-phrase-card-insert">
            <Button
              size="small"
              type="primary"
              ghost
              icon={<DownloadOutlined />}
              disabled={!insertEnabled || !onInsert || undefined}
              aria-label={at("assets.action.insertAria", { index })}
              onClick={() => onInsert?.(phrase)}
            >
              {at("assets.action.insert")}
            </Button>
          </span>
        </Tooltip>
        {menuItems.length > 0 ? (
          <Dropdown
            menu={{ items: menuItems, onClick: handleMenuClick }}
            trigger={["click"]}
            placement="bottomRight"
            classNames={{ root: "resume-phrase-card-menu" }}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          >
            <Button
              size="small"
              type="text"
              icon={<MoreOutlined />}
              aria-label={at("assets.action.moreAria", { index })}
              aria-haspopup="menu"
              onKeyDown={handleMoreKeyDown}
            />
          </Dropdown>
        ) : null}
      </div>
    </div>
  );
}
