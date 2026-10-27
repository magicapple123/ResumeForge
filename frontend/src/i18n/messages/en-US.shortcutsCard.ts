// SPDX-License-Identifier: Apache-2.0
/**
 * Home page · quick links card and its "Customize quick links" dialog: card title,
 * edit entry, selection hint and the dialog footer actions.
 *
 * Link names (Job board, Resume center, …) come from `MENU_ITEMS` in
 * `components/navigation/navigationConfig.ts` and belong to the navigation namespace,
 * so they are not duplicated here. The Save button reuses `common.action.save`.
 */
const shortcutsCard = {
  "shortcutsCard.card.title": "Quick links",
  "shortcutsCard.action.edit": "Edit",
  "shortcutsCard.action.editAria": "Edit quick links",

  "shortcutsCard.modal.title": "Customize quick links",
  "shortcutsCard.modal.hint":
    "Choose the links to show on the home page; keep at least one selected.",

  "shortcutsCard.action.restoreDefault": "Restore defaults",
} as const;

export default shortcutsCard;
