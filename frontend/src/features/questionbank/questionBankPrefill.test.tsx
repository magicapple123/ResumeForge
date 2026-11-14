// SPDX-License-Identifier: Apache-2.0
/**
 * 题库 → 面试设置的桥接：材料与记录 id 都要带过去；同一份快照只预填一次，
 * 之后普通重渲染不能覆盖用户已经改过的内容。
 *
 * Q3 起**岗位侧恒为记录**：题库不再提供上传 JD 的入口，所以桥接只用 `jobId`；
 * `jobMaterial` 仍留在 context 形状里但恒为 null（岗位侧没有文件这一路）。
 *
 * 守的是「预填只发生一次」：多填一次就会把用户刚编辑的简历材料冲掉，而且没有提示。
 */
import { App as AntdApp, Form } from "antd";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { InterviewMaterialExtract } from "../../types";
import type { SetupForm } from "../../pages/interview/SetupTab";
import { useSetupMaterials } from "../../pages/interview/useSetupMaterials";
import { toMaterialPayload } from "../interview/materialPayload";
import { useQuestionBankInterview } from "./useQuestionBankInterview";
const RESUME = { name: "cv.txt", text: "Engineer", warnings: [] };
afterEach(cleanup);

it("bank bridge carries the resume material and record ids into the setup flow", () => {
  const setTab = vi.fn();
  const { result } = renderHook(
    () => {
      const [form] = Form.useForm<SetupForm>();
      return { form, bridge: useQuestionBankInterview(form, setTab) };
    },
    { wrapper: AntdApp },
  );
  // 岗位侧只有 id：上传 JD 的入口已随 Q3 移除。
  act(() =>
    result.current.bridge.startFromBank(["Focus question"], {
      jobId: 1,
      resumeMaterial: RESUME,
    }),
  );
  expect(result.current.form.getFieldValue("focus")).toBe("Focus question");
  expect(result.current.form.getFieldValue("jobId")).toBe(1);
  expect(setTab).toHaveBeenCalledWith("session");
  expect(result.current.bridge.materials).toEqual({ jobMaterial: null, resumeMaterial: RESUME });
  expect(toMaterialPayload(result.current.bridge.materials.resumeMaterial)).toEqual({
    name: RESUME.name,
    text: RESUME.text,
  });
  act(() => result.current.bridge.startFromBank(["Other"], { jobId: 1, resumeId: "r:3" }));
  expect(result.current.form.getFieldValue("jobId")).toBe(1);
  expect(result.current.form.getFieldValue("resumeId")).toBe("r:3");
  expect(result.current.bridge.materials).toEqual({ jobMaterial: null, resumeMaterial: null });
});

it("setup materials are resume-only and a new snapshot prefills each side once", () => {
  const { result, rerender } = renderHook(
    ({ resume }: { resume?: InterviewMaterialExtract | null }) => useSetupMaterials(resume),
    { initialProps: { resume: RESUME } },
  );
  // 岗位侧已经没有材料状态了：这个 hook 只回答简历那一侧。
  expect(result.current).not.toHaveProperty("jobSource");
  expect(result.current).not.toHaveProperty("jobMaterial");
  expect(result.current.resumeSource).toBe("file");
  expect(result.current.resumeMaterial).toEqual(RESUME);

  act(() => {
    result.current.setResumeSource("record");
    result.current.setResumeMaterial(null);
  });
  // 同一份快照重渲染：保留用户改过的内容（这是本文件真正的护栏）。
  rerender({ resume: RESUME });
  expect(result.current.resumeSource).toBe("record");
  expect(result.current.resumeMaterial).toBeNull();

  // 新快照（引用变了）：重新应用一次。
  rerender({ resume: { ...RESUME } });
  expect(result.current.resumeSource).toBe("file");
  expect(result.current.resumeMaterial).toEqual(RESUME);
});
