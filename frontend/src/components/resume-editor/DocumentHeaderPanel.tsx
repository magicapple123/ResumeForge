// SPDX-License-Identifier: Apache-2.0
/**
 * 基本信息（页眉）编辑器：姓名 / 姓名旁小字 / 求职意向 / 联系方式 / 照片 / 隐藏 六个位置组。
 *
 * ## #10：为什么改成 chip
 *
 * 这里此前是一排"标签 + 输入框 + 位置下拉 + 删除"的表单行，与正文板块的 chip 交互完全
 * 不一样：不能拖拽换位、右键没有菜单、也没有"双击展开字段编辑器"。同一个用户在同一屏
 * 里对两处字段要学两套操作，是这次返工的直接原因。现在页眉按位置分组渲染 chip：
 *
 * - 单击选中（结构树 / 纸面联动），双击或 F2 展开 `HeaderItemEditor`；
 * - 右键出菜单（隐藏 / 删除，走编辑器唯一那份 chip 菜单）；
 * - 拖拽或方向键换位（←/→ 换位置组，↑/↓ 换组内顺序）；
 * - 照片字段渲染成缩略图（#25），展开态里更换 / 裁剪 / 移除。
 *
 * 添加入口同时支持目录字段与**自定义字段**：目录只覆盖资料里已有的 key，用户想加一条
 * "政治面貌""期望城市"这类页眉字段时，自定义入口是唯一出路（后端 header item 结构本身
 * 支持任意 key，纸面按 placement 排版，不需要目录里认识它）。
 */
import { PlusOutlined } from "@ant-design/icons";
import Button from "antd/es/button";
import Input from "antd/es/input";
import Select from "antd/es/select";
import { useMemo, useState } from "react";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  HeaderItem,
  HeaderPlacement,
  ResumeDocument,
} from "../../types/resumeDocument";
import {
  HEADER_PLACEMENT_LABEL_KEYS,
  HEADER_PLACEMENT_ORDER,
  headerGroupOf,
  isCustomHeaderItem,
  moveHeaderItem,
} from "../../features/resume-document/headerOrder";
import { defaultHeaderItem, headerPath as buildHeaderPath } from "../../features/resume-document";
import { newObjectId } from "../../features/resume-document/identity";
import { parseDocumentPath } from "../../features/resume-document/paths";
import HeaderChip from "./HeaderChip";
import HeaderItemEditor, { customHeaderKey } from "./HeaderItemEditor";
import "./document-header.css";

/** 后端目录可能带新 key；旧/缺省时用本地 key 兜底。 */
const HEADER_FIELD_KEYS: Record<string, MessageKey> = {
  name: "document.headerField.name",
  gender: "document.headerField.gender",
  birth_year: "document.headerField.birth_year",
  phone: "document.headerField.phone",
  email: "document.headerField.email",
  city: "document.headerField.city",
  job_intent: "document.headerField.job_intent",
  github: "document.headerField.github",
  personal_website: "document.headerField.personal_website",
  photo: "document.headerField.photo",
};

interface Props {
  document: ResumeDocument;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  selectedPath?: string | null;
  onSelectPath: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function DocumentHeaderPanel({
  document,
  catalog = null,
  readOnly = false,
  selectedPath,
  onSelectPath,
  onChange,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const [customName, setCustomName] = useState("");

  const labelOf = (item: HeaderItem): string => {
    if (item.label) return item.label;
    const fromCatalog = catalog?.header_fields.find((field) => field.key === item.key)?.label;
    if (fromCatalog) return fromCatalog;
    const fallback = HEADER_FIELD_KEYS[item.key];
    return fallback ? t(fallback) : t("document.headerField.unknown");
  };

  const usedKeys = useMemo(
    () => new Set(document.header.items.map((item) => item.key)),
    [document.header.items],
  );
  const addable = (catalog?.header_fields ?? []).filter((field) => !usedKeys.has(field.key));

  const addItem = (item: HeaderItem) => {
    onChange({
      ...document,
      header: { ...document.header, items: [...document.header.items, item] },
    });
    onSelectPath(buildHeaderPath(item.id));
    onNotice(t("document.toast.fieldAdded"), "info");
  };

  const dropOn = (draggedPath: string, placement: HeaderPlacement, index: number) => {
    const parsed = parseDocumentPath(draggedPath);
    if (!parsed || parsed.kind !== "header") return;
    const next = moveHeaderItem(document, parsed.itemId, { placement, index });
    if (next === document) return;
    onChange(next);
    onSelectPath(draggedPath);
    onNotice(t("document.drag.moved"), "info");
  };

  /** 自定义字段：key 由本地生成（目录里永远没有它），标签只存在 item 上。 */
  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    addItem(
      defaultHeaderItem({
        key: customHeaderKey(newObjectId()),
        label: name,
        placement: "contact",
      }),
    );
    setCustomName("");
  };

  return (
    <div className="document-header-panel" data-document-section="header">
      <span className="document-section-hint">{t("document.basic.hint")}</span>
      {document.header.items.length === 0 ? (
        <span className="document-group-empty">{t("document.basic.empty")}</span>
      ) : null}
      {HEADER_PLACEMENT_ORDER.map((placement) => {
        const items = headerGroupOf(document.header.items, placement);
        if (items.length === 0) return null;
        return (
          <div
            key={placement}
            className="document-group document-header-group"
            data-header-placement={placement}
          >
            <span className="document-zone-label">{t(HEADER_PLACEMENT_LABEL_KEYS[placement])}</span>
            <div className="document-inline-row">
              {items.map((item, index) => {
                const path = buildHeaderPath(item.id);
                return (
                  <div key={item.id} className="document-chip-slot">
                    <HeaderChip
                      document={document}
                      path={path}
                      item={item}
                      label={labelOf(item)}
                      selected={selectedPath === path}
                      readOnly={readOnly}
                      onSelect={onSelectPath}
                      onChange={onChange}
                      onNotice={onNotice}
                      onDropItem={(draggedPath) => dropOn(draggedPath, placement, index)}
                    >
                      <HeaderItemEditor
                        document={document}
                        path={path}
                        item={item}
                        label={labelOf(item)}
                        readOnly={readOnly}
                        onChange={onChange}
                        onNotice={onNotice}
                      />
                    </HeaderChip>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!readOnly ? (
        <div className="document-add-row">
          <Select
            size="small"
            style={{ minWidth: 180 }}
            aria-label={t("document.basic.add")}
            placeholder={t("document.basic.add")}
            value={null}
            options={addable.map((field) => ({ value: field.key, label: field.label }))}
            notFoundContent={t("document.addField.empty")}
            onChange={(key: string) => {
              const field = addable.find((candidate) => candidate.key === key);
              if (!field) return;
              addItem(
                defaultHeaderItem({
                  key: field.key,
                  placement: field.placement,
                  format: field.format,
                }),
              );
            }}
          />
          {/* 自定义页眉字段：目录里没有的字段（政治面貌、期望城市…）也允许加到 chip 流里。 */}
          <Input
            size="small"
            style={{ width: 150 }}
            value={customName}
            aria-label={t("document.basic.customField")}
            placeholder={t("document.basic.customField")}
            onChange={(event) => setCustomName(event.target.value)}
            onPressEnter={addCustom}
          />
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            disabled={!customName.trim()}
            aria-label={t("document.basic.customAdd")}
            onClick={addCustom}
          >
            {t("document.basic.customAdd")}
          </Button>
        </div>
      ) : null}
      {document.header.items.some((item) => isCustomHeaderItem(item)) ? (
        <span className="document-section-hint">{t("document.basic.customHint")}</span>
      ) : null}
    </div>
  );
}
