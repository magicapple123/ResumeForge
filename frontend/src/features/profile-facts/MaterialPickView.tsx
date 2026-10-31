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
import { materialCategoryLabel } from "../../i18n/enum/knowledge";
import { useLocale } from "../../i18n/i18nContext";
import { FACT_KINDS, FACT_KIND_LABEL_KEYS } from "./constants";
import { defaultKindForCategory, materialToDraft } from "./materialPickModel";
import type { FactKind, FactPayload } from "./types";
import type { MaterialSummary } from "../../types";

interface Props {
  onPick: (kind: FactKind, draft: FactPayload) => void;
  onCancel: () => void;
}

export default function MaterialPickView({ onPick, onCancel }: Props) {
  useLocale();
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
    // 取数入口的同步 setState 放进微任务，避开级联渲染告警（仍在本帧内发起请求）。
    queueMicrotask(() => void load());
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
            // 分类展示名走语言包（用户自建分类原样返回）；筛选与落库的仍是分类原值。
            label: item.category
              ? item.title + " · " + materialCategoryLabel(item.category)
              : item.title,
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
