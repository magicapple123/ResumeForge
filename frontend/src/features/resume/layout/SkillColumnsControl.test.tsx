// SPDX-License-Identifier: Apache-2.0
/**
 * 技能每行个数（R-08）：读写契约 + 控件写值。
 *
 * 后端侧断言在 `backend/tests/test_resume_skill_columns.py`（CSS 只出 max-width、
 * PDF 按数量装行）；这里只钉"控件写进 format_config 的形状"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import SkillColumnsControl, {
  SKILL_COLUMNS_KEY,
  readSkillColumns,
  withSkillColumns,
} from "./SkillColumnsControl";

afterEach(cleanup);

describe("skill_columns 读写契约", () => {
  it("读：只认 1–4，其余（含未设置）都是 0 = 跟随模板", () => {
    expect(readSkillColumns({ [SKILL_COLUMNS_KEY]: 3 })).toBe(3);
    expect(readSkillColumns({ [SKILL_COLUMNS_KEY]: 4.5 })).toBe(0);
    expect(readSkillColumns({ [SKILL_COLUMNS_KEY]: "2" })).toBe(0);
    expect(readSkillColumns({})).toBe(0);
    expect(readSkillColumns(null)).toBe(0);
  });

  it("写：其余覆盖保留；0 删键（回到模板默认）", () => {
    expect(withSkillColumns({ accent: "#123456" }, 3)).toEqual({
      accent: "#123456",
      [SKILL_COLUMNS_KEY]: 3,
    });
    expect(withSkillColumns({ accent: "#123456", [SKILL_COLUMNS_KEY]: 3 }, 0)).toEqual({
      accent: "#123456",
    });
  });
});

describe("技能每行个数控件", () => {
  it("选 2 → onChange 收到 skill_columns: 2，其余键保留", async () => {
    const onChange = vi.fn();
    render(
      <AntdApp>
        <SkillColumnsControl formatConfig={{ accent: "#123456" }} onChange={onChange} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "2" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({ accent: "#123456", [SKILL_COLUMNS_KEY]: 2 });
  });

  it("默认档显示「默认」（0 = 不写键）", () => {
    render(
      <AntdApp>
        <SkillColumnsControl formatConfig={{}} onChange={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByRole("radio", { name: t("skillColumns.auto") })).toBeChecked();
  });
});
