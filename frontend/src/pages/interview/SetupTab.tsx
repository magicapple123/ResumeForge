// SPDX-License-Identifier: Apache-2.0
/**
 * 面试官设定卡：类型/难度/轮数/考察重点 + 面试官风格与人设（二者互斥），提交后由页面发起面试。
 * （自 InterviewPage 拆出：SetupForm 接口随迁，form 实例由页面持有，供题库「开始模拟面试」
 * 的 startFromBank 联动写回考察重点。）
 *
 * 两处口径：**轮数只有两档**（问题 05，「自动」档整块隐藏而不是禁用）；**人设与风格互斥**
 * （问题 06，填了人设就禁用风格且值不清空——后端 `interviewer_style` 必填，真正让它失效的是
 * 提示词，见 `backend/app/services/interview/interview.py` 的 `persona_and_style`）。
 *
 * 类型/难度/风格的显示名来自 `i18n/enum/interview.ts`（协议值 → 语言包 key），
 * 提交给后端的仍是 `types/interview.ts` 的协议值，不随语言变。
 */
import { PlayCircleOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Typography,
} from "antd";
import type { FormInstance } from "antd";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getExternalResume } from "../../api/externalResumes";
import type {
  InterviewDifficulty,
  InterviewMaterialExtract,
  InterviewType,
  InterviewerStyle,
} from "../../types";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import {
  describeCurrentMaterial,
  parseExternalResumeId,
  useExternalResumeApplier,
  useInterviewResumeSelect,
} from "../../hooks/useInterviewResumeSelect";
import { t } from "../../i18n";
import {
  INTERVIEW_DIFFICULTY_LABEL_KEYS,
  INTERVIEW_TYPE_LABEL_KEYS,
  INTERVIEWER_STYLE_LABEL_KEYS,
} from "../../i18n/enum/interview";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES } from "./janeFaces";
import { MaterialSourceField } from "./MaterialSourceField";
import { useSetupMaterials } from "./useSetupMaterials";
import {
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_TYPES,
  INTERVIEWER_STYLES,
  MAX_INTERVIEW_ROUNDS,
  MIN_INTERVIEW_ROUNDS,
} from "../../types";

/** 轮数档位（问题 05）：自动收尾，或由用户指定的固定轮数。 */
export type RoundsMode = "auto" | "custom";

export interface SetupForm {
  /** 关联岗位：岗位侧只剩"从记录选"（Q3），所以它始终必填。 */
  jobId?: number;
  /**
   * 关联简历：与 `resumeMaterial` 二选一。**带前缀的字符串**（#25）：`r:<id>` = 本应用的
   * 简历，`e:<id>` = 外部简历——前缀就是 `onChange` 的分派依据；提交时由
   * `toInternalResumeId` 还原成后端要的数字 id（外部简历没有内部 id，正文走材料）。
   */
  resumeId?: string;
  /**
   * 岗位材料：**恒为 null**（Q3 岗位侧不再支持导入文件）。字段保留是因为页面的提交函数
   * 仍拿它判"岗位是否来自文件"，删字段要连着改 `InterviewPage.start`。
   */
  jobMaterial?: InterviewMaterialExtract | null;
  /** 导入的简历材料（#41）：已在上传时提取成文本。 */
  resumeMaterial?: InterviewMaterialExtract | null;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  /** 面试官风格：填了人设时不参与提示词（值仍保留，后端字段必填）。 */
  interviewerStyle: InterviewerStyle;
  /** 轮数档位：`auto` = 自动收尾（AI 按表现判断何时结束）。 */
  roundsMode: RoundsMode;
  /** 固定轮数，只在 `roundsMode === "custom"` 时生效。 */
  rounds: number;
  focus: string;
  persona: string;
}

/** 「指定轮数」档的取值是否合法：越界或空值都按默认值附近夹回来，不把 NaN 递给后端。 */
function clampRounds(value: number | undefined | null): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const rounds = Math.trunc(value);
  if (rounds < MIN_INTERVIEW_ROUNDS || rounds > MAX_INTERVIEW_ROUNDS) return null;
  return rounds;
}

export function SetupTab({
  form,
  initialJobId,
  initialResumeMaterial,
  starting,
  onStart,
}: {
  form: FormInstance<SetupForm>;
  /** 深链带来的预填（RF-11）：岗位详情跳过来时关联岗位已选好。
   *  id 不在候选里时由远程搜索 hook 按 id 回查补进候选（P0-1）。 */
  initialJobId?: number;
  /** 题库桥接带过来的简历文件材料（`resumeMaterial`）：非空时简历侧直接落在"导入文件"。 */
  initialResumeMaterial?: InterviewMaterialExtract | null;
  starting: boolean;
  onStart: (values: SetupForm) => void;
}) {
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后表单文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  // 从简历中心「用于面试」跳过来：把那份外部简历的**已提取正文**预填到"导入文件"这一侧。
  // 刻意不新增第三种来源：record / file 二选一已经能表达"这份材料来自文件快照"。
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const externalResumeId = parseExternalResumeId(searchParams.get("externalResumeId"));
  const prefilledExternalIdRef = useRef<number | null>(null);
  // 关联岗位下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  // 关联简历（0066 / #25）：候选 = 所选岗位关联的简历 **+** 通用简历 **+** 外部简历（分组展示）。
  // 未选岗位时展示全部内部与外部简历，岗位材料和简历材料可以分别选择。
  const watchedJobId = Form.useWatch("jobId", form) as number | undefined;
  const watchedResumeValue = Form.useWatch("resumeId", form) as string | undefined;
  // 人设与风格互斥（问题 06）：**看的是实时值**，所以用 useWatch 而不是读 initialValues——
  // 用户边打人设，风格下拉边变灰，无需先提交或失焦。
  const persona = Form.useWatch("persona", form) as string | undefined;
  const hasPersona = (persona ?? "").trim().length > 0;
  // 轮数两档（问题 05）：只有「指定轮数」才渲染输入框，默认「自动」。
  const roundsMode = (Form.useWatch("roundsMode", form) as RoundsMode | undefined) ?? "auto";
  const showRoundsInput = roundsMode === "custom";
  // 材料来源（#41）：简历侧是"从记录选 / 导入文件"二选一，切换时互相清空，
  // 避免"上边选着记录，下边还留着上次的文件正文"这种谁也说不清的状态。
  // Q3：岗位侧已经没有材料来源了（只从记录选），所以这里只剩简历一侧。
  const {
    resumeSource,
    setResumeSource,
    resumeMaterial,
    setResumeMaterial,
    resumeFileOrigin,
    setResumeFileOrigin,
  } = useSetupMaterials(initialResumeMaterial);

  // 外部简历落地（深链与下拉**共用**这一个函数）：引用稳定，深链 effect 才不会每渲染重跑。
  const externalResume = useExternalResumeApplier({
    useFileSource: () => setResumeSource("file"),
    useFileMaterial: (material) => {
      setResumeMaterial(material);
      setResumeFileOrigin("external");
    },
    clearRecordValue: () => form.setFieldValue("resumeId", undefined),
  });
  const resumeSelect = useInterviewResumeSelect({
    jobId: watchedJobId ?? null,
    value: watchedResumeValue,
    onExternal: externalResume.apply,
    onExternalFailed: externalResume.notifyFailed,
    onSelectInternal: (value) => form.setFieldValue("resumeId", value),
  });

  // 岗位一变就重拉简历候选：上一次的候选属于上一个岗位，留着会让用户挑到不该出现的简历。
  // 外部简历组不随岗位变（列表接口没有 job_id 参数），`reload` 里一并刷新；已选项由
  // hook 的 `pinned` 缓存保住显示。
  useEffect(() => {
    resumeSelect.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedJobId]);

  // 外部简历深链预填（第 21 条）：只处理一次。StrictMode 下 effect 会"跑一遍 → 清理 →
  // 再跑一遍"：如果把 ref 记在 effect 开头，第二次跑会以为"处理过了"而直接退出，第一次
  // 的请求又被清理标记成 cancelled —— 结果永远不预填。所以 ref 记在**真正处理成功**的位置，
  // 两次请求最多浪费一次 GET（与弹层数据加载同一种取舍）。
  useEffect(() => {
    if (externalResumeId === null || prefilledExternalIdRef.current === externalResumeId) return;
    let cancelled = false;
    void getExternalResume(externalResumeId)
      .then((record) => {
        if (cancelled) return;
        prefilledExternalIdRef.current = externalResumeId;
        // 与下拉选中走同一个函数：切来源、写材料、清记录侧的 id（漏掉清 id 就是脏状态）。
        externalResume.apply(record);
      })
      .catch(() => {
        if (!cancelled) externalResume.notifyFailed();
      });
    return () => {
      cancelled = true;
    };
  }, [externalResumeId, externalResume]);

  // 深链预填的岗位按 id 回查补进候选（P0-1），否则第 101 条之后的岗位只显示 id；
  // 设定卡常驻可见，挂载时同时预拉第一页候选。
  useEffect(() => {
    void jobSelect.ensure(initialJobId);
    void jobSelect.reload();
    // hook 的回调引用稳定，只跟随预填目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  /**
   * 「当前材料」（#25）：选中外部简历后记录侧下拉是**空的**（材料落在"导入文件"那一侧），
   * 不显式说清现在用的是哪一份，用户会以为系统把文件弄丢了。判据与文案在 hook 里。
   */
  const currentMaterialText = describeCurrentMaterial({
    source: resumeSource,
    recordLabel: resumeSelect.labelFor(watchedResumeValue),
    fileName: resumeMaterial?.name,
    fileOrigin: resumeFileOrigin,
  });

  /**
   * 提交前补齐"文件这一侧到底有没有材料"：表单校验只看**渲染出来**的字段，切到"导入文件"
   * 时那条 `required` 规则随下拉框一起消失，不自己判一次就能开出一场没有材料的面试
   * （后端会 422，但那时候点的是"开始面试"，体验很差）。轮数同理——输入框与 Segmented
   * 同行（`noStyle`），校验文案没有位置显示，空值 / 越界在这里给明确提示。
   */
  const submit = (values: SetupForm) => {
    // 岗位侧只剩"从记录选"（Q3）：文件那一侧已经不存在，`jobMaterial` 恒为 null。
    if (resumeSource === "file" && !resumeMaterial) {
      message.error(t("interviewPage.setup.material.resumeRequired"));
      return;
    }
    const rounds = clampRounds(values.rounds);
    if (values.roundsMode === "custom" && rounds === null) {
      message.error(t("interviewPage.setup.roundsRequired"));
      return;
    }
    onStart({
      ...values,
      roundsMode: values.roundsMode === "custom" ? "custom" : "auto",
      // 自动档下 rounds 只是表单里的占位值（页面按档位改传硬性保险），但不能是 NaN。
      rounds: rounds ?? 6,
      jobMaterial: null,
      resumeMaterial: resumeSource === "file" ? resumeMaterial : null,
    });
  };

  return (
    <Card size="small" className="settings-card">
      <div className="jane-intro">
        <img
          className="jane-avatar jane-avatar--intro"
          src={JANE_FACE_SOURCES.idle}
          alt={t("interviewPage.avatarAlt")}
        />
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t("interviewPage.setup.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("interviewPage.setup.greeting")}</Typography.Text>
        </div>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          // 默认「综合面」而不是「技术面」：技术面只是其中一种类型，
          // 把它当默认会让非技术岗的用户每次都要先改一次。
          // 下面三个初始值是提交给后端的协议值（不随语言变），显示名走 i18n/enum/interview.ts。
          interviewType: "综合面",
          difficulty: "中级",
          interviewerStyle: "严谨专业",
          // 轮数默认「自动」（问题 05）：用户实测里"默认固定 6 轮"并不是他想要的口径。
          roundsMode: "auto",
          rounds: 6,
          focus: "",
          persona: "",
          ...(initialJobId !== undefined ? { jobId: initialJobId } : {}),
        }}
        onFinish={(values) => void submit(values)}
        // 岗位变了就清掉已选简历：岗位与简历必须成对，"上一个岗位的简历"不该被带过来。
        // 用事件而不是 effect 守卫，避免"清空 → 校验失败 → 再清空"的渲染循环。
        onValuesChange={(changed) => {
          if (Object.prototype.hasOwnProperty.call(changed, "jobId")) {
            form.setFieldValue("resumeId", undefined);
          }
        }}
      >
        {/* 外层纵向堆叠（第 8 条）：auto-fit 主栅格会被"整行"元素逼出多于 4 条的轨道，
            4 个字段只占前 4 条，右边那条轨道就是原来那片空白。 */}
        <div className="interview-setup-stack">
          {/* 材料行（问题 7）：两个材料字段单独成组，容器是 auto-fit 栅格 + align-items: start，
              两侧各自按内容高度排，不被对侧的下拉 / 文件区拉高。 */}
          <div className="interview-setup-materials">
            {/* 岗位材料：只从记录选（Q3），岗位由岗位广场按链接导入。 */}
            <Form.Item
              label={t("interviewPage.setup.jobLabel")}
              name="jobId"
              className="interview-material-field"
              rules={[{ required: true, message: t("interviewPage.setup.jobRequired") }]}
              extra={
                <>
                  <MaterialSourceField
                    kind="job"
                    mode="record"
                    material={null}
                    disabled={starting}
                    allowFile={false}
                    onModeChange={() => undefined}
                    onMaterialChange={() => undefined}
                  />
                  {/* 没有合适岗位时的唯一出口：去岗位广场从链接导入，再回来这里选。 */}
                  <Button
                    type="link"
                    size="small"
                    className="interview-job-link-hint"
                    onClick={() => navigate("/jobs")}
                  >
                    {t("interviewPage.setup.jobFromLink")}
                  </Button>
                </>
              }
            >
              <Select
                allowClear
                placeholder={t("interviewPage.setup.jobPlaceholder")}
                {...jobSelect.selectProps}
              />
            </Form.Item>
            {/* 简历材料（#41 / #25）：从记录选 / 导入文件二选一；记录侧下拉分两组
                （本应用的简历 / 外部简历，见 `useInterviewResumeSelect`）。extra 多一行
                「当前材料」——外部简历的正文落在文件侧，这行是选完之后唯一常驻的来源说明。 */}
            <Form.Item
              label={t("interviewPage.setup.resumeLabel")}
              name="resumeId"
              className="interview-material-field"
              rules={
                resumeSource === "record"
                  ? [{ required: true, message: t("interviewPage.setup.resumeRequired") }]
                  : []
              }
              extra={
                <>
                  <MaterialSourceField
                    kind="resume"
                    mode={resumeSource}
                    material={resumeMaterial}
                    disabled={starting}
                    onModeChange={(mode) => {
                      setResumeSource(mode);
                      if (mode === "file") form.setFieldValue("resumeId", undefined);
                    }}
                    onMaterialChange={(material) => {
                      setResumeMaterial(material);
                      // 换过文件就不再是"外部简历的正文"了（否则「当前材料」会认错来源）。
                      setResumeFileOrigin(material ? "file" : null);
                    }}
                  />
                  {/* 「当前材料」（#25）：external 的正文不进下拉的 value（它走 resume_material），
                      所以这份提示是外部简历选完之后**唯一**常驻的来源说明。 */}
                  <Typography.Text type="secondary" className="interview-resume-current">
                    {currentMaterialText}
                  </Typography.Text>
                </>
              }
            >
              <Select
                allowClear
                disabled={resumeSource === "file" || undefined}
                placeholder={t("interviewPage.setup.resumePlaceholder")}
                {...resumeSelect.selectProps}
              />
            </Form.Item>
          </div>
          {/* #41：边界文案对两种来源都成立——不管这一侧是从记录选来的还是导入的文件。
              放在两列之外独占一行：留在某列 extra 里会让两侧底部不齐，也像只针对简历。 */}
          <Typography.Text type="secondary" className="interview-setup-hint">
            {t("interviewPage.setup.scopeHint")}
          </Typography.Text>
          <div className="interview-setup-fields">
            <Form.Item label={t("interviewPage.setup.typeLabel")} name="interviewType">
              <Select
                options={INTERVIEW_TYPES.map((value) => ({
                  value,
                  label: t(INTERVIEW_TYPE_LABEL_KEYS[value]),
                }))}
              />
            </Form.Item>
            <Form.Item label={t("interviewPage.setup.difficultyLabel")} name="difficulty">
              <Select
                options={INTERVIEW_DIFFICULTIES.map((value) => ({
                  value,
                  label: t(INTERVIEW_DIFFICULTY_LABEL_KEYS[value]),
                }))}
              />
            </Form.Item>
            {/* 轮数（问题 05）：两档短文案 + 条件输入框（`noStyle` 与 Segmented 同行，外面那个
              Form.Item 只提供 label，校验由 submit() 兜）。说明文字已移到网格下方（第 8 条），
              否则点「指定轮数」时它会折成 3 行把整行撑高。 */}
            <Form.Item label={t("interviewPage.setup.roundsLabel")}>
              <div className="interview-setup-rounds">
                <Form.Item name="roundsMode" noStyle>
                  <Segmented
                    disabled={starting}
                    options={[
                      { value: "auto", label: t("interviewPage.setup.roundsAuto") },
                      { value: "custom", label: t("interviewPage.setup.roundsModeCustom") },
                    ]}
                  />
                </Form.Item>
                {/* 「自动」档整块不渲染（不是禁用）：留着会让人以为自动也能设轮数。单位用
                  Space.Addon 而不是 InputNumber 的 addonAfter（v6 已废弃）。 */}
                {showRoundsInput ? (
                  <Space.Compact>
                    <Form.Item name="rounds" noStyle>
                      <InputNumber
                        min={MIN_INTERVIEW_ROUNDS}
                        max={MAX_INTERVIEW_ROUNDS}
                        precision={0}
                        disabled={starting}
                      />
                    </Form.Item>
                    <Space.Addon>{t("interviewPage.setup.roundsUnit")}</Space.Addon>
                  </Space.Compact>
                ) : null}
              </div>
            </Form.Item>
            <Form.Item
              label={t("interviewPage.setup.focusLabel")}
              name="focus"
              extra={t("interviewPage.setup.focusExtra")}
            >
              <Input maxLength={255} placeholder={t("interviewPage.setup.focusPlaceholder")} />
            </Form.Item>
          </div>
          {/* 轮数说明（第 8 条）：字段网格下方全宽一行，点「指定轮数」时只增高输入框那一档。 */}
          <Typography.Text type="secondary" className="interview-setup-rounds-hint">
            {t("interviewPage.setup.roundsExtra")}
          </Typography.Text>
          {/* 风格与人设（问题 06 / 第 2 条）：二者互斥，并排后"填了人设、风格置灰"一眼可读。 */}
          <div className="interview-setup-persona">
            <Form.Item
              label={t("interviewPage.setup.styleLabel")}
              name="interviewerStyle"
              // 禁用但**不清空**：后端 `interviewer_style` 是 Literal 必填，清空会 422；
              // 真正让它不生效的是提示词（persona 非空时风格整条链路被跳过）。
              extra={
                hasPersona ? (
                  <Typography.Text type="warning">
                    {t("interviewPage.setup.styleExtraIgnored")}
                  </Typography.Text>
                ) : undefined
              }
            >
              <Select
                disabled={hasPersona || starting}
                options={INTERVIEWER_STYLES.map((value) => ({
                  value,
                  label: t(INTERVIEWER_STYLE_LABEL_KEYS[value]),
                }))}
              />
            </Form.Item>
            <Form.Item
              label={
                <span>
                  {t("interviewPage.setup.personaLabel")}
                  {/* 说明放在标签行里但 aria-hidden：可访问名仍是「自定义人设（选填）」本身，
                      不会变成"标签 + 说明"的长串（精确查询与读屏口径都不变）。 */}
                  <span className="interview-setup-label-hint" aria-hidden="true">
                    {t("interviewPage.setup.personaOverrideHint")}
                  </span>
                </span>
              }
              name="persona"
              extra={t("interviewPage.setup.personaExtra")}
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 5 }}
                maxLength={2000}
                showCount
                disabled={starting}
              />
            </Form.Item>
          </div>
        </div>
        <Space wrap>
          <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={starting}>
            {t("interviewPage.setup.start")}
          </Button>
          <Typography.Text type="secondary">
            {t("interviewPage.setup.confidenceTip")}
          </Typography.Text>
        </Space>
      </Form>
    </Card>
  );
}
