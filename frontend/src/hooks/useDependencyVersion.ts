// SPDX-License-Identifier: Apache-2.0
import { type DependencyList, useState } from "react";

/** Convert caller-supplied dependencies into an Object.is-stable effect key. */
export function useDependencyVersion(dependencies: DependencyList): number {
  const [snapshot, setSnapshot] = useState(() => ({
    dependencies: [...dependencies],
    version: 0,
  }));
  const unchanged =
    snapshot.dependencies.length === dependencies.length &&
    snapshot.dependencies.every((value, index) => Object.is(value, dependencies[index]));
  if (!unchanged) {
    // A guarded render adjustment avoids mutating refs during render and ensures
    // the final committed effect has a literal, statically checkable dependency list.
    setSnapshot({ dependencies: [...dependencies], version: snapshot.version + 1 });
  }
  return snapshot.version;
}
