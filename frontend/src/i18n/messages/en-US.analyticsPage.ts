// SPDX-License-Identifier: Apache-2.0
/**
 * Job analytics page: overview metrics, the four themed sections, empty states and data-gap notes.
 *
 * Stage names on the conversion/duration cards are not here: they map a protocol value to a
 * display name and are shared with the Job tracker page through `trackerForm.status.*`.
 * Referral status names likewise come from `referralForm.status.*`.
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
    "Every conversion rate uses valid applications as its denominator, excluding applications still awaiting confirmation. 'No update for over 7 days' means an active application with no change at all in the past 7 days — even editing a note counts as an update, so it does not mean the interview is stuck.",
  "analyticsPage.funnel.chartTitle": "Application funnel",
  "analyticsPage.funnel.chartHint":
    "Number of applications at each stage; the denominator is valid applications",
  "analyticsPage.funnel.active": "In progress",
  "analyticsPage.funnel.activeHint": "Not yet closed",
  "analyticsPage.funnel.stalled": "No update for over 7 days",
  "analyticsPage.funnel.stalledHint": "Active but untouched for a while",
  "analyticsPage.funnel.noNextAction": "No next step",
  "analyticsPage.funnel.noNextActionHint": "Active with no next step set",
  "analyticsPage.funnel.action": "Go to the Job tracker to add a next step or advance the status",
  "analyticsPage.cohort.title": "Real timeline",
  "analyticsPage.cohort.description":
    "Counts only status changes recorded after event tracking launched: each item states its numerator and denominator in the hint, and a badge appears when the sample is small. These numbers describe the past only — they do not predict or promise that using the product will improve anything.",
  "analyticsPage.cohort.empty": "No tracker entries yet",
  "analyticsPage.cohort.emptyHistorical":
    "You have {count} tracker entries from before event tracking, so there is no stage data; changes from now on will be recorded.",
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
  "analyticsPage.channels.title": "Channels and outcomes",
  "analyticsPage.channels.description":
    "Referral conversion is derived from the linked tracker entry — it only counts once that entry reaches Interview or later. Source is **how the entry got into the system**, not an application channel (this database has no channel field).",
  "analyticsPage.channels.referralRate": "Referral conversion rate",
  "analyticsPage.channels.referralRateHint": "Converted {converted} / valid referrals {total}",
  "analyticsPage.channels.referralTotal": "Total referrals",
  "analyticsPage.channels.referralTotalHint": "Includes closed and invalid",
  "analyticsPage.channels.caliberTitle": "How to read this",
  "analyticsPage.channels.caliberBody":
    "Source is how the entry was added, not an application channel; referral conversion counts linked applications that reached Interview or later.",
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
} as const;

export default analyticsPage;
