import { getNavigationVisibility } from "../api/settings";

type Listener = () => void;

let hiddenKeys: string[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getHiddenNavigationKeys(): string[] {
  return hiddenKeys;
}

export function isNavigationVisibilityLoaded(): boolean {
  return loaded;
}

export function subscribeNavigationVisibility(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishHiddenNavigationKeys(nextKeys: readonly string[]): void {
  const next = [...new Set(nextKeys)].sort();
  if (next.length === hiddenKeys.length && next.every((key, index) => key === hiddenKeys[index])) {
    return;
  }
  hiddenKeys = next;
  emit();
}

export async function loadNavigationVisibility(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = getNavigationVisibility()
    .then((config) => publishHiddenNavigationKeys(config.hidden))
    .catch(() => undefined)
    .finally(() => {
      loaded = true;
      loadPromise = null;
      emit();
    });
  return loadPromise;
}

export function resetNavigationVisibilityForTests(): void {
  hiddenKeys = [];
  loaded = false;
  loadPromise = null;
  emit();
}
