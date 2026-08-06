"""
TICKET_1292_15 (MC-15, cut 5C-1) -- Python code_version golden parity generator.

Captures nona_algorithm.signal_sources.code_version.compute_code_version across
every registered template, so the C++ code-version port can be proven
value-identical to the Python authority it removes (the
`python -m nona_algorithm.signal_sources.code_version` subprocess spawned by
code-version-cache.ts) BEFORE the rewire.

The parity-critical output is `code_version` (the 64-hex cache key) plus its two
component hashes and the source-file count. The absolute `lockfile_path` is
machine-specific, so only its basename is pinned (the C++ owner resolves the
same lockfile by the same search order).

Run from repo root:
    PYTHONPATH=packages/nona-algorithm python \
      packages/executor/tests/fixtures/gen_code_version_parity.py \
      > packages/executor/tests/fixtures/code_version_parity_v1.json
"""

from __future__ import annotations

import json
import os
import sys

from nona_algorithm.signal_sources import code_version as cv


def main() -> int:
    cases = []
    for template_id in sorted(cv._TEMPLATE_MODULE):
        payload = cv.compute_code_version(template_id)
        cases.append(
            {
                "templateId": template_id,
                "codeVersion": payload["code_version"],
                "sourceFilesSha256": payload["source_files_sha256"],
                "lockfileSha256": payload["lockfile_sha256"],
                "sourceFileCount": int(payload["source_file_count"]),
                "lockfileBasename": os.path.basename(payload["lockfile_path"]),
            }
        )
    sys.stdout.write(json.dumps({"version": 1, "cases": cases}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
