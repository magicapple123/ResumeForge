// SPDX-License-Identifier: Apache-2.0
/**
 * 「从资料箱选入」补充事实（A3 交付项：资料箱显式选入必须显式核对）。
 *
 * 行为刻意分两步，避免把资料箱内容静默变成简历事实：
 * 1. 用户主动打开本视图、选一条资料 + 目标事实类型；
 * 2. 点「选入并填写」只生成**编辑器草稿**（映射标题/描述/链接），返回后仍需用户
 *    在编辑器里核对并点保存——不直接调创建接口。
 *
 * 分类到类型的映射只是默认值（证书→资格证照、作品→作品项目、实习/校园→实践等），
 * 用户可在本视图改；无法可靠映射的字段留空由用户补，绝不从资料里猜数字/资格。
 */
import { Button, Input, Select, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listMaterials } from "../../api/material";
import { t } from "../../i18n";
import { splitLines } from "./factModel";
import { FACT_KINDS, FACT_KIND_LABEL_KEYS } from "./constants";
import type { FactKind, FactPayload } from "./types";
import type { MaterialSummary } from "../../types";

interface Props {
  onPick: (kind: FactKind, draft: FactPayload) => void;
  onCancel: () => void;
}

// 资料箱分类是后端 MATERIAL_CATEGORIES 的中文字面值（数据键，不是界面文案）。
const CATEGORY_TO_KIND: Record<string, FactKind> = {
  证书: "credential", // i18n-ok: 后端资料箱分类原文
  作品: "work_project", // i18n-ok: 后端资料箱分类原文
  链接: "work_project", // i18n-ok: 后端资料箱分类原文
  实习材料: "practice", // i18n-ok: 后端资料箱分类原文
  校园材料: "practice", // i18n-ok: 后端资料箱分类原文
  笔记: "practice", // i18n-ok: 后端资料箱分类原文
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** 把一条资料映射成某类事实的**草稿**；不确定的字段一律留空。 */
export function materialToDraft(material: MaterialSummary, kind: FactKind): FactPayload {
  const lines = splitLines(material.content);
  const url = isHttpUrl(material.url) ? material.url : "";
  const note = material.content || "";
  const custom_fields: FactPayload["custom_fields"] = [];
  switch (kind) {
    case "publication":
      return {
        title: material.title,
        authors: [{ name: "", is_self: true, corresponding: false }],
        venue: "",
        year: "",
        status: "other",
        doi: "",
        url,
        volume_pages: "",
        note,
        custom_fields,
      };
    case "research_project":
      return {
        name: material.title,
        role: "",
        organization: "",
        start_date: "",
        end_date: "",
        funding: "",
        description: lines,
        outcomes: [],
        custom_fields,
      };
    case "patent":
      return {
        title: material.title,
        inventors: [{ name: "", is_self: true, corresponding: false }],
        patent_number: "",
        country: "",
        status: "other",
        filed_date: "",
        granted_date: "",
        url,
        custom_fields,
      };
    case "credential":
      return {
        name: material.title,
        issuer: "",
        issue_date: "",
        expiry_date: "",
        status: "unknown",
        credential_number: "",
        verify_url: url,
        note,
        custom_fields,
      };
    case "work_project":
      return {
        name: material.title,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: lines,
        highlights: [],
        public_url: url,
        artifact_type: "",
        custom_fields,
      };
    case "practice":
      return {
        organization: material.title,
        role: "",
        experience_kind: "other",
        start_date: "",
        end_date: "",
        description: lines,
        custom_fields,
      };
    case "award":
      return {
        name: material.title,
        issuer: "",
        date: "",
        level: "",
        description: note,
        custom_fields,
      };
    case "training":
      return {
        name: material.title,
        organization: "",
        start_date: "",
        end_date: "",
        hours: "",
        description: lines,
        outcomes: [],
        custom_fields,
      };
    case "language":
      return {
        name: material.title,
        level: "",
        certificate: "",
        score: "",
        date: "",
        custom_fields,
      };
  }
}

/** 分类→默认类型（未知分类落到实践/服务，最中性、不含资格暗示）。 */
export function defaultKindForCategory(category: string): FactKind {
  return CATEGORY_TO_KIND[category] ?? "practice";
}

export default function MaterialPickView({ onPick, onCancel }: Props) {
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kind, setKind] = useState<FactKind>("practice");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMaterials(await listMaterials());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return materials;
    return materials.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) || item.content.toLowerCase().includes(needle),
    );
  }, [keyword, materials]);

  const selected = materials.find((item) => item.id === selectedId) ?? null;

  const choose = (materialId: number) => {
    setSelectedId(materialId);
    const material = materials.find((item) => item.id === materialId);
    if (material) setKind(defaultKindForCategory(material.category));
  };

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <Typography.Text strong>{t("profileFacts.material.title")}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("profileFacts.material.hint")}
      </Typography.Text>
      <Space wrap size={8}>
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("profileFacts.material.searchPlaceholder")}
          aria-label={t("profileFacts.material.searchPlaceholder")}
          style={{ width: 200 }}
        />
        <Select
          value={selectedId ?? undefined}
          onChange={(value: number) => choose(value)}
          placeholder={t("profileFacts.material.materialPlaceholder")}
          aria-label={t("profileFacts.material.materialLabel")}
          loading={loading}
          showSearch
          optionFilterProp="label"
          style={{ width: 300 }}
          options={filtered.map((item) => ({
            value: item.id,
            label: item.category ? item.title + " · " + item.category : item.title,
          }))}
        />
        <Select
          value={kind}
          onChange={(value: FactKind) => setKind(value)}
          aria-label={t("profileFacts.material.kindLabel")}
          style={{ width: 160 }}
          options={FACT_KINDS.map((item) => ({
            value: item,
            label: t(FACT_KIND_LABEL_KEYS[item]),
          }))}
        />
        <Button
          type="primary"
          disabled={!selected}
          onClick={() => {
            if (selected) onPick(kind, materialToDraft(selected, kind));
          }}
        >
          {t("profileFacts.material.confirm")}
        </Button>
        <Button onClick={onCancel}>{t("profileFacts.material.cancel")}</Button>
      </Space>
      {error ? (
        <Typography.Text type="danger">{t("profileFacts.material.loadFailed")}</Typography.Text>
      ) : null}
      {!loading && !error && materials.length === 0 ? (
        <Typography.Text type="secondary">{t("profileFacts.material.empty")}</Typography.Text>
      ) : null}
      {selected ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {selected.title} · {selected.content.slice(0, 80)}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
