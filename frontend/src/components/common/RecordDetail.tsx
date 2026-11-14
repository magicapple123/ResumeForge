// SPDX-License-Identifier: Apache-2.0
/**
 * 通用「卡片 → 详情」能力：列表卡片点一下就能看全字段。
 *
 * 为什么单独抽一份：内推、资料箱、面经、提醒、知识库这些卡片都只放得下摘要，各家自己
 * 写一遍详情会得到五种不一致的排版与五种不一致的关闭方式。这里统一成「右侧抽屉 + 字段
 * 表 + 正文区」，调用方只负责给字段。
 *
 * 卡片整块可点，但**不能**做成 `<button>`：卡片里有「编辑 / 删除」这类按钮，按钮套按钮
 * 是无效 HTML。外层用 group，单独的原生按钮承接键盘操作，内层动作与它互为兄弟。
 * 鼠标点卡片正文时仍可打开详情，点击内部按钮则跳过。判定在 `recordDetailCore.ts`。
 */
import { Divider, Drawer, Space, Typography } from "antd";
import EmptyState from "./EmptyState";
import type { ReactNode } from "react";
import { useCallback } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { isFromInnerControl } from "./recordDetailCore";
import type { DetailField, DetailSection } from "./recordDetailCore";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export type { DetailField, DetailSection } from "./recordDetailCore";

interface DetailTriggerProps {
  /** 打开详情。 */
  onOpen: () => void;
  /** 卡片里放不下、但读屏需要知道的一句话（例如「打开资料「证书」的详情」）。 */
  label: string;
  className?: string;
  children: ReactNode;
}

/** 可点击卡片：整块可点、可用键盘操作，内层按钮不受影响。 */
export function DetailTrigger({ onOpen, label, className, children }: DetailTriggerProps) {
  // Compiler 的 use-memo 规则要求 useCallback 首参是内联函数：直接把两段逻辑内联。
  const stableClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isFromInnerControl(event)) return;
      onOpen();
    },
    [onOpen],
  );

  const stableKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      // 焦点在内层按钮上时，回车/空格归按钮。
      if (isFromInnerControl(event)) return;
      event.preventDefault();
      onOpen();
    },
    [onOpen],
  );

  return (
    <div
      role="group"
      aria-label={label}
      className={`detail-trigger${className ? ` ${className}` : ""}`}
      onClick={stableClick}
    >
      <button
        type="button"
        className="detail-trigger-open"
        aria-label={label}
        onClick={onOpen}
        onKeyDown={stableKeyDown}
      />
      {children}
    </div>
  );
}

/**
 * 值是不是"没有内容"。
 *
 * 只看 `undefined` / `null` / 纯空白字符串：`"-"`、`"（无）"` 这类占位不再被组件
 * 当成空——它们会被当成真实内容占掉一行。想显示「无」的调用方显式传一句文案，
 * 不要指望组件替它猜。
 */
function isBlank(value: ReactNode): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

interface RecordDetailDrawerProps {
  open: boolean;
  title: ReactNode;
  /** 标题下的一行补充信息（公司、时间等）。 */
  subtitle?: ReactNode;
  /** 标题下一行的紧凑元信息（更新时间、附件数、是否有链接），比字段表更省纵向空间。 */
  meta?: ReactNode;
  /** 标题区下方的状态标签。 */
  tags?: ReactNode;
  /** 字段表：一行一项，适合短字段。 */
  fields?: DetailField[];
  /** 长正文区：每条一个分区，适合备注、正文、问题清单。 */
  sections?: DetailSection[];
  /** 底部操作（编辑、删除等）；不传则不显示操作区。 */
  actions?: ReactNode;
  onClose: () => void;
  width?: number;
}

/** 详情抽屉：空字段与空章节整行不渲染，不留空占位。 */
export function RecordDetailDrawer({
  open,
  title,
  subtitle,
  meta,
  tags,
  fields = [],
  sections = [],
  actions,
  onClose,
  width = 520,
}: RecordDetailDrawerProps) {
  useLocale();
  const visibleFields = fields.filter((field) => !isBlank(field.value));
  const visibleSections = sections.filter((section) => !isBlank(section.content));
  const isEmpty = visibleFields.length === 0 && visibleSections.length === 0;

  return (
    <Drawer
      title={title}
      placement="right"
      size={width}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Space orientation="vertical" size="small" style={{ width: "100%" }}>
        {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
        {meta && <div className="record-detail-meta">{meta}</div>}
        {tags}
      </Space>

      {isEmpty ? (
        <EmptyState inline description={t("common.recordDetail.empty")} />
      ) : (
        <>
          {visibleFields.length > 0 && (
            <div className="record-detail-fields">
              {visibleFields.map((field, index) => (
                <div className="record-detail-field" key={index}>
                  <span className="record-detail-label">{field.label}</span>
                  <div className="record-detail-value">{field.value}</div>
                </div>
              ))}
            </div>
          )}
          {visibleSections.map((section, index) => (
            <div className="record-detail-section" key={index}>
              {/* 第一条不画分隔线：它正上方就是字段区/标签，再来一条只是多一条横线。 */}
              {index > 0 && <Divider style={{ margin: "12px 0" }} />}
              {section.title && <div className="record-detail-section-title">{section.title}</div>}
              <div className="record-detail-section-body">{section.content}</div>
            </div>
          ))}
        </>
      )}

      {actions && <div className="record-detail-actions">{actions}</div>}
    </Drawer>
  );
}

export default RecordDetailDrawer;
