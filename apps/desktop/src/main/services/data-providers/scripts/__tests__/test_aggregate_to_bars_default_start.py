"""TICKET_958_3 AC #11: source-pin test for aggregate_to_bars.py default
window inference.

The aggregator lives in a sibling repo (`STRATCRAFT_EQUITIES_HIST_ROOT`); it is
not importable from this Electron repo's test runner. The regression we
want to prevent -- a silent truncation when `--start` is omitted, which
was the 2026-06-14 Finding 7 incident -- is best caught at the text
level: assert that the script reads min/max from the raw_parquet
metadata, defaults to those when the CLI flags are absent, and logs the
inferred window so an operator cannot miss the resolved bounds.

If the sibling script is absent (e.g. running tests in an environment
where the equities-hist directory is not mounted), the test is skipped
rather than failing -- the production sweep simply cannot run in such
an environment, so the regression guard is moot there.
"""

from __future__ import annotations

import os
import re
import unittest

# The aggregator lives in a sibling repo whose checkout location is
# developer-specific. STRATCRAFT_EQUITIES_HIST_ROOT points at that checkout; when
# it is unset the test is skipped by the guard in setUpClass below.
AGGREGATE_PATH = os.path.join(
    os.environ.get("STRATCRAFT_EQUITIES_HIST_ROOT", ""),
    "scripts",
    "aggregate_to_bars.py",
)


class AggregateToBarsDefaultStartTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        root = os.environ.get("STRATCRAFT_EQUITIES_HIST_ROOT")
        if not root:
            raise unittest.SkipTest(
                "STRATCRAFT_EQUITIES_HIST_ROOT is unset -- test is "
                "environment-conditional; nothing to pin."
            )
        if not os.path.exists(AGGREGATE_PATH):
            raise unittest.SkipTest(
                f"aggregate_to_bars.py not found at {AGGREGATE_PATH} -- "
                "test is environment-conditional; nothing to pin."
            )
        with open(AGGREGATE_PATH, "r", encoding="utf-8") as fh:
            cls.src = fh.read()

    def test_inference_helper_exists_and_reads_ts_event_row_group_stats(self) -> None:
        # The helper must exist and read row-group statistics (min/max)
        # off the ts_event column -- not materialise the file, per the
        # NO_FULL_HISTORY_READ rule.
        self.assertIn("def infer_window_from_raw_parquet", self.src)
        self.assertRegex(self.src, r"col\.path_in_schema\s*!=\s*['\"]ts_event['\"]")
        self.assertIn("row_group", self.src)
        self.assertIn("statistics", self.src)

    def test_inference_is_invoked_when_start_or_end_is_omitted(self) -> None:
        # The dispatch in main() must call the helper when either bound
        # is missing -- a partial override (only --start, only --end)
        # must still pick up the other bound from the raw parquet.
        self.assertRegex(
            self.src,
            r"if\s+start\s+is\s+None\s+or\s+end\s+is\s+None:",
        )
        # And the helper is the one we call when either is None.
        self.assertIn("infer_window_from_raw_parquet(dbn_files", self.src)

    def test_inferred_bounds_replace_missing_cli_flags(self) -> None:
        # When --start is absent, the inferred start must be assigned to
        # `start` (and same for end). A regression here would mean the
        # inference runs but the resulting window is silently discarded.
        self.assertRegex(
            self.src,
            r"if\s+start\s+is\s+None:\s*\n(?:.*\n){0,3}\s*start\s*=\s*inferred_start",
        )
        self.assertRegex(
            self.src,
            r"if\s+end\s+is\s+None:\s*\n(?:.*\n){0,3}\s*end\s*=\s*inferred_end",
        )

    def test_inferred_window_is_logged_so_truncation_is_visible(self) -> None:
        # Finding 7's failure mode was a silent truncation: the
        # operator could not tell from the log whether the run had
        # covered everything or just the trailing slice. The log line
        # that names the inferred window must remain.
        self.assertRegex(
            self.src,
            r'Inferred\s+raw_parquet\s+window:',
        )

    def test_ac_11_reference_is_present_to_prevent_silent_regression(self) -> None:
        # If a future edit strips out the inference dispatch, this
        # ticket reference is the breadcrumb that points the next
        # investigator back at the spec.
        self.assertIn("TICKET_958_3 AC #11", self.src)


if __name__ == "__main__":
    unittest.main()
