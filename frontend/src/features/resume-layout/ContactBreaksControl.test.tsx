// SPDX-License-Identifier: Apache-2.0
/**
 * 联系方式换行（#3）：format_config.contact_breaks 的读写契约 + 控件写值。
 *
 * 后端契约（backend/app/services/resume/resume_contact.py）：
 *   contact_breaks = ["personal_website"]  —— 在个人主页前强制换行；
 *   未知键丢弃、空列表 = 没设置（删键，与旧简历逐字节等价）。
 *
 * 这里钉的是"控件写进 format_config 的形状"与"其余覆盖不丢"：真正的四链路渲染
 * （HTML / PDF / Word / 草稿预览）由后端 pytest 覆盖（tests/test_resume_contact_breaks.py）。
 * 预览跟随是既有链路：格式配置一变 → 宿主 layout 变 → 实时预览按新 format_config 重排，
 * 所以只要形状对，四条链路读到的就是同一份参数。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import ResumeTemplateControls from "../../components/resume/ResumeTemplateControls";
import ContactBreaksControl from "./ContactBreaksControl";
import {
  CONTACT_BREAKS_KEY,
  CONTACT_FIELD_KEYS,
  contactBreakCount,
  readContactBreaks,
  withContactBreaks,
} from "./contactBreaks";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function renderControl(
  formatConfig: ResumeLayout["format_config"] = {},
  props: Partial<Parameters<typeof ContactBreaksControl>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <AntdApp>
      <ContactBreaksControl formatConfig={formatConfig} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return onChange;
}

describe("contact_breaks 读写契约（与后端白名单同口径）", () => {
  it("字段表与后端 resume_contact.CONTACT_FIELDS 顺序一致", () => {
    expect(CONTACT_FIELD_KEYS).toEqual([
      "phone",
      "email",
      "city",
      "birth_year",
      "github",
      "personal_website",
    ]);
  });

  it("读：白名单 + 按字段顺序归一；脏数据安静回退", () => {
    expect(readContactBreaks({ contact_breaks: ["personal_website", "bogus", "phone"] })).toEqual([
      "phone",
      "personal_website",
    ]);
    expect(readContactBreaks({ contact_breaks: "email" })).toEqual([]);
    // 脏数据（format_config 是用户可以随手改的 JSON）：非字符串项一律丢弃。
    const dirty = { contact_breaks: [1, null] } as unknown as ResumeLayout["format_config"];
    expect(readContactBreaks(dirty)).toEqual([]);
    expect(readContactBreaks({})).toEqual([]);
    expect(readContactBreaks(null)).toEqual([]);
    expect(contactBreakCount({ contact_breaks: ["github"] })).toBe(1);
  });

  it("写：其余覆盖原样保留；空选择删键（等于恢复默认自动换行）", () => {
    const base = { accent: "#123456" };
    const withBreaks = withContactBreaks(base, ["personal_website", "phone"]);
    expect(withBreaks).toEqual({
      accent: "#123456",
      contact_breaks: ["phone", "personal_website"],
    });
    expect(withContactBreaks(withBreaks, [])).toEqual({ accent: "#123456" });
    // 不改入参：调用方拿它走既有版式保存链路。
    expect(base).toEqual({ accent: "#123456" });
  });
});

describe("联系方式换行控件（排版参数）", () => {
  it("选中字段 → onChange 收到格式配置（其余键保留）", async () => {
    const onChange = renderControl({ accent: "#123456" });

    // 按无障碍名定位：工具栏里还有别的下拉（版式 / 语言）。
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("workbench.contactBreak.label") }));
    fireEvent.click(await screen.findByText(t("editor.field.website")));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      accent: "#123456",
      contact_breaks: ["personal_website"],
    });
  });

  it("取消勾选 → 删掉 contact_breaks（回到默认自动换行）", async () => {
    const onChange = renderControl({ accent: "#123456", contact_breaks: ["personal_website"] });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("workbench.contactBreak.label") }));
    // 已选项在弹层里是选中态，再点一次即取消。
    const selected = await screen.findByTitle(t("editor.field.website"));
    fireEvent.click(selected);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({ accent: "#123456" });
  });

  it("下拉至少 240px 宽，且窄容器下按 100% 收窄（用户反馈：34px 时看不清选项）", () => {
    renderControl();
    const select = document.querySelector<HTMLElement>(".resume-contact-break-select");
    expect(select).not.toBeNull();
    // Select 撑满外层 260px 的包裹层；包裹层再 maxWidth 100% 适配窄屏。
    expect(select?.style.width).toBe("100%");
    const wrap = select?.parentElement as HTMLElement;
    expect(wrap.style.width).toBe("260px");
    expect(wrap.style.maxWidth).toBe("100%");
  });

  it("挂进 ResumeTemplateControls：写 layout.format_config，其余版式字段原样带过去", async () => {
    const onChange = vi.fn();
    const layout: ResumeLayout = {
      template: "classic",
      format_name: "",
      page_limit: 1,
      font_scale: "standard",
      format_config: { accent: "#123456" },
    } as ResumeLayout;
    render(
      <AntdApp>
        <ResumeTemplateControls layout={layout} onChange={onChange} />
      </AntdApp>,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("workbench.contactBreak.label") }));
    fireEvent.click(await screen.findByText(t("editor.field.github")));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as ResumeLayout;
    expect(next.template).toBe(layout.template);
    expect(next.page_limit).toBe(layout.page_limit);
    expect(next.format_config).toEqual({ accent: "#123456", [CONTACT_BREAKS_KEY]: ["github"] });
  });
});
