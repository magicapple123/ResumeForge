// SPDX-License-Identifier: Apache-2.0
/** 术语表（W16）：行渲染、锁定开关、软删回调、只读态、新增表单校验。 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import { MOCK_GLOSSARY } from "../../../features/resume-bilingual/mock";
import { t } from "../../../i18n";
import I18nProvider from "../../../i18n/I18nProvider";
import { selectLocale } from "../../../i18n/localeStore";
import GlossaryTable from "./GlossaryTable";

afterEach(() => cleanup());

describe("GlossaryTable", () => {
  it("渲染术语行与锁定开关", () => {
    render(
      <AntdApp>
        <GlossaryTable terms={MOCK_GLOSSARY} />
      </AntdApp>,
    );
    expect(screen.getByText("k8s")).toBeTruthy();
    expect(screen.getByText("Kubernetes")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(MOCK_GLOSSARY.length);
  });

  it("切换锁定开关回传更新后的整条术语", () => {
    const onSaveTerm = vi.fn();
    render(
      <AntdApp>
        <GlossaryTable terms={MOCK_GLOSSARY} onSaveTerm={onSaveTerm} />
      </AntdApp>,
    );
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onSaveTerm).toHaveBeenCalledTimes(1);
    expect(onSaveTerm.mock.calls[0][0]).toMatchObject({ id: MOCK_GLOSSARY[0].id, locked: false });
  });

  it("删除只是回调（宿主做软删 + 撤销）", () => {
    const onDeleteTerm = vi.fn();
    render(
      <AntdApp>
        <GlossaryTable terms={MOCK_GLOSSARY} onDeleteTerm={onDeleteTerm} />
      </AntdApp>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: bt("bilingual.glossary.delete") })[0]);
    expect(onDeleteTerm).toHaveBeenCalledWith(MOCK_GLOSSARY[0]);
  });

  it("只读态不渲染新增表单、开关禁用", () => {
    render(
      <AntdApp>
        <GlossaryTable terms={MOCK_GLOSSARY} />
      </AntdApp>,
    );
    expect(screen.queryByRole("button", { name: bt("bilingual.glossary.add") })).toBeNull();
    expect(screen.getAllByRole("switch")[0]).toBeDisabled();
  });

  it("updates category options after the interface locale changes", () => {
    render(
      <AntdApp>
        <I18nProvider>
          <GlossaryTable terms={[]} onSaveTerm={vi.fn()} />
        </I18nProvider>
      </AntdApp>,
    );
    act(() => selectLocale("en-US"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("bilingual.glossary.category") }));
    expect(
      screen.getByRole("option", { name: t("bilingual.glossary.category.term") }),
    ).toBeTruthy();
  });

  it("新增术语：必填校验通过后回传整理过的值", async () => {
    const onSaveTerm = vi.fn();
    render(
      <AntdApp>
        <GlossaryTable terms={MOCK_GLOSSARY} onSaveTerm={onSaveTerm} />
      </AntdApp>,
    );
    fireEvent.change(screen.getByLabelText(bt("bilingual.glossary.source")), {
      target: { value: "  p95  " },
    });
    fireEvent.change(screen.getByLabelText(bt("bilingual.glossary.target")), {
      target: { value: "  p95 latency  " },
    });
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.glossary.add") }));
    await waitFor(() => expect(onSaveTerm).toHaveBeenCalledTimes(1));
    expect(onSaveTerm.mock.calls[0][0]).toMatchObject({
      id: 0,
      source_term: "p95",
      target_term: "p95 latency",
      category: "term",
      locked: true,
    });
  });
});
