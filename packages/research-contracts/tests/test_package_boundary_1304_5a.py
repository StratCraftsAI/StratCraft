from __future__ import annotations

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
NONA_PACKAGE = REPOSITORY_ROOT / "packages" / "nona-algorithm" / "nona_algorithm"
PUBLIC_PACKAGE = REPOSITORY_ROOT / "packages" / "research-contracts" / "research_contracts"


def test_commercial_package_has_no_duplicate_contract_owner() -> None:
    old_owners = [
        NONA_PACKAGE / "io" / "__init__.py",
        NONA_PACKAGE / "io" / "ohlcv_parquet.py",
        NONA_PACKAGE / "storage" / "__init__.py",
        NONA_PACKAGE / "storage" / "eval_parquet_writer.py",
        NONA_PACKAGE / "signal_sweep" / "evaluation_contract.py",
    ]

    assert all(not path.exists() for path in old_owners)


def test_public_contracts_do_not_import_commercial_package() -> None:
    sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(PUBLIC_PACKAGE.rglob("*.py"))
    )

    assert "import nona_algorithm" not in sources
    assert "from nona_algorithm" not in sources
