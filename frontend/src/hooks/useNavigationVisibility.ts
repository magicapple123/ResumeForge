import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getHiddenNavigationKeys,
  isNavigationVisibilityLoaded,
  loadNavigationVisibility,
  subscribeNavigationVisibility,
} from "../utils/navigationVisibility";

export function useNavigationVisibility(): {
  hiddenKeys: string[];
  loading: boolean;
} {
  const hiddenKeys = useSyncExternalStore(
    subscribeNavigationVisibility,
    getHiddenNavigationKeys,
    getHiddenNavigationKeys,
  );
  const [loading, setLoading] = useState(!isNavigationVisibilityLoaded());

  useEffect(() => {
    let active = true;
    void loadNavigationVisibility().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { hiddenKeys, loading };
}
