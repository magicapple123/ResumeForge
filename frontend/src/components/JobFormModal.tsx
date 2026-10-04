/** 岗位新增/编辑弹窗：手动添加、识别导入、备注图片与来源标注。 */
import { App, Form, Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import { createJob, parseJobsMultiple, updateJob } from "../api/jobs";
import { attachmentInputs, useRecognitionFiles } from "../hooks/useRecognitionFiles";
import { readAsDataUrl } from "../utils/attachments";
import MultiJobDraftList from "./jobs/MultiJobDraftList";
import JobFormFields from "./jobs/form/JobFormFields";
import NoteImagesField from "./jobs/form/NoteImagesField";
import RecognitionSourceSection from "./jobs/form/RecognitionSourceSection";
import { RECOGNIZED_CONTENT_FIELDS } from "./jobs/form/jobFormOptions";
import { MAX_NOTE_IMAGES } from "./jobs/form/NoteImagesField";
import type {
  Job,
  JobPayload,
  JobRecognitionSource,
  ParsedJobDraft,
  RecognitionSource,
} from "../types";

/** 与后端图片体积上限一致（服务端仍是权威校验）。 */
const MAX_NOTE_IMAGE_BYTES = 2 * 1024 * 1024;

type RecognitionInputKind = "text" | "image" | "document";

interface Props {
  open: boolean;
  /** 传入岗位表示编辑，null 表示新增 */
  initial: Job | null;
  /** 从备选岗位导入时预填的招聘原文（只用于新增）。 */
  presetRawText?: string;
  /**
   * 从备选岗位导入时预填的**结构化字段**（只用于新增）。
   *
   * 与 ``presetRawText`` 并存而不是取而代之：手工粘贴的候选只有原文，**采集来的候选恰恰相反**
   * ——它的内容在 ``description`` / ``requirements`` / ``location`` 这些列里，``raw_text`` 是空的。
   * 只填原文那一条路的话，从备选岗位导入一条采集来的岗位会打开一个**全空的表单**，
   * 用户看到的就是"导入进来什么都没有"。
   */
  presetJob?: Partial<JobPayload>;
  /** 从备选岗位导入时的来源标注；不填则按识别输入自动判定。 */
  presetSource?: JobRecognitionSource;
  onClose: () => void;
  /** 保存成功回调；新建时带上新岗位 id（备选岗位导入用它标记） 。 */
  onSaved: (jobId?: number) => void;
}

export default function JobFormModal({
  open,
  initial,
  presetRawText,
  presetJob,
  presetSource,
  onClose,
  onSaved,
}: Props) {
  const [form] = Form.useForm<JobPayload>();
  const { message } = App.useApp();
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [recognizedText, setRecognizedText] = useState("");
  const [recognitionSource, setRecognitionSource] = useState<RecognitionSource | null>(null);
  // 这次识别是用什么输入的：保存时据此把「图片识别 / 文档识别 / 粘贴文本识别」写进溯源字段。
  const [inputKind, setInputKind] = useState<RecognitionInputKind>("text");
  const [noteImages, setNoteImages] = useState<string[]>([]);
  // 一次粘贴里识别出多份招聘信息时，先在这里存下来让用户确认，不直接覆盖表单。
  const [drafts, setDrafts] = useState<ParsedJobDraft[]>([]);
  const [draftsEngine, setDraftsEngine] = useState<RecognitionSource>("local");
  const [savingDrafts, setSavingDrafts] = useState(false);
  const { files, reading, addFiles, removeFile, clear, onPaste } = useRecognitionFiles();
  const parseRequestId = useRef(0);
  const submittingRef = useRef(false);
  const isEdit = !!initial;

  // 打开时回填编辑数据（或重置为默认值）
  useEffect(() => {
    parseRequestId.current += 1;
    setParsing(false);
    setSubmitting(false);
    submittingRef.current = false;
    // 每次打开都从干净状态开始：上次留下的多份草稿不该出现在这一次的弹窗里。
    setDrafts([]);
    setSavingDrafts(false);
    if (!open) return;
    if (initial) {
      form.setFieldsValue(initial);
      setNoteImages(initial.note_images ?? []);
    } else {
      form.resetFields();
      // 先把结构化字段铺上，再放原文（见 ``presetJob`` 的说明）。
      // **只写有值的那些**：把空串显式写进表单会让"这个字段是空的"与"这个字段没被填过"变得
      // 无法区分，而后面按字段判断"要不要再识别一次"的路径依赖这个区别。
      if (presetJob) {
        form.setFieldsValue(
          Object.fromEntries(
            Object.entries(presetJob).filter(([, value]) => value !== "" && value != null),
          ),
        );
      }
      setRawText(presetRawText ?? "");
      setParseWarnings([]);
      setRecognizedText("");
      setRecognitionSource(null);
      setInputKind("text");
      setNoteImages([]);
      clear();
    }
  }, [open, initial, presetRawText, presetJob, form, clear]);

  const addNoteImage = async (file: File) => {
    if (file.size > MAX_NOTE_IMAGE_BYTES) {
      message.error("单张图片不能超过 2 MB");
      return;
    }
    if (noteImages.length >= MAX_NOTE_IMAGES) {
      message.warning(`备注最多放 ${MAX_NOTE_IMAGES} 张图片`);
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      setNoteImages((current) => [...current, dataUrl]);
    } catch {
      message.error("读取图片失败，请重试");
    }
  };

  // 至少两份才算"多份"：只有一份时走原来的回填表单流程，不打断用户。
  const multiMode = drafts.length > 1;

  const parseImport = async () => {
    if (submittingRef.current) return;
    const value = rawText.trim();
    if (!value && files.length === 0) {
      message.warning("请先粘贴招聘信息，或添加截图、上传文档");
      return;
    }

    setParsing(true);
    const requestId = ++parseRequestId.current;
    // 记录这次识别用的是什么输入，保存时写进「来源」字段。
    const hasImages = files.some((file) => file.kind === "image");
    const hasDocuments = files.some((file) => file.kind === "document");
    setInputKind(hasImages ? "image" : hasDocuments ? "document" : "text");
    try {
      const result = await parseJobsMultiple({
        text: value,
        images: attachmentInputs(files, "image"),
        documents: attachmentInputs(files, "document"),
      });
      if (requestId !== parseRequestId.current) return;
      if (result.items.length > 1) {
        // 多份：交给确认面板。这里**不**回填表单——回填只会显示最后一份，用户看不见
        // 其它几份，也看不出拆分对不对。
        setDrafts(result.items);
        setDraftsEngine(result.parse_engine);
        setParseWarnings(result.warnings ?? []);
        message.success(`识别出 ${result.items.length} 份招聘信息，请确认后保存`);
        return;
      }
      const {
        warnings,
        parse_engine: recognitionSource,
        recognized_text: recognized,
        ...draft
      } = result.items[0];
      // 没有任何识别内容时（图片识别失败时的本地草稿就是这样）不要回填：无条件写入
      // 会把用户已经手填的标题、公司一起抹掉。判定只看**内容字段**——job_type 和
      // status 永远有默认值，把它们算进去会让这个判断恒为真。有内容时仍然全量覆盖，
      // 避免残留上一次识别的字段。
      if (RECOGNIZED_CONTENT_FIELDS.some((field) => draft[field].trim())) {
        form.setFieldsValue(draft);
      } else {
        message.warning("没有识别到内容，表单未改动");
      }
      setParseWarnings(warnings);
      setRecognizedText(recognized ?? "");
      // 提示条几秒后就没了，但"是 AI 还是本地规则"要一直留在表单上。
      setRecognitionSource(recognitionSource);
      message.success(
        `${recognitionSource === "ai" ? "已使用 AI" : "已使用本地规则"}识别并填入表单，请核对后再保存`,
      );
    } catch (err) {
      if (requestId !== parseRequestId.current) return;
      setParseWarnings([]);
      setRecognizedText("");
      setRecognitionSource(null);
      message.error(err instanceof Error ? err.message : "识别招聘信息失败");
    } finally {
      if (requestId === parseRequestId.current) setParsing(false);
    }
  };

  /** 多份草稿批量保存：逐条创建，成功的计数、失败的列出原因。 */
  const saveDrafts = async (chosen: ParsedJobDraft[]) => {
    if (submittingRef.current || chosen.length === 0) return;
    submittingRef.current = true;
    setSavingDrafts(true);
    const failures: string[] = [];
    let created = 0;
    for (const draft of chosen) {
      try {
        await createJob({
          title: draft.title.trim() || "待补充岗位",
          company: draft.company,
          location: draft.location,
          salary: draft.salary,
          job_type: draft.job_type,
          description: draft.description,
          requirements: draft.requirements,
          additional_info: draft.additional_info,
          source_url: draft.source_url,
          posted_at: draft.posted_at,
          status: draft.status,
          recognition_source: sourceForInputKind(inputKind),
        });
        created += 1;
      } catch (err) {
        failures.push(
          `${draft.title.trim() || "未命名岗位"}：${err instanceof Error ? err.message : "保存失败"}`,
        );
      }
    }
    submittingRef.current = false;
    setSavingDrafts(false);
    if (created > 0) {
      message.success(`已保存 ${created} 个岗位`);
      onSaved();
    }
    if (failures.length > 0) {
      // 部分失败时留在面板上，用户能看到哪几条没成功、原文也还在。
      message.error(`有 ${failures.length} 条未保存：${failures[0]}`);
      return;
    }
    close(true);
  };

  /** 从多份里挑一份填进表单继续编辑。 */
  const editSingleDraft = (draft: ParsedJobDraft) => {
    const { warnings, parse_engine, recognized_text, ...fields } = draft;
    void warnings;
    void recognized_text;
    form.setFieldsValue(fields);
    setDrafts([]);
    setRecognitionSource(parse_engine);
    setInputKind("text");
  };

  /** 输入方式 → 溯源标注（多份导入时也要按同一套规则标注）。 */
  const sourceForInputKind = (kind: RecognitionInputKind): JobRecognitionSource => {
    if (kind === "image") return "图片识别";
    if (kind === "document") return "文档识别";
    return "粘贴文本识别";
  };

  /** 按"这次识别用了什么输入"决定溯源标注；没做过识别就是手动填写。 */
  const recognitionSourceValue = (): JobRecognitionSource => {
    if (!recognitionSource) return "手动填写";
    return sourceForInputKind(inputKind);
  };

  const close = (force = false) => {
    if (submittingRef.current && !force) return;
    parseRequestId.current += 1;
    setParsing(false);
    onClose();
  };

  const submit = async () => {
    if (submittingRef.current || parsing) return;
    submittingRef.current = true;
    setSubmitting(true);
    let values: JobPayload;
    try {
      values = await form.validateFields();
    } catch {
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    // 录入方式：从备选岗位导入时用指定值，识别过的按输入类型标注，没识别过就是手动填写；
    // 编辑时沿用原值。
    const recognitionSource: JobRecognitionSource = isEdit
      ? (initial?.recognition_source ?? "")
      : (presetSource ?? recognitionSourceValue());
    const payload: JobPayload = {
      ...values,
      note_images: noteImages,
      recognition_source: recognitionSource,
    };

    try {
      if (isEdit && initial) {
        await updateJob(initial.id, payload);
        message.success("岗位已更新");
        onSaved(initial.id);
      } else {
        const created = await createJob(payload);
        message.success("岗位已添加");
        onSaved(created.id);
      }
      close(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={multiMode ? "确认要导入的招聘信息" : isEdit ? "编辑岗位" : "手动添加岗位"}
      open={open}
      onOk={() => void submit()}
      onCancel={() => close()}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: parsing || submitting }}
      cancelButtonProps={{ disabled: submitting }}
      mask={{ closable: !submitting }}
      closable={!submitting}
      width={720}
      styles={{
        body: {
          maxHeight: "calc(100vh - 200px)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 8,
        },
      }}
      // 多份确认面板自带操作按钮，保留默认的「保存/取消」会让用户以为要点弹窗底部。
      footer={multiMode ? null : undefined}
      destroyOnHidden
    >
      {multiMode ? (
        <MultiJobDraftList
          drafts={drafts}
          saving={savingDrafts}
          engineLabel={draftsEngine === "ai" ? "AI 拆分" : "按分隔符拆分"}
          onSave={(chosen) => void saveDrafts(chosen)}
          onEditSingle={editSingleDraft}
          onCancel={() => setDrafts([])}
        />
      ) : (
        <Form
          form={form}
          layout="vertical"
          disabled={submitting}
          initialValues={{ job_type: "校招", status: "开放中" }}
        >
          {!isEdit && (
            <RecognitionSourceSection
              rawText={rawText}
              files={files}
              reading={reading}
              parsing={parsing}
              recognizedText={recognizedText}
              recognitionSource={recognitionSource}
              parseWarnings={parseWarnings}
              onRawTextChange={(event) => {
                // 内容改了，上一次识别的来源与抄录都不再对应当前内容。
                setRawText(event.target.value);
                setParseWarnings([]);
                setRecognizedText("");
                setRecognitionSource(null);
              }}
              onAddFiles={(incoming) => void addFiles(incoming)}
              onRemoveFile={removeFile}
              onPaste={onPaste}
              onParse={() => void parseImport()}
            />
          )}
          <JobFormFields />
          <NoteImagesField
            noteImages={noteImages}
            onAddImage={(file) => void addNoteImage(file)}
            onRemove={(index) =>
              setNoteImages((current) => current.filter((_, i) => i !== index))
            }
          />
        </Form>
      )}
    </Modal>
  );
}
