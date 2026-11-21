# SPDX-License-Identifier: Apache-2.0
"""Set the version of a disposable Windows upgrade candidate."""

import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bump_version  # noqa: E402


def main() -> None:
    if os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise SystemExit("Prepare the rehearsal in a disposable GitHub-hosted checkout.")

    published = bump_version.parse_version(sys.argv[1].removeprefix("v"))
    configured_versions = set(bump_version.read_versions())
    if len(configured_versions) != 1:
        raise SystemExit("The checkout has inconsistent app versions.")
    current = bump_version.parse_version(configured_versions.pop())
    version = ".".join(map(str, bump_version.bump_version(max(current, published), "patch")))

    # A just-tagged checkout can have an empty Unreleased section. The generic
    # version script requires an entry before archiving it under the test version.
    changelog = bump_version.CHANGELOG
    text = changelog.read_text(encoding="utf-8")
    heading = bump_version.UNRELEASED_HEADING
    marker = heading + "\n\n- Windows upgrade rehearsal.\n"
    changelog.write_text(text.replace(heading, marker, 1), encoding="utf-8", newline="\n")
    bump_version.apply_version(version, date.today().isoformat())
    print(version)


if __name__ == "__main__":
    main()
