// SPDX-License-Identifier: Apache-2.0
/**
 * 任务 #9：每个多条目板块的**每条**都有「从资料填入本条」，板块级「追加一条」不再出现。
 *
 * 覆盖范围分两层：
 * 1. 渲染层：11 类多条目板块（6 个系统列表 + 科研三栏 + 证照 + 语言能力）各放一条，
 *    每条都必须出现条目级下拉；整份表单里不允许出现 append 形态的填入条；
 * 2. 行为层：科研/证照/语言的填入同样"只填空字段、不新增条目、不走追加"。
 *
 * 夹具标签用 ASCII，避免给 cjk 棘轮新增 ByText 断言。
 */
import { Form } from "antd";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ProfileFillItem,
  ProfileFillSources,
} from "../../features/profile/profileFillOptions";
import { rt as researchRt } from "../../features/resume-research/i18n";
import { t } from "../../i18n";
import CredentialsEditor from "../resume/CredentialsEditor";
import LanguageEditor from "./LanguageEditor";
import PatentsEditor from "../resume/research/PatentsEditor";
import PublicationsEditor from "../resume/research/PublicationsEditor";
import ResearchProjectsEditor from "../resume/research/ResearchProjectsEditor";
import { ProfileFillProvider } from "./profileFillContext";
import {
  AwardEditor,
  CampusEditor,
  EducationEditor,
  ExperienceEditor,
  ProjectEditor,
  SkillEditor,
} from "./ResumeSectionEditors";

/** 全部候选桶默认空；用例只给自己的那一个桶放候选。 */
function sourcesWith(overrides: Partial<ProfileFillSources> = {}): ProfileFillSources {
  return {
    education: [],
    experience: [],
    campusExperience: [],
    projects: [],
    skills: [],
    awards: [],
    summary: "",
    ...overrides,
  };
}

function item(key: string, label: string, value: unknown): ProfileFillItem {
  return { key, label, value };
}

const ENTRY_SELECT = t("editor.profileFill.aria.entry");
const NO_APPEND = "[data-fill-variant='append']";

function Harness({
  initial,
  sources,
  nodes,
  onReady,
}: {
  initial: Record<string, unknown>;
  sources: ProfileFillSources;
  nodes: ReactNode;
  onReady: (form: ReturnType<typeof Form.useForm>[0]) => void;
}) {
  const [form] = Form.useForm();
  onReady(form);
  return (
    <Form form={form} initialValues={initial}>
      <ProfileFillProvider value={{ sources, onFilled: () => undefined }}>
        {nodes}
      </ProfileFillProvider>
    </Form>
  );
}

function renderEditors(
  initial: Record<string, unknown>,
  sources: ProfileFillSources,
  nodes: ReactNode,
) {
  const holder: { form?: ReturnType<typeof Form.useForm>[0] } = {};
  render(
    <Harness
      initial={initial}
      sources={sources}
      nodes={nodes}
      onReady={(form) => {
        holder.form = form;
      }}
    />,
  );
  if (!holder.form) throw new Error("form not ready");
  return holder.form;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("每个多条目板块的每条都有「从资料填入本条」（任务 #9）", () => {
  it("11 类多条目板块：每条一个条目级入口，没有板块级「追加一条」", () => {
    const sources = sourcesWith({
      education: [item("e1", "E", { school: "S" })],
      experience: [item("x1", "X", { company: "C" })],
      campusExperience: [item("c1", "C", { organization: "O" })],
      projects: [item("p1", "P", { name: "N" })],
      skills: [item("s1", "S", { name: "Skill" })],
      awards: [item("a1", "A", { name: "Award" })],
      publications: [item("pub1", "Pub", { title: "Title" })],
      researchProjects: [item("rp1", "RP", { name: "Project" })],
      patents: [item("pat1", "Pat", { title: "Patent" })],
      credentials: [item("cred1", "Cred", { name: "Credential" })],
      languages: [item("lang1", "Lang", { name: "English" })],
    });
    renderEditors(
      {
        education: [{ school: "", major: "", degree: "" }],
        experience: [{ company: "", role: "", description: [] }],
        campus_experience: [{ organization: "", role: "", description: [] }],
        projects: [{ name: "", role: "", tech_stack: [], description: [], highlights: [] }],
        skills: [{ name: "", level: "", category: "" }],
        awards: [{ name: "", date: "", description: "" }],
        publications: [
          {
            title: "",
            authors: [],
            venue: "",
            year: "",
            status: "published",
            doi: "",
            url: "",
            volume_pages: "",
            note: "",
          },
        ],
        research_projects: [
          {
            name: "",
            role: "",
            organization: "",
            start_date: "",
            end_date: "",
            funding: "",
            description: [],
            outcomes: [],
          },
        ],
        patents: [
          {
            title: "",
            inventors: [],
            patent_number: "",
            country: "",
            status: "filed",
            filed_date: "",
            granted_date: "",
            url: "",
          },
        ],
        credentials: [
          {
            name: "",
            issuer: "",
            issue_date: "",
            expiry_date: "",
            status: "unknown",
            verify_url: "",
            note: "",
          },
        ],
        languages: [{ name: "", level: "", certificate: "", score: "", obtained_at: "" }],
      },
      sources,
      <>
        <EducationEditor />
        <ExperienceEditor />
        <CampusEditor />
        <ProjectEditor />
        <SkillEditor />
        <AwardEditor />
        <PublicationsEditor />
        <ResearchProjectsEditor />
        <PatentsEditor />
        <CredentialsEditor />
        <LanguageEditor />
      </>,
    );

    expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT })).toHaveLength(11);
    expect(document.querySelectorAll(NO_APPEND)).toHaveLength(0);
  });
});

describe("科研/证照/语言的条目级填入行为", () => {
  it("论文：只填空字段，不新增条目", async () => {
    const form = renderEditors(
      {
        publications: [
          {
            title: "",
            authors: [],
            venue: "手工写的期刊",
            year: "",
            status: "published",
            doi: "",
            url: "",
            volume_pages: "",
            note: "",
          },
        ],
      },
      sourcesWith({
        publications: [
          item("pub1", "Paper", { title: "资料标题", venue: "资料期刊", year: "2024" }),
        ],
      }),
      <PublicationsEditor />,
    );

    const select = screen.getByRole("combobox", { name: ENTRY_SELECT });
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    fireEvent.click(await screen.findByText("Paper"));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("editor.profileFill.fillEntryAria", {
          label: researchRt("research.tab.publications"),
        }),
      }),
    );

    await waitFor(() => expect(form.getFieldValue("publications")[0].title).toBe("资料标题"));
    // 用户手写的期刊不被覆盖；条目数不变（不是"追加一条"）。
    expect(form.getFieldValue("publications")[0].venue).toBe("手工写的期刊");
    expect(form.getFieldValue("publications")).toHaveLength(1);
  });

  it("证照：候选写进当前条目的空字段", async () => {
    const form = renderEditors(
      {
        credentials: [
          {
            name: "",
            issuer: "",
            issue_date: "",
            expiry_date: "",
            status: "unknown",
            verify_url: "",
            note: "",
          },
        ],
      },
      sourcesWith({ credentials: [item("cred1", "Cert", { name: "CET-6", issuer: "考试中心" })] }),
      <CredentialsEditor />,
    );

    const select = screen.getByRole("combobox", { name: ENTRY_SELECT });
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    fireEvent.click(await screen.findByText("Cert"));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("editor.profileFill.fillEntryAria", { label: t("editor.tab.credentials") }),
      }),
    );

    await waitFor(() => expect(form.getFieldValue("credentials")[0].name).toBe("CET-6"));
    expect(form.getFieldValue("credentials")[0].issuer).toBe("考试中心");
    expect(form.getFieldValue("credentials")).toHaveLength(1);
  });

  it("语言能力：候选写进当前条目的空字段", async () => {
    const form = renderEditors(
      { languages: [{ name: "", level: "", certificate: "", score: "", obtained_at: "" }] },
      sourcesWith({ languages: [item("lang1", "English", { name: "英语", level: "CET-6" })] }),
      <LanguageEditor />,
    );

    const select = screen.getByRole("combobox", { name: ENTRY_SELECT });
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    fireEvent.click(await screen.findByText("English"));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("editor.profileFill.fillEntryAria", { label: t("editor.section.languages") }),
      }),
    );

    await waitFor(() => expect(form.getFieldValue("languages")[0].name).toBe("英语"));
    expect(form.getFieldValue("languages")[0].level).toBe("CET-6");
    expect(form.getFieldValue("languages")).toHaveLength(1);
  });
});
