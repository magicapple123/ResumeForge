// SPDX-License-Identifier: Apache-2.0
/**
 * 全应用拖入导入（R17）：把文件拖到窗口任意位置即可开始导入。
 *
 * 为什么是"全局"而不是每页一个投放区：用户的动作是"把这个文件扔进应用"，他并不先
 * 想"这是设置页的事还是岗位页的事"。按扩展名分发到已有能力，不为拖拽另造一套导入逻辑：
 *
 * - `.zip` → 数据集备份导入（新增一份数据集，当前数据不受影响）；
 * - `.csv` → 岗位表导入（CSV 的解析与预览在前端岗位页，这里只把人带过去）；
 * - `.json` → 新建一份手写简历（内容必须是简历结构）；
 * - 其它类型 → 明确说不支持，并列出可用的三种。
 *
 * 只在拖拽**文件**时显示遮罩：拖选中的文字、拖页面内的元素都不会触发。
 */
import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createManualResume } from "../api/resumes";
import { importDataset } from "../api/settings";
import { describeImportIssues } from "../features/settings/datasetImportFeedback";

const ACCEPTED = [".zip", ".csv", ".json"] as const;

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function stemOf(name: string): string {
  const index = name.lastIndexOf(".");
  return (index < 0 ? name : name.slice(0, index)).trim() || "导入的简历";
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export default function GlobalFileDrop() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave 会在子元素之间成对触发：用计数避免遮罩闪烁。
  const depth = useRef(0);

  const importZip = useCallback(
    (file: File) => {
      modal.confirm({
        title: "导入备份包为新数据集？",
        content: `${file.name} 会新增一份数据集，当前正在使用的数据不受影响；导入后可以随时切换过去。`,
        okText: "导入",
        cancelText: "取消",
        onOk: async () => {
          const created = await importDataset(file, stemOf(file.name), false);
          message.success(`已导入数据集「${created.name}」`);
          // 整包可能只恢复了一部分：没进来的那几份要点名，不能只报成功。
          const trouble = describeImportIssues(created.failed, created.skipped);
          if (trouble) message.warning(trouble);
          // 数据集列表在页头菜单里是挂载时取的：换一份数据集必须重载才能看到。
          window.setTimeout(() => window.location.reload(), 600);
        },
      });
    },
    [modal, message],
  );

  const importJson = useCallback(
    (file: File) => {
      modal.confirm({
        title: "从 JSON 新建一份简历？",
        content: `${file.name} 会作为一份新的手写简历保存，正文按文件里的内容填写。`,
        okText: "新建简历",
        cancelText: "取消",
        onOk: async () => {
          const text = await file.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            message.error("这个 JSON 解析失败，请确认文件没有损坏");
            return;
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            message.error("JSON 里必须是一个简历对象（包含姓名、经历等字段）");
            return;
          }
          const created = await createManualResume({
            title: stemOf(file.name),
            content: parsed as never,
          });
          message.success(`已新建简历「${created.title}」`);
          navigate("/resumes");
        },
      });
    },
    [message, modal, navigate],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (files.length > 1) {
        message.info("一次拖入一个文件；岗位 CSV 支持多选，请到岗位页使用「导入 CSV」");
        return;
      }
      const file = files[0];
      const extension = extensionOf(file.name);
      if (extension === ".zip") {
        importZip(file);
        return;
      }
      if (extension === ".json") {
        importJson(file);
        return;
      }
      if (extension === ".csv") {
        modal.info({
          title: "CSV 请从岗位页导入",
          content:
            "岗位页的「导入 CSV」支持一次选多个文件、也支持直接粘贴表格内容，并能逐行预览会导入什么。",
          okText: "去岗位页",
          onOk: () => navigate("/jobs"),
        });
        return;
      }
      message.warning(
        `不支持的文件类型「${extension || file.name}」：可以拖入 ${ACCEPTED.join(" / ")}` +
          "（.zip 数据集备份、.csv 岗位表格、.json 简历内容）",
      );
    },
    [importJson, importZip, message, modal, navigate],
  );

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // 不 preventDefault 的话浏览器会直接打开文件，页面根本收不到 drop。
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      handleFiles(Array.from(event.dataTransfer?.files ?? []));
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  if (!dragging) return null;

  return (
    <div className="global-file-drop" role="presentation" aria-hidden="true">
      <div className="global-file-drop-inner">
        <div className="global-file-drop-title">松开即可导入</div>
        <div className="global-file-drop-hint">
          支持 .zip 数据集备份、.csv 岗位表格、.json 简历内容
        </div>
      </div>
    </div>
  );
}
