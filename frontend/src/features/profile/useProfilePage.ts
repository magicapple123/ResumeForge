// SPDX-License-Identifier: Apache-2.0
/** 我的资料页状态、加载保存和拖拽/粘贴操作。 */

import { App, Form, Upload } from "antd";
import type { UploadProps } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { getProfile, parseProfileText, saveProfile } from "../../api/profile";
import { isCancellation } from "../../api/client";
import { normalizeSectionOrder } from "../../components/profile/ProfileSectionConfig";
import type { RecognitionReviewRow } from "../../components/profile/RecognitionReviewList";
import type ProfileTextModal from "../../components/profile/ProfileTextModal";
import { attachmentInputs, useRecognitionFiles } from "../../hooks/useRecognitionFiles";
import type { Profile, ProfileTextParseResult, RecognitionSource } from "../../types";
import {
  mergeParsedProfileValues,
  profileToReviewRows,
  reviewRowsToProfile,
} from "../../utils/profileText";
import { useProfileSectionReorder } from "./useProfileSectionReorder";

export type ProfileFormValues = Omit<Profile, "id" | "updated_at">;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("读取照片失败"));
    reader.readAsDataURL(file);
  });
}

function toFormValues(profile: Profile): ProfileFormValues {
  return {
    photo: profile.photo,
    name: profile.name,
    gender: profile.gender,
    birth_year: profile.birth_year,
    phone: profile.phone,
    email: profile.email,
    city: profile.city,
    target_city: profile.target_city,
    job_intent: profile.job_intent,
    personal_website: profile.personal_website,
    github: profile.github,
    summary: profile.summary,
    // 网申专用字段必须一起带上：保存是**整体替换**，漏一个就等于把它清空。
    wechat: profile.wechat,
    birth_date: profile.birth_date,
    id_type: profile.id_type,
    id_number: profile.id_number,
    country_region: profile.country_region,
    native_place: profile.native_place,
    political_status: profile.political_status,
    phone_country_code: profile.phone_country_code,
    family_info: profile.family_info,
    expected_salary: profile.expected_salary,
    qq: profile.qq,
    advisor: profile.advisor,
    research_direction: profile.research_direction,
    preferred_industry: profile.preferred_industry,
    section_order: normalizeSectionOrder(profile.section_order),
    educations: profile.educations,
    experiences: profile.experiences,
    campus_experiences: profile.campus_experiences,
    projects: profile.projects,
    skills: profile.skills,
    awards: profile.awards,
  };
}

/** 提交资料表单的结构化结果：调用方（保存全部资料）按它分流。 */
export type ProfileSubmitOutcome = "saved" | "invalid" | "failed" | "skipped";

interface UseProfilePageOptions {
  /**
   * 「粘贴文本识别」成功后把工作区切回「简历资料」分页。必须传**稳定引用**：
   * ProfilePage 用 useMemo 钉住两棵 tab 子树，回调换新会把 memo 打穿。
   */
  activateResumeWorkspace?: () => void;
  /**
   * 识别填入完成后通知页面置脏（未保存警示/悬浮球保存条都挂在 dirty 上）。
   * `form.setFieldsValue` 不触发 onValuesChange，页面侧感知不到这次改动。
   */
  onProfileParsed?: () => void;
}

export function useProfilePage(options: UseProfilePageOptions = {}) {
  const [form] = Form.useForm<ProfileFormValues>();
  const { message } = App.useApp();
  // 回调经 ref 持有：调用时刻读最新实现，hook 内部不依赖引用稳定性。
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoReading, setPhotoReading] = useState(false);
  const [profileTextOpen, setProfileTextOpen] = useState(false);
  const [profileText, setProfileText] = useState("");
  const [profileTextWarnings, setProfileTextWarnings] = useState<string[]>([]);
  const [profileTextParsing, setProfileTextParsing] = useState(false);
  // 上传进度（0-100；null 表示不在上传中）：附件 base64 进 JSON 体，大文件上传
  // 可达数秒以上，弹窗里画出进度条比一个转圈按钮更让人安心。
  const [profileTextUploadPercent, setProfileTextUploadPercent] = useState<number | null>(null);
  const [profileTextRecognized, setProfileTextRecognized] = useState("");
  const [profileTextSource, setProfileTextSource] = useState<RecognitionSource | null>(null);
  /**
   * 校对清单（项 13）：非 null 即"识别完了，等用户核对"。
   *
   * 识别结果**先落在这里**而不是直接写表单——识别是猜、改资料是写。用户点「确认填入」才
   * 走 `applyParsedProfile()`；点「取消」就整份丢掉，表单一个字都不动。
   */
  const [profileTextRows, setProfileTextRows] = useState<RecognitionReviewRow[] | null>(null);
  const {
    files,
    reading: filesReading,
    addFiles,
    removeFile,
    clear: clearFiles,
    onPaste: onPasteFiles,
  } = useRecognitionFiles();
  const photoReadId = useRef(0);
  const profileTextRequestId = useRef(0);
  /** 识别请求的中止器：「取消识别」要能真的把请求掐掉，而不是只改界面。 */
  const profileTextAbortRef = useRef<AbortController | null>(null);
  /** 最近一次识别结果：确认填入时要拿它当基线（区分"改过的"与"原样"）。 */
  const parsedRef = useRef<ProfileTextParseResult | null>(null);
  const savedValues = useRef<ProfileFormValues | null>(null);
  const photo = Form.useWatch("photo", form) ?? "";
  const sectionReorder = useProfileSectionReorder({ editing, saving, photoReading });
  const {
    sectionOrderStore,
    getSectionOrder,
    setSectionOrder,
    setSectionReorderMode,
    resetSectionReorder,
    handleSectionPointerDown,
    moveSectionByOffset,
  } = sectionReorder;

  useEffect(() => {
    let active = true;
    void getProfile()
      .then((profile) => {
        if (!active) return;
        setLoadError("");
        const values = toFormValues(profile);
        form.setFieldsValue(values);
        setSectionOrder(normalizeSectionOrder(values.section_order));
        savedValues.current = values;
        setSectionReorderMode(false);
      })
      .catch((err) => {
        if (active) {
          const failure = err instanceof Error ? err.message : "加载资料失败";
          setLoadError(failure);
          message.error(failure);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form, message, setSectionOrder, setSectionReorderMode, loadAttempt]);

  const retryProfileLoad = () => {
    setLoading(true);
    setLoadError("");
    setLoadAttempt((attempt) => attempt + 1);
  };

  useEffect(
    () => () => {
      photoReadId.current += 1;
    },
    [],
  );

  const closeProfileTextModal = () => {
    profileTextRequestId.current += 1;
    profileTextAbortRef.current?.abort();
    profileTextAbortRef.current = null;
    parsedRef.current = null;
    setProfileTextParsing(false);
    setProfileTextUploadPercent(null);
    setProfileTextRows(null);
    clearFiles();
    setProfileTextOpen(false);
  };

  /**
   * 提交资料表单，返回结构化结果供调用方分流：
   * - `saved`：校验通过且已存进后端（内部已退出编辑态并提示成功）；
   * - `invalid`：必填/格式校验不过（错误已就地标红，antd 会滚到第一个错误字段）；
   * - `failed`：校验通过但保存请求失败（已提示错误，仍在编辑态）；
   * - `skipped`：当前根本不可提交（非编辑态/加载中/保存中等），什么都没发生。
   */
  const submit = async (): Promise<ProfileSubmitOutcome> => {
    if (!editing || loading || loadError || saving || photoReading) return "skipped";
    let values: ProfileFormValues;
    try {
      const formValues = await form.validateFields();
      values = { ...formValues, section_order: getSectionOrder() } as ProfileFormValues;
    } catch {
      return "invalid";
    }
    setSaving(true);
    try {
      const profile = await saveProfile(values);
      const nextValues = toFormValues(profile);
      form.setFieldsValue(nextValues);
      savedValues.current = nextValues;
      resetSectionReorder(normalizeSectionOrder(nextValues.section_order));
      setEditing(false);
      message.success("资料已保存，现在可以去岗位广场生成简历了");
      return "saved";
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
      return "failed";
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    if (saving || photoReading) return;
    if (savedValues.current) {
      form.resetFields();
      form.setFieldsValue(savedValues.current);
      resetSectionReorder(normalizeSectionOrder(savedValues.current.section_order));
    } else {
      resetSectionReorder();
    }
    closeProfileTextModal();
    setEditing(false);
  };

  const beforePhotoUpload: UploadProps["beforeUpload"] = (file) => {
    if (!editing) return Upload.LIST_IGNORE;
    if (!PHOTO_TYPES.has(file.type)) {
      message.error("请选择 JPG、PNG 或 WebP 格式的照片");
      return Upload.LIST_IGNORE;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      message.error("照片不能超过 2 MB");
      return Upload.LIST_IGNORE;
    }
    const readId = ++photoReadId.current;
    setPhotoReading(true);
    void readAsDataUrl(file)
      .then((dataUrl) => {
        if (photoReadId.current === readId) form.setFieldValue("photo", dataUrl);
      })
      .catch((err) => {
        if (photoReadId.current === readId) {
          message.error(err instanceof Error ? err.message : "读取照片失败");
        }
      })
      .finally(() => {
        if (photoReadId.current === readId) setPhotoReading(false);
      });
    return false;
  };

  /** 「取消识别」：掐掉请求。界面复位由 `parseProfile` 的 finally 统一负责。 */
  const cancelParse = () => {
    profileTextAbortRef.current?.abort();
    profileTextAbortRef.current = null;
  };

  const parseProfile = async () => {
    const text = profileText.trim();
    if (!text && files.length === 0) {
      message.warning("请先粘贴个人资料，或添加截图、上传文档");
      return;
    }
    // 每次识别一个独立的中止器：取消只影响这一次请求。
    const controller = new AbortController();
    profileTextAbortRef.current = controller;
    setProfileTextParsing(true);
    const requestId = ++profileTextRequestId.current;
    setProfileTextUploadPercent(0);
    try {
      const parsed = await parseProfileText(
        {
          text,
          images: attachmentInputs(files, "image"),
          documents: attachmentInputs(files, "document"),
        },
        (percent) => {
          if (requestId === profileTextRequestId.current) setProfileTextUploadPercent(percent);
        },
        controller.signal,
      );
      if (requestId !== profileTextRequestId.current) return;
      const { warnings, parse_engine: recognitionSource } = parsed;
      // 阶段二：识别结果**先落成清单**，等用户核对后再写表单（项 13 / D23）。
      parsedRef.current = parsed;
      setProfileTextWarnings(warnings);
      setProfileTextRecognized(parsed.recognized_text ?? "");
      // 提示条会消失，但"是 AI 还是本地规则"要一直留在弹窗里。
      setProfileTextSource(recognitionSource);
      setProfileTextRows(profileToReviewRows(parsed));
    } catch (err) {
      if (requestId !== profileTextRequestId.current) return;
      // 用户自己点了「取消识别」：静默回到输入态，不弹错误（这不是失败）。
      if (!isCancellation(err)) {
        setProfileTextWarnings([]);
        setProfileTextRecognized("");
        setProfileTextSource(null);
        setProfileTextRows(null);
        parsedRef.current = null;
        message.error(err instanceof Error ? err.message : "识别个人资料失败");
      }
    } finally {
      if (requestId === profileTextRequestId.current) {
        setProfileTextParsing(false);
        setProfileTextUploadPercent(null);
      }
      if (profileTextAbortRef.current === controller) profileTextAbortRef.current = null;
    }
  };

  /**
   * 「确认填入」：把校对后的清单写进表单。
   *
   * `reviewRowsToProfile(rows, parsed)` 以识别结果为基线，只返回**用户改过**的值，
   * 所以"原样没动"的字段一个都不会被这里覆盖；空字段仍由 `mergeParsedProfileValues`
   * 挡住（它只覆盖非空值）。
   */
  const applyParsedProfile = () => {
    const parsed = parsedRef.current;
    const rows = profileTextRows;
    if (!parsed || rows === null) return;
    const edited = reviewRowsToProfile(rows, parsed);
    const currentValues = form.getFieldsValue(true) as Partial<ProfileFormValues>;
    const merged = mergeParsedProfileValues(
      currentValues as ProfileFormValues,
      {
        ...parsed,
        ...edited,
      } as ProfileTextParseResult,
    );
    form.setFieldsValue({ ...merged, section_order: getSectionOrder() });
    message.success(
      `${parsed.parse_engine === "ai" ? "已使用 AI" : "已使用本地规则"}识别并填入资料，请核对后保存`,
    );
    // 识别入口在编辑态页头上，正常情况下已在编辑；防御兜底：不在编辑态就把编辑
    // 打开，否则回填的值会锁在一屏禁用的输入框里。
    if (!editing) setEditing(true);
    // setFieldsValue 不触发 onValuesChange，页面侧的未保存警示感知不到这次回填；
    // 显式通知置脏，"识别填入后未保存"的保护才不落空。
    optionsRef.current.onProfileParsed?.();
    optionsRef.current.activateResumeWorkspace?.();
    closeProfileTextModal();
  };

  /**
   * 「取消」：放弃这次识别结果。**表单一个字都不动**，弹窗关掉，下次从头开始。
   */
  const discardParsedProfile = () => {
    parsedRef.current = null;
    setProfileTextRows(null);
    setProfileTextWarnings([]);
    setProfileTextRecognized("");
    setProfileTextSource(null);
    closeProfileTextModal();
  };

  const openProfileTextModal = () => {
    parsedRef.current = null;
    setProfileText("");
    setProfileTextWarnings([]);
    setProfileTextRecognized("");
    setProfileTextSource(null);
    setProfileTextRows(null);
    clearFiles();
    setProfileTextOpen(true);
  };

  const handleProfileTextChange = (value: string) => {
    // 内容改了，上一次识别的来源与抄录都不再对应当前内容。
    setProfileText(value);
    parsedRef.current = null;
    setProfileTextRows(null);
    setProfileTextWarnings([]);
    setProfileTextRecognized("");
    setProfileTextSource(null);
  };

  /**
   * 粘贴识别弹窗的整套 props。
   *
   * 在这里拼装而不是让页面拼：这些值全部来自本 hook 的 state，页面再抄一遍只是
   * 让"谁拥有这份状态"变模糊（而且复制粘贴的字段清单最容易漏一项）。
   * `satisfies` 是刻意的——弹窗新增必填 prop 时这里会立刻编译失败。
   */
  const profileTextModal = {
    open: profileTextOpen,
    text: profileText,
    warnings: profileTextWarnings,
    parsing: profileTextParsing,
    uploadPercent: profileTextUploadPercent,
    recognizedText: profileTextRecognized,
    recognitionSource: profileTextSource,
    files,
    filesReading,
    rows: profileTextRows,
    onRowsChange: setProfileTextRows,
    onApply: applyParsedProfile,
    onDiscard: discardParsedProfile,
    onCancelParse: cancelParse,
    onTextChange: handleProfileTextChange,
    onAddFiles: (incoming: File[]) => void addFiles(incoming),
    onRemoveFile: removeFile,
    onPasteFiles,
    onClose: closeProfileTextModal,
    onParse: () => void parseProfile(),
  } satisfies ComponentProps<typeof ProfileTextModal>;

  return {
    form,
    loading,
    loadError,
    retryProfileLoad,
    saving,
    editing,
    setEditing,
    photoReading,
    sectionOrderStore,
    profileTextOpen,
    profileText,
    profileTextWarnings,
    profileTextParsing,
    profileTextUploadPercent,
    profileTextRecognized,
    profileTextSource,
    profileTextRows,
    files,
    filesReading,
    addFiles,
    removeFile,
    onPasteFiles,
    photo,
    submit,
    cancelEditing,
    beforePhotoUpload,
    handleSectionPointerDown,
    moveSectionByOffset,
    getSectionOrder,
    openProfileTextModal,
    handleProfileTextChange,
    closeProfileTextModal,
    parseProfile,
    /** 页面只需把它整个透传给 `ProfilePageModals`，不再自己拼字段。 */
    profileTextModal,
  };
}
