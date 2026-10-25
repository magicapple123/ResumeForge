// SPDX-License-Identifier: Apache-2.0
/**
 * 事实编辑器：新类型字段（award/training/language）、隐藏字段不渲染、
 * 自定义字段按 schema 渲染并保存值快照（含已删定义的旧值保留）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { FACT_SAVE_LABEL_KEYS } from "./constants";
import FactEditor from "./editors/FactEditor";
import { CUSTOM_FIELD_DEF, PUBLICATION_FACT, makeSchemaMap } from "./testFixtures";
import type { FactPayload, ProfileFact } from "./types";

afterEach(() => {
  cleanup();
});

function renderEditor(overrides: Partial<React.ComponentProps<typeof FactEditor>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const props: React.ComponentProps<typeof FactEditor> = {
    mode: "create",
    initialKind: "award",
    schemaByKind: makeSchemaMap(),
    maxCustomFieldValueChars: 2000,
    onSave,
    onCancel: vi.fn(),
    onConflictRefresh: vi.fn(),
    ...overrides,
  };
  render(
    <AntdApp>
      <FactEditor {...props} />
    </AntdApp>,
  );
  return { onSave };
}

function savedPayload(onSave: ReturnType<typeof vi.fn>): FactPayload {
  return onSave.mock.calls[0][1] as FactPayload;
}

describe("新类型编辑器", () => {
  it("荣誉与获奖：字段齐全，保存为 award payload", async () => {
    const { onSave } = renderEditor({ initialKind: "award" });
    fireEvent.change(screen.getByLabelText(t("profileFacts.award.name")), {
      target: { value: "Math contest first prize" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.award.issuer")), {
      target: { value: "Example Board" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.award.level")), {
      target: { value: "National" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.award.description")), {
      target: { value: "Top 1 percent" },
    });
    fireEvent.click(screen.getByRole("button", { name: t(FACT_SAVE_LABEL_KEYS.award) }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      "award",
      expect.objectContaining({
        name: "Math contest first prize",
        issuer: "Example Board",
        level: "National",
        description: "Top 1 percent",
        custom_fields: [],
      }),
    );
  });

  it("培训与课程：多行内容保存为列表", async () => {
    const { onSave } = renderEditor({ initialKind: "training" });
    fireEvent.change(screen.getByLabelText(t("profileFacts.training.name")), {
      target: { value: "Project management basics" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.training.organization")), {
      target: { value: "Example Academy" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.training.hours")), {
      target: { value: "32" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.training.description")), {
      target: { value: "Scope planning\nSchedule planning" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.training.outcomes")), {
      target: { value: "Used on two projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: t(FACT_SAVE_LABEL_KEYS.training) }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(savedPayload(onSave)).toMatchObject({
      name: "Project management basics",
      organization: "Example Academy",
      hours: "32",
      description: ["Scope planning", "Schedule planning"],
      outcomes: ["Used on two projects"],
    });
  });

  it("语言能力：保存 language payload", async () => {
    const { onSave } = renderEditor({ initialKind: "language" });
    fireEvent.change(screen.getByLabelText(t("profileFacts.language.name")), {
      target: { value: "English" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.language.level")), {
      target: { value: "CET-6" },
    });
    fireEvent.change(screen.getByLabelText(t("profileFacts.language.score")), {
      target: { value: "512" },
    });
    fireEvent.click(screen.getByRole("button", { name: t(FACT_SAVE_LABEL_KEYS.language) }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(savedPayload(onSave)).toMatchObject({
      name: "English",
      level: "CET-6",
      certificate: "",
      score: "512",
      date: "",
      custom_fields: [],
    });
  });
});

describe("隐藏字段", () => {
  it("字段设置隐藏的默认字段不渲染，保存时不要求填写", async () => {
    const schemaByKind = makeSchemaMap({
      publication: { hidden_fields: ["title", "venue", "status"] },
    });
    const { onSave } = renderEditor({ initialKind: "publication", schemaByKind });
    expect(screen.queryByLabelText(t("research.publications.title"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("research.publications.venue"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("research.publications.status"))).not.toBeInTheDocument();
    // 未隐藏的字段仍在。
    expect(screen.getByLabelText(t("research.publications.doi"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t(FACT_SAVE_LABEL_KEYS.publication) }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = savedPayload(onSave);
    expect(payload).toMatchObject({ title: "", venue: "", status: "other" });
  });
});

describe("自定义字段", () => {
  it("按 schema 定义渲染输入，保存值快照（key+label+value）", async () => {
    const schemaByKind = makeSchemaMap({
      publication: { custom_fields: [CUSTOM_FIELD_DEF] },
    });
    const { onSave } = renderEditor({ initialKind: "publication", schemaByKind });
    // 自定义字段是独立小节（上边框 + 小节标题），不再是默认字段区里的一串 Form.Item。
    expect(document.querySelector(".profile-facts-custom-fields")).not.toBeNull();
    fireEvent.change(screen.getByLabelText(t("research.publications.title")), {
      target: { value: "A paper with custom field" },
    });
    fireEvent.change(screen.getByLabelText(CUSTOM_FIELD_DEF.label), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: t(FACT_SAVE_LABEL_KEYS.publication) }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(savedPayload(onSave)).toMatchObject({
      custom_fields: [{ key: CUSTOM_FIELD_DEF.key, label: CUSTOM_FIELD_DEF.label, value: "4" }],
    });
  });

  it("编辑时保留已从定义里删除的自定义字段旧值", async () => {
    const fact: ProfileFact = {
      ...PUBLICATION_FACT,
      payload: {
        ...PUBLICATION_FACT.payload,
        custom_fields: [{ key: "cf_deadbeef1234", label: "Old custom", value: "kept" }],
      },
    };
    const { onSave } = renderEditor({ mode: "edit", initialKind: "publication", fact });
    fireEvent.click(screen.getByRole("button", { name: t(FACT_SAVE_LABEL_KEYS.publication) }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(savedPayload(onSave).custom_fields).toEqual([
      { key: "cf_deadbeef1234", label: "Old custom", value: "kept" },
    ]);
  });
});

describe("新建时切换类型", () => {
  it("切换到另一种新类型后按对应 schema 渲染字段", async () => {
    renderEditor({ initialKind: "award" });
    fireEvent.mouseDown(screen.getByLabelText(t("profileFacts.editor.kind")));
    fireEvent.click(await screen.findByText(t("profileFacts.kind.language")));
    expect(await screen.findByLabelText(t("profileFacts.language.level"))).toBeInTheDocument();
  });
});
