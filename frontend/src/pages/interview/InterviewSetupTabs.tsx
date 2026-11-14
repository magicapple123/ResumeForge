// SPDX-License-Identifier: Apache-2.0
/** 模拟面试未进房间时的四个 tab：面试设置 + 历史、题库、面经、复盘。 */
import { Tabs } from "antd";
import type { FormInstance } from "antd";
import type { ComponentProps } from "react";
import InterviewExperiencePanel from "../../features/interview/InterviewExperiencePanel";
import InterviewReviewPanel from "../../features/interview/InterviewReviewPanel";
import QuestionBankPanel from "../../features/questionbank/QuestionBankPanel";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewBrief, InterviewReviewRecord, QuestionBankRecord } from "../../types";
import { HistoryCard } from "./HistoryCard";
import { SetupTab, type SetupForm } from "./SetupTab";

interface Props {
  activeTab: string;
  onActiveTabChange: (tab: string) => void;
  form: FormInstance<SetupForm>;
  /** 岗位详情「模拟面试」深链带来的预填岗位。 */
  linkedJobId: ComponentProps<typeof SetupTab>["initialJobId"];
  initialResumeMaterial: ComponentProps<typeof SetupTab>["initialResumeMaterial"];
  starting: boolean;
  onStart: (values: SetupForm) => void;
  sessions: InterviewBrief[];
  batch: ComponentProps<typeof HistoryCard>["batch"];
  loadingList: boolean;
  onOpen: (id: number) => Promise<void>;
  onRemove: (session: InterviewBrief) => Promise<void>;
  onRemoveSelected: () => void;
  onStartFromBank: ComponentProps<typeof QuestionBankPanel>["onStartSession"];
  bankRecord: QuestionBankRecord | null;
  onOpenBankRecord: (record: QuestionBankRecord | null) => void;
  onCloseBankRecord: () => void;
  reviewRecord: InterviewReviewRecord | null;
  onOpenReviewRecord: (record: InterviewReviewRecord | null) => void;
  onCloseReviewRecord: () => void;
  onGoToResume: () => void;
}

export default function InterviewSetupTabs({
  activeTab,
  onActiveTabChange,
  form,
  linkedJobId,
  initialResumeMaterial,
  starting,
  onStart,
  sessions,
  batch,
  loadingList,
  onOpen,
  onRemove,
  onRemoveSelected,
  onStartFromBank,
  bankRecord,
  onOpenBankRecord,
  onCloseBankRecord,
  reviewRecord,
  onOpenReviewRecord,
  onCloseReviewRecord,
  onGoToResume,
}: Props) {
  useLocale();
  return (
    <Tabs
      activeKey={activeTab}
      onChange={onActiveTabChange}
      items={[
        {
          key: "session",
          label: t("interview.tab.interview"),
          children: (
            <div className="interview-setup">
              <SetupTab
                form={form}
                initialJobId={linkedJobId}
                initialResumeMaterial={initialResumeMaterial}
                starting={starting}
                onStart={onStart}
              />

              <HistoryCard
                sessions={sessions}
                batch={batch}
                loadingList={loadingList}
                onOpen={onOpen}
                onRemove={onRemove}
                onRemoveSelected={onRemoveSelected}
              />
            </div>
          ),
        },
        {
          key: "bank",
          label: t("interview.tab.questionBank"),
          children: (
            <QuestionBankPanel
              onStartSession={onStartFromBank}
              record={bankRecord}
              onOpenRecord={onOpenBankRecord}
              onCloseRecord={onCloseBankRecord}
            />
          ),
        },
        {
          key: "experiences",
          label: t("interview.tab.experiences"),
          children: <InterviewExperiencePanel />,
        },
        {
          key: "review",
          label: t("interview.tab.review"),
          children: (
            <InterviewReviewPanel
              onGoToResume={onGoToResume}
              record={reviewRecord}
              onOpenRecord={onOpenReviewRecord}
              onCloseRecord={onCloseReviewRecord}
            />
          ),
        },
      ]}
    />
  );
}
