// SPDX-License-Identifier: Apache-2.0
/**
 * 题库面板的「参考答案 + 我的作答」状态机。
 *
 * 从 `QuestionBankPanel` 抽出来的原因有两个：
 * 1. 那个文件早已贴着 500 行预算，加完这两组状态与四个处理器就超线；
 * 2. 这一块有它自己的不变量，集中在一处比散在页面里好守：
 *    - **展开态 ≠ 缓存**：收起只关显示，缓存留着，再点不会重新生成一遍；
 *    - **写回以本地分组为准**：`record` 是父组件的旧快照，拿它现拼会让第二次写回
 *      覆盖第一次的结果，所以内部维护 `groupsRef`；
 *    - **切题库 = 全部作废**：新生成的题库或换一条历史记录，展开态、作答、批改都要清掉。
 *
 * T04-d 追加第三条不变量：**这两条链路都可以停**。生成参考答案、批改作答各要十几到几十秒，
 * 用户不该被迫等完；「停止」按下去断开连接（服务端据此停下），面板当场回到可再点状态。
 * 停下来的那一次**不算失败**：不弹错误提示，也不清掉已有的缓存结果。
 */
import { useEffect, useRef, useState } from "react";
import {
  generateQuestionAnswer,
  reviewQuestionAnswer,
  updateQuestionBank,
} from "../../api/interview";
import { errorText, useAbortableRequest } from "../../hooks/useAbortableRequest";
import type {
  InterviewAnswerReview,
  QuestionAnswer,
  QuestionBankGroup,
  QuestionBankOut,
} from "../../types";

type Item = QuestionBankGroup["questions"][number];

interface Options {
  /** 当前展示的分组（历史记录的或刚生成的）；引用变化即视为"换了一套题"。 */
  groups: QuestionBankOut["groups"] | null;
  /** 写回目标：打开历史记录时是那条记录，刚生成时是自动保存出来的那条。 */
  targetId: number | null;
  jobId: number | null;
  resumeId: number | null;
  /** 写回失败时的轻提示文案（由调用方给：这个文件不持有面向用户的文案）。 */
  writeBackFailedText: string;
  /** 生成参考答案 / 批改作答失败时的兜底文案。 */
  generateFailedText: string;
  reviewFailedText: string;
  /** 提示出口（调用方一般是 message.warning）。 */
  onWarn: (text: string) => void;
}

export interface QuestionBankAnswers {
  answerMap: Record<string, QuestionAnswer>;
  answerOpen: Record<string, boolean>;
  answerLoading: string | null;
  answerError: string;
  myAnswerMap: Record<string, string>;
  myAnswerOpen: Record<string, boolean>;
  reviewMap: Record<string, InterviewAnswerReview>;
  reviewLoading: string | null;
  reviewError: string;
  toggleAnswer: (key: string, question: string, groupType: string, index: number) => void;
  regenerateAnswer: (key: string, question: string, groupType: string, index: number) => void;
  toggleMyAnswer: (key: string) => void;
  submitMyAnswer: (
    key: string,
    question: string,
    groupType: string,
    index: number,
    draft: string,
  ) => void;
  /**
   * 停止正在跑的那一条（参考答案或批改）。
   *
   * 两条链路互斥（都在入口处挡掉并发），所以一个入口就够：面板不必判断"停的是哪一个"。
   */
  cancelActive: () => void;
}

export function useQuestionBankAnswers({
  groups,
  targetId,
  jobId,
  resumeId,
  writeBackFailedText,
  generateFailedText,
  reviewFailedText,
  onWarn,
}: Options): QuestionBankAnswers {
  const [answerMap, setAnswerMap] = useState<Record<string, QuestionAnswer>>({});
  const [answerOpen, setAnswerOpen] = useState<Record<string, boolean>>({});
  const [answerLoading, setAnswerLoading] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState("");
  const [myAnswerMap, setMyAnswerMap] = useState<Record<string, string>>({});
  const [myAnswerOpen, setMyAnswerOpen] = useState<Record<string, boolean>>({});
  const [reviewMap, setReviewMap] = useState<Record<string, InterviewAnswerReview>>({});
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState("");
  // 两条链路共用一个中止器：同一时刻只有一条在跑，谁在跑就停谁。
  const request = useAbortableRequest();

  // 写回用的"当前全部分组"：以它为准，而不是 `record.groups`（见文件头第 2 条）。
  const groupsRef = useRef<QuestionBankGroup[] | null>(null);

  // 换了一套题（新生成 / 换历史记录）：先把持久化过的内容种回去，再清空其余状态。
  // 渲染期守卫式调整（Compiler 规范：随 props 变化的派生状态在这里同步）。
  const [seededFrom, setSeededFrom] = useState<QuestionBankOut["groups"] | null>(null);
  if (groups !== seededFrom) {
    setSeededFrom(groups);
    setAnswerLoading(null);
    setReviewLoading(null);
    setAnswerError("");
    setReviewError("");

    const seededAnswers: Record<string, QuestionAnswer> = {};
    const seededAnswerOpen: Record<string, boolean> = {};
    const seededMine: Record<string, string> = {};
    const seededMineOpen: Record<string, boolean> = {};
    const seededReview: Record<string, InterviewAnswerReview> = {};
    // 旧版纯文本记录（groups 是字符串）也会走到这里：不是数组就当作"没有题"。
    (Array.isArray(groups) ? groups : []).forEach((group) =>
      group.questions.forEach((item, index) => {
        const key = `${group.type}-${index}`;
        if (item.answer || (item.key_points && item.key_points.length)) {
          seededAnswers[key] = {
            question: item.question,
            answer: item.answer ?? "",
            key_points: item.key_points ?? [],
            sample_phrasing: item.sample_phrasing ?? "",
          };
          // 已持久化的参考答案直接展开：打开历史记录就该看到内容。
          seededAnswerOpen[key] = true;
        }
        if (item.my_answer) {
          seededMine[key] = item.my_answer;
          seededMineOpen[key] = true;
        }
        // **必须判空对象**：后端 `InterviewQuestionItem.review` 的默认值是 `{}`，每道题都会
        // 带着一个空对象回来。只判 `typeof === "object"` 会把"没批改过"当成"有批改结果"，
        // 于是打开历史题库就渲染批改视图去读 `strengths.length` —— 整页白屏。
        const stored = item.review;
        if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
          seededReview[key] = stored as InterviewAnswerReview;
          seededMineOpen[key] = true;
        }
      }),
    );
    setAnswerMap(seededAnswers);
    setAnswerOpen(seededAnswerOpen);
    setMyAnswerMap(seededMine);
    setMyAnswerOpen(seededMineOpen);
    setReviewMap(seededReview);
  }

  // 换了一套题 / 换了一条记录：写回缓存必须清掉，否则下一次 patchItem 会从**上一套题**
  // 的分组开始拼，把新题目覆盖回去。ref 不在渲染期写（react-hooks/refs）。
  useEffect(() => {
    groupsRef.current = null;
  }, [groups, targetId]);

  const patchItem = (
    groupType: string,
    index: number,
    patch: Partial<Item>,
  ): QuestionBankGroup[] => {
    const base = groupsRef.current ?? (Array.isArray(groups) ? groups : []);
    const next = base.map((group) =>
      group.type === groupType
        ? {
            ...group,
            questions: group.questions.map((item, i) =>
              i === index ? { ...item, ...patch } : item,
            ),
          }
        : group,
    );
    groupsRef.current = next;
    return next;
  };

  const writeBack = async (next: QuestionBankGroup[]) => {
    if (targetId == null) return;
    try {
      await updateQuestionBank(targetId, { groups: next });
    } catch (error) {
      onWarn(error instanceof Error ? error.message : writeBackFailedText);
    }
  };

  /**
   * 真正生成一版参考答案（不自己起请求：`signal` 由调用方给，可能是「批改」的链路）。
   *
   * 生成成功后立刻写回题库记录——这一步**不跟着 signal 走**：正文既然已经拿到，
   * 落库就该完成，否则用户看到答案、刷新后又没了。
   */
  const fetchAnswer = async (
    key: string,
    question: string,
    groupType: string,
    index: number,
    signal: AbortSignal,
  ): Promise<QuestionAnswer> => {
    setAnswerLoading(key);
    setAnswerError("");
    setAnswerOpen((current) => ({ ...current, [key]: true }));
    try {
      const answer = await generateQuestionAnswer(
        { question, job_id: jobId, resume_id: resumeId },
        signal,
      );
      setAnswerMap((current) => ({ ...current, [key]: answer }));
      const next = patchItem(groupType, index, {
        answer: answer.answer,
        key_points: answer.key_points,
        sample_phrasing: answer.sample_phrasing,
      });
      await writeBack(next);
      return answer;
    } finally {
      setAnswerLoading(null);
    }
  };

  /**
   * 这一块该不该收起来。
   *
   * 只在**没有缓存**时才收起（回到「生成参考答案」按钮态）：有缓存说明用户原本就有内容，
   * 「停止」不该把已经看到的东西吃掉。
   */
  const collapseIfEmpty = (key: string) => {
    setAnswerOpen((current) => (answerMap[key] ? current : { ...current, [key]: false }));
    setAnswerLoading((current) => (current === key ? null : current));
  };

  /**
   * 确保这道题有参考答案：有缓存直接用，没有就现生成并写回。
   *
   * 返回生成的参考答案（失败/停止返回 null）——「我的作答」批改要先拿到它做对照，
   * 所以这里必须是可 await 的，而不是只管发请求。
   */
  const ensureAnswer = async (
    key: string,
    question: string,
    groupType: string,
    index: number,
  ): Promise<QuestionAnswer | null> => {
    const cached = answerMap[key];
    if (cached) return cached;
    if (request.loading) return null;
    const outcome = await request.run((signal) =>
      fetchAnswer(key, question, groupType, index, signal),
    );
    if (outcome.status === "ok") return outcome.data;
    if (outcome.status === "error") {
      setAnswerError(errorText(outcome.error, generateFailedText));
    }
    collapseIfEmpty(key);
    return null;
  };

  const toggleAnswer = (key: string, question: string, groupType: string, index: number) => {
    if (answerOpen[key]) {
      setAnswerOpen((current) => ({ ...current, [key]: false }));
      return;
    }
    if (answerMap[key]) {
      setAnswerOpen((current) => ({ ...current, [key]: true }));
      return;
    }
    void ensureAnswer(key, question, groupType, index);
  };

  const regenerateAnswer = (key: string, question: string, groupType: string, index: number) => {
    if (request.loading) return;
    void ensureAnswer(key, question, groupType, index);
  };

  const toggleMyAnswer = (key: string) => {
    setMyAnswerOpen((current) => ({ ...current, [key]: !current[key] }));
  };

  const submitMyAnswer = async (
    key: string,
    question: string,
    groupType: string,
    index: number,
    draft: string,
  ) => {
    if (request.loading) return;
    setReviewLoading(key);
    setReviewError("");
    const outcome = await request.run(async (signal) => {
      // 还没有参考答案就先补一份：批改要拿它做对照，而且补完用户就不用再单独点一次
      // 「生成参考答案」了（他的原话：先写答案再批改，参考答案应当顺手就有）。
      const reference =
        answerMap[key] ?? (await fetchAnswer(key, question, groupType, index, signal));
      const review = await reviewQuestionAnswer(
        {
          question,
          my_answer: draft,
          job_id: jobId,
          resume_id: resumeId,
          reference_answer: reference?.answer ?? "",
        },
        signal,
      );
      setMyAnswerMap((current) => ({ ...current, [key]: draft }));
      setReviewMap((current) => ({ ...current, [key]: review }));
      const next = patchItem(groupType, index, { my_answer: draft, review });
      await writeBack(next);
      return review;
    });
    if (outcome.status === "error") {
      setReviewError(errorText(outcome.error, reviewFailedText));
    }
    setReviewLoading((current) => (current === key ? null : current));
    // 停止/失败都不回填半截结果：批改视图只在成功分支里写过。
  };

  /**
   * 停止：断开在跑的请求，两条链路的 loading 当场收起。
   *
   * 「立刻可再点」是同步的——不等 promise 落地（挂着的请求可能永远不 resolve）。
   * 被停下来的那一次**不是失败**：不写 `answerError` / `reviewError`。
   */
  const cancelActive = () => {
    const answerKey = answerLoading;
    const reviewKey = reviewLoading;
    request.cancel();
    setAnswerLoading(null);
    setReviewLoading(null);
    if (answerKey) collapseIfEmpty(answerKey);
    if (reviewKey) setReviewError("");
  };

  return {
    answerMap,
    answerOpen,
    answerLoading,
    answerError,
    myAnswerMap,
    myAnswerOpen,
    reviewMap,
    reviewLoading,
    reviewError,
    toggleAnswer,
    regenerateAnswer,
    toggleMyAnswer,
    submitMyAnswer: (key, question, groupType, index, draft) =>
      void submitMyAnswer(key, question, groupType, index, draft),
    cancelActive,
  };
}
