// SPDX-License-Identifier: Apache-2.0
//
// Pins the "system language" that `localeStore.readInitialLocale()` probes.
//
// Why a separate module that setup.ts imports FIRST: the store resolves its initial
// locale at **module load** time (first-launch probe: `zh*` -> zh-CN, anything else
// -> en-US). Import order is what decides whether the pin is early enough —
// setup.ts itself imports `@testing-library/react`, whose `vi.mock` factory pulls in
// I18nProvider -> `src/i18n` -> localeStore. A pin written further down setup.ts ran
// *after* that chain, so the store was already built from jsdom's `en-US` and 18
// test files / 75 Chinese assertions went red while `src/i18n` alone stayed green.
// Importing this module before every other import of setup.ts evaluates the pin
// before anything in the graph can construct the store.
//
// jsdom reports `en-US`, but the suite's documented baseline is zh-CN (`DEFAULT_LOCALE`;
// see the beforeEach in setup.ts), so the pin makes the probe agree with that baseline
// instead of silently switching every legacy component test to English. It only
// affects code that reads `navigator.language(s)` — in this repo that is localeStore
// alone. Cases that need a non-Chinese system (English / Japanese / C locale) override
// it with `vi.stubGlobal("navigator", { languages, language })`: stubGlobal defines an
// own property on globalThis, which wins over the instance getters installed here.
Object.defineProperty(window.navigator, "languages", {
  configurable: true,
  get: () => ["zh-CN", "zh"],
});
Object.defineProperty(window.navigator, "language", {
  configurable: true,
  get: () => "zh-CN",
});
