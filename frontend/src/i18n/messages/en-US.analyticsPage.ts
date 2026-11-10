// SPDX-License-Identifier: Apache-2.0
/**
 * Job analytics page: overview metrics, the four themed sections, empty states, data-gap notes
 * and the chart axis labels.
 *
 * Stage names on the conversion/duration cards are not here: they map a protocol value to a
 * display name and share the tracker enum table in `i18n/enum/tracker.ts`; referral status
 * names likewise come from `i18n/enum/referral.ts`.
 */
const analyticsPage = {
  "analyticsPage.title": "Job search analytics",
  "analyticsPage.subtitle":
    "Application conversion and blockers, timing, channels and resume health — all aggregated locally and available offline.",
  "analyticsPage.loadError": "Could not load the analytics: {error}",
  "analyticsPage.empty.noData": "No dashboard data yet",
  "analyticsPage.empty.noApplications": "No applications yet",
  "analyticsPage.action.goFill": "Add details",
  "analyticsPage.reminder.overdue": "Overdue",
  "analyticsPage.reminder.soon": "Within 24 hours",
  "analyticsPage.reminder.upcoming": "Within 3 days",
  "analyticsPage.reminder.later": "Later",
  "analyticsPage.topCompanies.title": "Most applied companies",
  "analyticsPage.topCompanies.chartHint": "Top 5",
  "analyticsPage.topCompanies.missingCompany": "Applications without a company name",
  "analyticsPage.topCompanies.missingCompanyRanking":
    "Applications without a company name, excluded from the ranking",
  "analyticsPage.topCompanies.other": "{count} more companies are not in the top 5",
  "analyticsPage.overview.total": "Total applications",
  "analyticsPage.overview.validApplications": "Valid applications: {count}",
  "analyticsPage.overview.interviewRate": "Interview rate",
  "analyticsPage.overview.interviewHint": "{interview} interviews / {valid} valid applications",
  "analyticsPage.overview.assessmentRate": "Assessment pass rate",
  "analyticsPage.overview.assessmentHint":
    "{toInterview} reached interview / {assessment} assessments",
  "analyticsPage.overview.offerCount": "Offers",
  "analyticsPage.overview.offerHint": "Offer rate: {rate}",
  "analyticsPage.funnel.title": "Conversion and blockers",
  "analyticsPage.funnel.description":
    "Every conversion rate uses valid applications as its denominator, excluding applications still awaiting confirmation. 'No status change for over 7 days' means an active application whose status has not changed for more than 7 days — editing a note does not count as progress, so it does not mean the interview is stuck.",
  "analyticsPage.funnel.chartTitle": "Application funnel",
  "analyticsPage.funnel.chartHint":
    "Number of applications at each stage; the denominator is valid applications",
  "analyticsPage.funnel.active": "In progress",
  "analyticsPage.funnel.activeHint":
    "Applied / screening / assessment / interview, excluding offers (offers have their own funnel stage)",
  "analyticsPage.funnel.stalled": "No status change for over 7 days",
  "analyticsPage.funnel.stalledHint": "Active with no status change for 7 days",
  "analyticsPage.funnel.noNextAction": "No next step",
  "analyticsPage.funnel.noNextActionHint": "Active with no next step set",
  "analyticsPage.funnel.action": "Go to the Job tracker to add a next step or advance the status",
  "analyticsPage.cohort.title": "Real timeline",
  "analyticsPage.cohort.description":
    "Counts only status changes recorded after event tracking launched: each item states its numerator and denominator in the hint, and a badge appears when the sample is small. These numbers describe the past only — they do not predict or promise that using the product will improve anything.",
  "analyticsPage.cohort.empty": "No tracker entries yet",
  "analyticsPage.cohort.emptyHistorical":
    "No status changes recorded yet — the next status change will start collecting data.",
  "analyticsPage.cohort.historicalNotice":
    "You have {historical} entries from before event tracking ({total} in total), so there is no stage data; changes from now on will be recorded.",
  "analyticsPage.cohort.noRecords": "No records have reached this stage",
  "analyticsPage.cohort.conversionHint":
    "Advanced to the next stage {numerator} / reached this stage {denominator} entries",
  "analyticsPage.cohort.smallSample": "Fewer than 5 samples — for reference only",
  "analyticsPage.cohort.durationTitle": "{from} → {to} duration",
  "analyticsPage.cohort.noComparableData": "No comparable data yet",
  "analyticsPage.cohort.medianDays": "Median {days} days",
  "analyticsPage.cohort.basedOn":
    "Based on {numerator} date pairs ({denominator} entries at this stage)",
  "analyticsPage.cohort.undatedNotice":
    "You have {count} status changes without a date; duration falls back to the day the change was recorded.",
  "analyticsPage.trend.title": "Timing and rhythm",
  "analyticsPage.trend.description":
    "The trend and weekday distribution count by application date; recent additions count by creation time in a rolling window, independent of your time zone.",
  "analyticsPage.trend.month1": "Last 1 month",
  "analyticsPage.trend.month3": "Last 3 months",
  "analyticsPage.trend.month6": "Last 6 months",
  "analyticsPage.trend.year1": "Last 1 year",
  "analyticsPage.trend.missingDate": "Applications with no application date",
  "analyticsPage.trend.appliedTrend": "Application trend",
  "analyticsPage.trend.weekdayTitle": "Applications by weekday",
  "analyticsPage.trend.byAppliedDate": "By application date",
  "analyticsPage.trend.emptyNoDates": "No records with an application date yet",
  "analyticsPage.trend.recent7d": "Added in the last 7 days",
  "analyticsPage.trend.recent30d": "Added in the last 30 days",
  "analyticsPage.trend.byCreatedTime": "By creation time",
  "analyticsPage.trend.reminderTitle": "Reminders · {bucket}",
  // Chart axis labels: the backend sends Chinese display names, so the page maps them back by
  // the stable month number and weekday index.
  "analyticsPage.trend.monthLabel.1": "Jan",
  "analyticsPage.trend.monthLabel.2": "Feb",
  "analyticsPage.trend.monthLabel.3": "Mar",
  "analyticsPage.trend.monthLabel.4": "Apr",
  "analyticsPage.trend.monthLabel.5": "May",
  "analyticsPage.trend.monthLabel.6": "Jun",
  "analyticsPage.trend.monthLabel.7": "Jul",
  "analyticsPage.trend.monthLabel.8": "Aug",
  "analyticsPage.trend.monthLabel.9": "Sep",
  "analyticsPage.trend.monthLabel.10": "Oct",
  "analyticsPage.trend.monthLabel.11": "Nov",
  "analyticsPage.trend.monthLabel.12": "Dec",
  "analyticsPage.weekday.mon": "Mon",
  "analyticsPage.weekday.tue": "Tue",
  "analyticsPage.weekday.wed": "Wed",
  "analyticsPage.weekday.thu": "Thu",
  "analyticsPage.weekday.fri": "Fri",
  "analyticsPage.weekday.sat": "Sat",
  "analyticsPage.weekday.sun": "Sun",
  "analyticsPage.channels.title": "Channels and outcomes",
  "analyticsPage.channels.description":
    "Referral conversion is derived from the linked tracker entry — it only counts once that entry reaches Interview or later. Source is **how the entry got into the system**; the application channel (see Channel conversion above) is where the job came from; the referral module is a third, independent record set. Do not add them together.",
  "analyticsPage.channels.referralRate": "Referral conversion rate",
  "analyticsPage.channels.referralRateHint": "Converted {converted} / valid referrals {total}",
  "analyticsPage.channels.referralTotal": "Total referrals",
  "analyticsPage.channels.referralTotalHint": "Includes closed and invalid",
  "analyticsPage.channels.caliberTitle": "How to read this",
  "analyticsPage.channels.caliberBody":
    "Source is how the entry was added, not the application channel (see Channel conversion above); referral conversion counts linked applications that reached Interview or later.",
  "analyticsPage.channels.referralStatusTitle": "Referral status distribution",
  "analyticsPage.channels.referralStatusHint": "By current referral status",
  "analyticsPage.channels.emptyReferrals": "No referrals yet",
  "analyticsPage.channels.sourcesTitle": "Sources",
  "analyticsPage.channels.sourcesHint": "How entries were added, not an application channel",
  "analyticsPage.resume.title": "Resumes and health",
  "analyticsPage.resume.description":
    "The 'With consistency warnings' and 'With [To fill]' counts come from records saved at generation time and unfinished markers in the text; 'Unconfirmed claims' are fact-ledger entries that are not verified yet but affect what can be cited.",
  "analyticsPage.resume.count": "Resumes",
  "analyticsPage.resume.scannedHint": "Placeholders are counted only in the latest {count} resumes",
  "analyticsPage.resume.allScanned": "All included in the stats",
  "analyticsPage.resume.withWarnings": "With consistency warnings",
  "analyticsPage.resume.withPlaceholders": "With [To fill]",
  "analyticsPage.resume.unverifiedClaims": "Unconfirmed claims",
  "analyticsPage.resume.missingLink": "Applications not linked to a resume",
  "analyticsPage.resume.missingLinkAction":
    "Linking is required to see resume performance; the entry form does not offer linking yet.",

  // ===== Item 17 additions: channel conversion / durations / repeats / resume effect / goal+cost =====
  "analyticsPage.channelConversion.title": "Channel conversion",
  "analyticsPage.channelConversion.description":
    "Groups by the application record's channel field: applications, interviews reached and offers per channel. Channels and referrals are **two separate systems** — the referral channel is a record field while the referral module is its own object, so never add them together.",
  "analyticsPage.channelConversion.hint":
    "{interview} interviews / {total} applications; {offer} offers ({offerRate})",
  "analyticsPage.channelConversion.caliber":
    "Source: the channel field on the tracker entry (user-selected, not the record source). The denominator is that channel's application count; fewer than 5 samples means reference only.",
  "analyticsPage.channelConversion.empty": "No applications with a channel yet",
  "analyticsPage.statusDuration.title": "Application → current stage",
  "analyticsPage.statusDuration.description":
    "Grouped by current status: median days between the application date and the status date the user filled in. Missing either date means the entry is excluded. This does not use the status-event table and never infers from the updated timestamp.",
  "analyticsPage.statusDuration.medianDays": "Median {days} days",
  "analyticsPage.statusDuration.noComparable": "No comparable data",
  "analyticsPage.statusDuration.basedOn": "Based on {sample} / {total} entries with dates",
  "analyticsPage.statusDuration.empty":
    "No entries with both an application date and a status date yet",
  "analyticsPage.statusDuration.skippedNegative":
    "{count} entries have a status date earlier than the application date (back-filled out of order) and were excluded from the median.",
  "analyticsPage.companyRepeats.title": "Multiple applications per company",
  "analyticsPage.companyRepeats.description":
    "Companies you applied to more than once: >=2 applications are listed; companies with >=3 applications and zero interviews are called out so you can stop and reassess.",
  "analyticsPage.companyRepeats.itemHint":
    "{total} applications, {interview} interviews, {offer} offers",
  "analyticsPage.companyRepeats.itemLine": "{company}: {hint}",
  "analyticsPage.companyRepeats.lineSeparator": "; ",
  "analyticsPage.companyRepeats.nameSeparator": ", ",
  "analyticsPage.companyRepeats.noInterviewTitle":
    "Worth stopping: >=3 applications, zero interviews",
  "analyticsPage.companyRepeats.noInterviewEmpty": "None",
  "analyticsPage.companyRepeats.empty": "No company has received more than one application yet",
  "analyticsPage.resumeEffect.title": "Resume version results",
  "analyticsPage.resumeEffect.description":
    "Grouped by the resume linked to an application; linking exists but coverage is low, so every group shows its sample size. Describes the past only — no ‘using this version will do better’ claims.",
  "analyticsPage.resumeEffect.hint": "{interview} interviews / {total} applications",
  "analyticsPage.resumeEffect.untitled": "Untitled resume",
  "analyticsPage.resumeEffect.bias":
    "Linking itself has selection bias (people link a resume for the roles they care about); results with fewer than 5 samples are unreliable.",
  "analyticsPage.resumeEffect.empty": "No applications are linked to a resume yet",
  "analyticsPage.goal.title": "Goal and generation cost",
  "analyticsPage.goal.description":
    "The weekly goal counts only this week (Monday–Sunday) by application date; generation cost reports tokens and duration only — no money, because the local ledger has no price table.",
  "analyticsPage.goal.weeklyLabel": "Weekly application goal",
  "analyticsPage.goal.save": "Save goal",
  "analyticsPage.goal.saved": "Weekly application goal saved",
  "analyticsPage.goal.saveFailed": "Could not save. Try again.",
  "analyticsPage.goal.zeroHint":
    "Save 0 to clear the goal; it only affects this comparison and never changes the application flow.",
  "analyticsPage.goal.progress": "{done} / {target}",
  "analyticsPage.goal.thisWeek": "{count} applications this week",
  "analyticsPage.cost.generateCalls": "Generation calls",
  "analyticsPage.cost.generateCallsHint":
    "resume_generate calls (including repair/compression rounds)",
  "analyticsPage.cost.avgDuration": "Average duration",
  "analyticsPage.cost.seconds": "s",
  "analyticsPage.cost.avgDurationHint": "Average duration per generation call",
  "analyticsPage.cost.avgCompletion": "Average output",
  "analyticsPage.cost.avgCompletionHint": "Average completion tokens per call",
  "analyticsPage.cost.totalCalls": "All AI calls",
  "analyticsPage.cost.totalCallsHint": "All tasks combined: {tokens} tokens",
  "analyticsPage.cost.caliber":
    "'Generation' means the resume_generate task; no money is shown (the ledger has no price table).",
} as const;

export default analyticsPage;
