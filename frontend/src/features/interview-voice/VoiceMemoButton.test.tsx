// SPDX-License-Identifier: Apache-2.0
/**
 * I-19：`VoiceMemoButton` 的组件层链路（录音 → 转写 → 解析 → 校对弹窗 → 插入）。
 *
 * 为什么这几条必须存在：`voiceMemoDraft` 的纯函数用例只证明"给了草稿能折成条目"，
 * 证明不了组件把**转写结果**交给了**解析接口**、又把弹窗里校对后的值交回**宿主文档**。
 * I-20 的字段丢失正是死在这一段，而当时所有纯函数用例都是绿的。
 *
 * 麦克风、转写、解析全部模块级 mock：jsdom 没有 `AudioContext` / `MediaRecorder`，
 * 也不该为测试去改生产代码的导入方式。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { DocumentFieldCatalog, ResumeDocument } from "../../types/resumeDocument";
import { defaultSectionLayout, emptyEntry } from "../resume/document/defaults";
import { MIN_RECORDING_MS } from "../../hooks/voiceGates";

const mocks = vi.hoisted(() => {
  const state = {
    instances: [] as Array<{ emit: (amplitude: number) => void }>,
  };
  class MicCapture {
    opts: { onFrame: (frame: Float32Array) => void; onError: (error: unknown) => void };
    start = vi.fn(async () => {});
    stop = vi.fn();
    constructor(opts: {
      onFrame: (frame: Float32Array) => void;
      onError: (error: unknown) => void;
    }) {
      this.opts = opts;
      state.instances.push({
        emit(amplitude: number) {
          const frame = new Float32Array(160);
          frame.fill(amplitude);
          opts.onFrame(frame);
        },
      });
    }
  }
  return {
    state,
    MicCapture,
    transcribeSegment: vi.fn(async () => "2023年6月到2024年3月，我在某某公司做后端开发"),
    parseProfileText: vi.fn(),
  };
});

vi.mock("./capture", () => ({
  MicCapture: mocks.MicCapture,
  isMicCaptureSupported: () => true,
  micErrorCode: () => "other",
}));
vi.mock("./transcribe", () => ({ transcribeSegment: mocks.transcribeSegment }));
vi.mock("./asrApi", () => ({
  getTranscribeStatus: vi.fn(async () => ({
    configured: true,
    provider_host: "asr.example.com",
    model: "test",
    protocol: "dashscope",
    max_seconds: 180,
    max_bytes: 10485760,
  })),
}));
vi.mock("../../api/profile", () => ({ parseProfileText: mocks.parseProfileText }));

import { VoiceMemoButton } from "./VoiceMemoButton";

const CATALOG: DocumentFieldCatalog = {
  header_fields: [],
  sections: [
    {
      key: "experience",
      title: "experience",
      title_key: "editor.section.experience",
      kind: "entries",
      profile_section_key: "experiences",
      material_only: false,
      fields: [
        {
          key: "company",
          label: "company",
          format: "text",
          field_type: "single_line",
          default_placement: "title",
          material_only: false,
          private: false,
          source_field_id: "experiences.company",
        },
        {
          key: "role",
          label: "role",
          format: "text",
          field_type: "single_line",
          default_placement: "title",
          material_only: false,
          private: false,
          source_field_id: "experiences.role",
        },
        {
          key: "period",
          label: "period",
          format: "date_range",
          field_type: "date_text",
          default_placement: "meta",
          material_only: false,
          private: false,
          source_field_id: "experiences.period",
        },
      ],
    },
  ],
};

function documentWithExperience(): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "experience",
        title: "experience",
        kind: "entries",
        layout: defaultSectionLayout(),
        entries: [emptyEntry()],
      },
    ],
  };
}

/** 真实解析接口的 `sections` 形状（field_id 用资料目录的口径）。 */
const PARSE_SECTIONS = [
  {
    key: "experiences",
    name: "experiences",
    fields: [
      { field_id: "experiences.company", label: "company", value: "某某公司" },
      { field_id: "experiences.title", label: "role", value: "后端开发" },
      { field_id: "experiences.start_date", label: "start", value: "2023-06" },
      { field_id: "experiences.end_date", label: "end", value: "2024-03" },
    ],
  },
];

/** 走完"点开始 → 出声 → 点结束"，返回控制权给用例做断言。 */
async function recordOnce() {
  fireEvent.click(screen.getByRole("button", { name: t("voiceMemo.buttonAria") }));
  await waitFor(() => expect(mocks.state.instances.length).toBe(1));
  mocks.state.instances[0].emit(0.5);
  await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS + 60));
  fireEvent.click(screen.getByRole("button", { name: t("voiceMemo.status.recording") }));
}

function renderButton(overrides: Partial<ComponentProps<typeof VoiceMemoButton>> = {}) {
  const onChange = vi.fn();
  const onInserted = vi.fn();
  const document = documentWithExperience();
  const view = render(
    <AntdApp>
      <VoiceMemoButton
        document={document}
        onChange={onChange}
        catalog={CATALOG}
        onInserted={onInserted}
        {...overrides}
      />
    </AntdApp>,
  );
  return { ...view, onChange, onInserted, document };
}

beforeEach(() => {
  mocks.state.instances.length = 0;
  mocks.transcribeSegment.mockReset();
  mocks.transcribeSegment.mockResolvedValue("2023年6月到2024年3月，我在某某公司做后端开发");
  mocks.parseProfileText.mockReset();
  mocks.parseProfileText.mockResolvedValue({ sections: PARSE_SECTIONS });
});

afterEach(() => {
  // antd v6 的静态 message 没有 destroy()：直接摘掉提示节点，避免跨用例串台。
  document.querySelectorAll(".ant-message-notice").forEach((node) => node.remove());
});

describe("VoiceMemoButton 的主链路（I-19）", () => {
  it("转写成功 → 解析 → 弹窗 → 插入：宿主文档真的多一条，并回传路径", async () => {
    const { onChange, onInserted, document } = renderButton();
    await recordOnce();

    // 弹窗里出现三个可校对字段（角色 / 时间都在，证明别名与日期合并没有丢）。
    const apply = await screen.findByRole("button", { name: t("voiceMemo.modal.apply") });
    expect(screen.getAllByDisplayValue("某某公司").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("后端开发").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue(/2023-06/).length).toBeGreaterThan(0);

    fireEvent.click(apply);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    const next = onChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[0].entries).toHaveLength(document.sections[0].entries.length + 1);
    const entries = next.sections[0].entries;
    const created = entries[entries.length - 1];
    const fieldValue = (key: string) => {
      const item = created?.items.find(
        (candidate: ResumeDocument["sections"][number]["entries"][number]["items"][number]) =>
          candidate.kind === "field" && candidate.key === key,
      );
      return item && item.kind === "field" ? item.value : null;
    };
    // 三个字段都要真的写进文档：只断言「多了一条」会漏掉 I-20 的字段映射错误。
    expect(fieldValue("company")).toBe("某某公司");
    expect(fieldValue("role")).toBe("后端开发");
    expect(fieldValue("period")).toContain("2023-06");
    expect(fieldValue("period")).toContain("2024-03");
    expect(onInserted).toHaveBeenCalledWith([`experience.${created?.id}`]);
  });

  it("转写失败时显示读得到的文案（不是只打 console）", async () => {
    mocks.transcribeSegment.mockRejectedValueOnce(new Error("boom"));
    renderButton();
    await recordOnce();
    expect(await screen.findByText(t("voiceInput.error.serviceFailed"))).toBeInTheDocument();
  });

  it("只识别到基本信息时提示去资料页，不弹校对窗", async () => {
    mocks.parseProfileText.mockResolvedValueOnce({
      sections: [
        {
          key: "basic_info",
          name: "basic_info",
          fields: [{ field_id: "basic_info.name", label: "name", value: "张三" }],
        },
      ],
    });
    const { onChange } = renderButton();
    await recordOnce();
    expect(await screen.findByText(t("voiceMemo.toast.basicOnly"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("voiceMemo.modal.apply") })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("只读态不渲染入口", () => {
    render(
      <AntdApp>
        <VoiceMemoButton document={documentWithExperience()} onChange={vi.fn()} readOnly />
      </AntdApp>,
    );
    expect(screen.queryByRole("button", { name: t("voiceMemo.buttonAria") })).toBeNull();
  });
});
