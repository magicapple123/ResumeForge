// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { hydrateLocaleFromServer } from "./localePersistence";

export default function LocaleBootstrap() {
  useEffect(() => {
    void hydrateLocaleFromServer();
  }, []);
  return null;
}
