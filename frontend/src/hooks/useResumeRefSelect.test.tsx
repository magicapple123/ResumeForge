// SPDX-License-Identifier: Apache-2.0
/**
 * 「关联简历」统一选择器（R14）：一个下拉、两组选项、复合值。
 *
 * 四条线：
 * 1. 分组：内部（`/api/resumes`）与外部（`/api/external-resumes`）并行查，各成一组；
 * 2. 徽标：外部项按文件类型追加 PDF / DOCX 徽标（判定走 `utils/fileKind`，与列表同口径）；
 * 3. 空组不渲染：只有外部简历时不该冒出一个空的「内部简历」标题；
 * 4. 复合值只活在 UI：提交时拆成 `resume_id` / `external_resume_id` 两个纯 id 字段，
 *    复合串（`external:7`）不进请求体。
 *
 * cjkRatchet 守卫：`*ByText` 家族的实参里不能出现新的中文字面量，所以本文件的界面
 * 文案一律 `t()` 取；假数据用 ASCII 名字（它们本来就只是测试数据）。
 */
import { Select } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { resumeRefIds } from "../types/resumeRef";
import { useResumeRefSelect } from "./useResumeRefSelect";

const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
const externalMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  getExternalResume: vi.fn(),
}));

vi.mock("../api/resumes", () => resumesMocks);
vi.mock("../api/externalResumes", () => externalMocks);

/** 内部简历：`title` 是展示名。 */
const INTERNAL_ITEMS = [{ id: 12, title: "Internal backend resume" }];
/** 外部简历：`name` 是展示名，`mime` 决定徽标。 */
const EXTERNAL_ITEMS = [
  { id: 7, name: "Uploaded one.pdf", mime: "application/pdf" },
  { id: 8, name: "Uploaded two.docx", mime: "" },
];

function listAll() {
  resumesMocks.listResumes
    .mockReset()
    .mockResolvedValue({ items: INTERNAL_ITEMS, total: INTERNAL_ITEMS.length });
  externalMocks.listExternalResumes.mockReset().mockResolvedValue({
    items: EXTERNAL_ITEMS,
    total: EXTERNAL_ITEMS.length,
    page: 1,
    page_size: 50,
  });
}

/**
 * 极简宿主：把 hook 的 `selectProps` 直接喂给 antd `Select`，并把"提交体"打出来。
 *
 * `ensureValue` 传给 hook 的 `ensure()`——用来验证"已选值 404 时降级显示"。
 */
function Harness({
  onSubmit,
  ensureValue,
}: {
  onSubmit: (body: unknown) => void;
  ensureValue?: string;
}) {
  const select = useResumeRefSelect();
  const [value, setValue] = useState<string | undefined>(undefined);
  useEffect(() => {
    select.reload();
    if (ensureValue) void select.ensure(ensureValue, "Snapshot name");
    // 只在挂载时跑一次：本文件测的是"首屏拿到选项"，不测防抖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <Select
        style={{ width: 240 }}
        allowClear
        value={value}
        onChange={(next) => setValue(next)}
        {...select.selectProps}
      />
      <button type="button" onClick={() => onSubmit(resumeRefIds(value))}>
        submit
      </button>
    </div>
  );
}

/** 展开下拉：antd `Select` 靠 `mouseDown` 打开（与仓库其它用例一致）。 */
async function openOptions(
  groupKey:
    | "trackerForm.resume.group.internal"
    | "trackerForm.resume.group.external" = "trackerForm.resume.group.internal",
) {
  fireEvent.mouseDown(screen.getByRole("combobox"));
  await screen.findByText(t(groupKey));
}

beforeEach(() => {
  listAll();
});

describe("分组与徽标", () => {
  it("内部 / 外部各成一组，外部项带 PDF / DOCX 徽标", async () => {
    render(<Harness onSubmit={() => {}} />);
    await openOptions();

    expect(screen.getByText(t("trackerForm.resume.group.internal"))).toBeInTheDocument();
    expect(screen.getByText(t("trackerForm.resume.group.external"))).toBeInTheDocument();
    expect(screen.getByText("Internal backend resume")).toBeInTheDocument();
    expect(screen.getByText("Uploaded one.pdf")).toBeInTheDocument();
    expect(screen.getByText("Uploaded two.docx")).toBeInTheDocument();
    // 徽标是**格式名**（中英文一致），不需要 i18n。
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("DOCX")).toBeInTheDocument();
  });

  it("只有外部简历时不渲染空的「内部简历」分组", async () => {
    resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
    render(<Harness onSubmit={() => {}} />);
    await openOptions("trackerForm.resume.group.external");

    expect(screen.queryByText(t("trackerForm.resume.group.internal"))).toBeNull();
    expect(screen.getByText(t("trackerForm.resume.group.external"))).toBeInTheDocument();
  });
});

describe("复合值 → 请求体", () => {
  it("选中外部简历后提交体是纯 id（resume_id=null，无复合串）", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await openOptions();

    fireEvent.click(await screen.findByText("Uploaded two.docx"));
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(onSubmit).toHaveBeenCalledWith({ resume_id: null, external_resume_id: 8 });
    // 复合串只活在表单里：请求体里不该出现 `external:8` 这种值。
    expect(JSON.stringify(onSubmit.mock.calls[0][0])).not.toContain("external:");
  });

  it("选中内部简历后提交体是 resume_id 非空、外部为 null", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await openOptions();

    fireEvent.click(await screen.findByText("Internal backend resume"));
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(onSubmit).toHaveBeenCalledWith({ resume_id: 12, external_resume_id: null });
  });
});

describe("已选值保显示", () => {
  it("外部简历已删（回查 404）时降级成标题快照 +（已删除），不显示裸复合值", async () => {
    externalMocks.getExternalResume.mockReset().mockRejectedValue(new Error("404"));
    render(<Harness onSubmit={() => {}} ensureValue="external:99" />);

    // 选项只在展开后渲染；先展开再断言降级文案。
    await openOptions("trackerForm.resume.group.external");
    const degraded = `Snapshot name${t("trackerForm.resume.deleted")}`;
    expect(await screen.findByText(degraded)).toBeInTheDocument();
    expect(screen.queryByText("external:99")).toBeNull();
  });

  it("已选值回查成功时并入对应分组（不会停在裸复合值上）", async () => {
    externalMocks.getExternalResume
      .mockReset()
      .mockResolvedValue({ ...EXTERNAL_ITEMS[1], id: 99, name: "Late loaded.docx" });
    render(<Harness onSubmit={() => {}} ensureValue="external:99" />);

    await openOptions("trackerForm.resume.group.external");
    await waitFor(() => expect(screen.getByText("Late loaded.docx")).toBeInTheDocument());
    expect(screen.queryByText("external:99")).toBeNull();
  });
});
