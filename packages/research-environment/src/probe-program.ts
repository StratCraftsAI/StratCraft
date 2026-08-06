/**
 * TICKET_1335 L4 / D5: the canonical readiness verifier, as a Python program run
 * by the locked interpreter.
 *
 * The program is a string constant here, executed with `python -c`, rather than
 * a `.py` file on disk. That is deliberate: a file could be edited, shadowed by
 * a stale copy, or omitted from a package build, and the verifier's whole job is
 * to be the one authority on readiness. Shipping it inside the module that
 * interprets its output removes any possibility of the two drifting.
 *
 * It emits a single line of JSON on stdout and nothing else. Human-readable
 * probe chatter would have to be parsed to make a decision, which TICKET_1335
 * AC5 forbids; a machine-readable envelope keeps the branch on structured data.
 *
 * D5 plus AC24 require eight things, and each maps to a named section below:
 *   1. import + version capture for all six capabilities;
 *   2. an in-memory DuckDB query;
 *   3. a deterministic gplearn fit/predict;
 *   4. GPQuant import + smallest supported program;
 *   5. PySR import + *Julia backend initialization* + bounded regression;
 *   6. `pandas_ta` through the accessor `talib_engine.py` actually uses;
 *   7. shared NumPy/pandas/SciPy/scikit-learn/PyArrow stack compatibility;
 *   8. HistData's public parser-to-Parquet path against a bounded fixture.
 *
 * Step 7 has no capability of its own. D5 is explicit that it is *attributed*
 * rather than invented: the shared stack is imported as part of the first
 * capability probe that depends on it, so an ABI failure surfaces as that
 * capability's `import` failure with the offending module named. No
 * `shared_stack` pseudo-capability exists, because nothing installs or reports
 * it independently.
 */

/**
 * Marker framing the JSON payload.
 *
 * Required because the probe cannot guarantee a clean stdout: importing PySR
 * initializes Julia, which writes precompilation notices, and `pandas_ta` emits
 * deprecation warnings on some pandas versions. Scanning for a delimited region
 * is robust against that, whereas `JSON.parse(stdout)` would fail on the first
 * unrelated line any dependency chose to print.
 */
export const PROBE_RESULT_BEGIN = '<<<STRATCRAFT_RESEARCH_PROBE_BEGIN>>>';
export const PROBE_RESULT_END = '<<<STRATCRAFT_RESEARCH_PROBE_END>>>';

/**
 * Version resolution uses `importlib.metadata.version()` against the
 * distribution name -- never a module `__version__` attribute.
 *
 * This is load-bearing, not a preference. `pandas_ta` 0.4.71b0 exposes no
 * `__version__` at all (verified against the live locked environment), so an
 * attribute-based probe reports it as unversioned. The contract requires a
 * non-empty `installed` version for *every* capability before the environment
 * may be `ready`, which would make `ready` structurally unreachable. Package
 * metadata is also the same source the lock records, so expected and installed
 * are read on comparable terms.
 */
export const PROBE_PROGRAM = String.raw`
import json, sys, tempfile
from pathlib import Path

BEGIN = "<<<STRATCRAFT_RESEARCH_PROBE_BEGIN>>>"
END = "<<<STRATCRAFT_RESEARCH_PROBE_END>>>"

# Distribution names as they appear in package metadata and in pixi.lock. The
# pandas_ta contract key differs from its "pandas-ta" distribution name; that
# translation lives in environment-paths.ts and is mirrored here.
DISTRIBUTIONS = {
    "histdata": "histdata-supplementary",
    "duckdb": "duckdb",
    "gplearn": "gplearn",
    "gpquant": "gpquant",
    "pysr": "pysr",
    "pandas_ta": "pandas-ta",
}

results = {}
production_entry = {}
progress_count = 0


def record(capability, ok, cause=None, message=None, version=None, verification=None, extra=None):
    global progress_count
    entry = {"ok": ok}
    if cause is not None:
        entry["cause"] = cause
    if message is not None:
        # Bounded so a multi-megabyte traceback cannot cross the boundary; the
        # contract caps message length and would reject an unbounded string.
        entry["message"] = str(message)[:1800]
    if version is not None:
        entry["version"] = str(version)[:64]
    if verification is not None:
        entry["verification"] = str(verification)[:1800]
    if extra:
        entry.update(extra)
    results[capability] = entry
    progress_count += 1
    print("<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>{0}:{1}:{2}".format(
        progress_count, len(DISTRIBUTIONS), capability), file=sys.stderr, flush=True)


def read_version(capability):
    """Distribution metadata, not module __version__ -- see the TS comment."""
    from importlib.metadata import version as dist_version
    return dist_version(DISTRIBUTIONS[capability])


def fail_from_exception(capability, cause, exc):
    record(
        capability,
        False,
        cause=cause,
        message="{0}: {1}".format(type(exc).__name__, exc),
    )


# -----------------------------------------------------------------------------
# histdata -- AC24: bounded offline public parse-to-Parquet boundary
# -----------------------------------------------------------------------------
# The fixture is owned by this verifier and deliberately tiny. The downloader
# module is never imported. TemporaryDirectory provides cleanup on success and
# every exception path, so verification cannot leave market-data output behind.
HISTDATA_FIXTURE = """20240101 000000;1.10000;1.10100;1.09900;1.10050;10\n20240101 000100;1.10050;1.10200;1.10000;1.10150;12\n"""
try:
    import pyarrow.parquet as pq
    from histdata_supplementary.parser import parse_ascii_m1
    from histdata_supplementary.converter import write_parquet

    version = read_version("histdata")
    rows = parse_ascii_m1(HISTDATA_FIXTURE)
    if len(rows) != 2:
        record("histdata", False, cause="probe", version=version,
               message="Bounded parser returned {0} rows, expected 2.".format(len(rows)))
    else:
        with tempfile.TemporaryDirectory(prefix="stratcraft-histdata-probe-") as temp_dir:
            output_path = Path(temp_dir) / "fixture.parquet"
            returned_path = write_parquet(rows, output_path)
            table = pq.read_table(returned_path)
            expected_columns = ["timestamp", "open", "high", "low", "close", "volume"]
            timestamp_type = str(table.schema.field("timestamp").type)
            if table.column_names != expected_columns or timestamp_type != "timestamp[ms]":
                record("histdata", False, cause="probe", version=version,
                       message="Parquet schema was columns={0}, timestamp={1}; expected canonical OHLCV and timestamp[ms].".format(
                           table.column_names, timestamp_type))
            elif table.num_rows != 2:
                record("histdata", False, cause="probe", version=version,
                       message="Parquet output contained {0} rows, expected 2.".format(table.num_rows))
            else:
                record("histdata", True, version=version,
                       verification="Offline fixture parsed and converted to two canonical OHLCV rows with timestamp[ms]; temporary output removed.")
except ImportError as exc:
    fail_from_exception("histdata", "import", exc)
except Exception as exc:
    fail_from_exception("histdata", "probe", exc)


# -----------------------------------------------------------------------------
# duckdb -- D5 steps 1, 2, and the shared-stack attribution point for pyarrow
# -----------------------------------------------------------------------------
# duckdb probes first and carries the pyarrow/numpy import. The zero-copy parquet
# reads the research stack depends on go through this pairing, so an ABI mismatch
# here is attributed to duckdb rather than to an invented shared capability.
try:
    import numpy
    import pyarrow
    import duckdb

    version = read_version("duckdb")
    value = duckdb.connect(":memory:").execute("select 40 + 2").fetchone()[0]
    if value != 42:
        record("duckdb", False, cause="probe",
               message="In-memory query returned {0!r}, expected 42.".format(value))
    else:
        record("duckdb", True, version=version,
               verification="In-memory query returned 42; numpy {0} and pyarrow {1} imported.".format(
                   numpy.__version__, pyarrow.__version__))
except ImportError as exc:
    fail_from_exception("duckdb", "import", exc)
except Exception as exc:
    fail_from_exception("duckdb", "probe", exc)


# -----------------------------------------------------------------------------
# gplearn -- D5 steps 1, 3, and shared-stack attribution for scikit-learn/scipy
# -----------------------------------------------------------------------------
try:
    import scipy
    import sklearn
    import numpy as np
    from gplearn.genetic import SymbolicRegressor

    version = read_version("gplearn")
    # Deterministic by construction: fixed seed, a tiny population, and a target
    # that is exactly representable by the default function set. A probe that
    # could fail stochastically would make readiness a coin flip.
    rng = np.random.RandomState(0)
    X = rng.uniform(-1.0, 1.0, size=(60, 2))
    y = X[:, 0] + X[:, 1]
    model = SymbolicRegressor(
        population_size=60, generations=4, random_state=0,
        function_set=("add", "sub", "mul"), verbose=0,
    )
    model.fit(X, y)
    predicted = model.predict(X)
    correlation = float(np.corrcoef(predicted, y)[0, 1])
    if not np.isfinite(correlation) or correlation < 0.90:
        record("gplearn", False, cause="probe",
               message="Deterministic fit/predict correlation was {0:.4f}; expected >= 0.90.".format(correlation))
    else:
        record("gplearn", True, version=version,
               verification="Deterministic fit/predict correlation {0:.4f}; scikit-learn {1}, scipy {2}.".format(
                   correlation, sklearn.__version__, scipy.__version__))
except ImportError as exc:
    fail_from_exception("gplearn", "import", exc)
except Exception as exc:
    fail_from_exception("gplearn", "probe", exc)


# -----------------------------------------------------------------------------
# gpquant -- D5 steps 1 and 4
# -----------------------------------------------------------------------------
try:
    from gpquant.SymbolicRegressor import SymbolicRegressor as GpqRegressor

    version = read_version("gpquant")
    # Construction only. D5 asks for "the smallest supported deterministic
    # program"; gpquant's fit path expects framework-shaped financial series, and
    # synthesizing one here would be a research workload, which D5 forbids
    # during verification. Construction proves the class and its compiled
    # dependencies resolve.
    #
    # Every argument below is required: gpquant's __init__ declares 16 positional
    # parameters with no defaults, so there is no "minimal" call. The values
    # mirror scripts/factor_mining/engines/gpquant_engine.py -- the repository's
    # real caller -- reduced to a trivial population, rather than invented here
    # (TICKET_854). A probe built on guessed kwargs would report a healthy
    # gpquant as broken, which is what an earlier draft of this program did.
    GpqRegressor(
        population_size=10,
        tournament_size=2,
        generations=2,
        stopping_criteria=0.99,
        p_crossover=0.7,
        p_subtree_mutate=0.1,
        p_hoist_mutate=0.05,
        p_point_mutate=0.1,
        init_depth=(2, 4),
        init_method="half and half",
        function_set=["add", "sub", "mul"],
        variable_set=["x0"],
        const_range=(-1, 1),
        ts_const_range=(5, 60),
        build_preference=[0.7, 0.8],
        metric="mean absolute error",
    )
    record("gpquant", True, version=version,
           verification="Imported and constructed SymbolicRegressor with the repository's argument shape.")
except ImportError as exc:
    fail_from_exception("gpquant", "import", exc)
except Exception as exc:
    fail_from_exception("gpquant", "probe", exc)


# -----------------------------------------------------------------------------
# factor-mining production entry -- TICKET_1382_3 AC3/AC4
# -----------------------------------------------------------------------------
# Mirror scripts/run-factor-mining.py exactly: the executable adds the scripts
# directory to sys.path, then imports factor_mining.cli. The repository root is
# intentionally not added, so nona_algorithm and every package it owns must be
# provided by the locked environment rather than ambient source paths.
try:
    scripts_dir = Path.cwd() / "scripts"
    sys.path.insert(0, str(scripts_dir))
    from factor_mining.cli import build_parser
    from factor_mining.engines.gpquant_engine import GpquantEngine

    parser = build_parser()
    adapter = GpquantEngine(generations=2, population=10, runs=1, hall_of_fame=1)
    if parser.prog == "" or adapter.name != "gpquant":
        production_entry = {
            "ok": False,
            "cause": "probe",
            "stage": "production_entry",
            "message": "The factor-mining parser or GPQuant adapter returned an invalid identity.",
        }
    else:
        production_entry = {
            "ok": True,
            "stage": "production_entry",
            "verification": "Imported factor_mining.cli, constructed its parser, resolved nona_algorithm governance, and validated GpquantEngine without launching work.",
        }
except ImportError as exc:
    production_entry = {
        "ok": False,
        "cause": "import",
        "stage": "production_entry",
        "message": "{0}: {1}".format(type(exc).__name__, exc)[:1800],
    }
except Exception as exc:
    production_entry = {
        "ok": False,
        "cause": "probe",
        "stage": "production_entry",
        "message": "{0}: {1}".format(type(exc).__name__, exc)[:1800],
    }


# -----------------------------------------------------------------------------
# pysr -- D5 steps 1 and 5. Two runtime layers, reported separately.
# -----------------------------------------------------------------------------
# The Python wheel importing proves nothing about the Julia backend: on a cold
# depot, first import drives juliapkg to download Julia and precompile
# SymbolicRegression + PythonCall (1.4 GB, per the ticket's D0 record). AC8
# requires the two stages to be distinguishable, so the failure carries
# stage="julia_verify" with cause="backend_init" when the backend is what broke.
try:
    import pysr

    version = read_version("pysr")
    from pysr import PySRRegressor
    import numpy as np

    rng = np.random.RandomState(0)
    X = rng.uniform(-1.0, 1.0, size=(40, 2))
    y = X[:, 0] + X[:, 1]
    # Constructed OUTSIDE the backend-init try block on purpose. PySR validates
    # its hyperparameters in Python before touching Julia, so a bad argument
    # raises here; if construction sat inside that block, a probe-authoring
    # mistake would be reported as cause="backend_init" and blame Julia for a
    # Python-side error. An earlier draft of this program did exactly that --
    # 'tournament_selection_n' defaults to 15 and silently exceeded a
    # population_size of 12, producing a false "Julia backend failed".
    #
    # population_size must therefore stay above tournament_selection_n.
    model = PySRRegressor(
        niterations=2, populations=2, population_size=20,
        tournament_selection_n=8,
        binary_operators=["+"], unary_operators=[], progress=False,
        verbosity=0, temp_equation_file=True, deterministic=True,
        parallelism="serial", random_state=0,
    )
    try:
        # 'fit' is what forces backend initialization: juliapkg resolves and
        # precompiles SymbolicRegression + PythonCall on first use, so this call
        # -- not the import -- is the real Julia gate.
        model.fit(X, y)
        predicted = model.predict(X)
        correlation = float(np.corrcoef(predicted, y)[0, 1])
        if not np.isfinite(correlation):
            record("pysr", False, cause="probe", version=version,
                   message="Bounded regression produced a non-finite correlation.",
                   extra={"backend_ok": True})
        else:
            record("pysr", True, version=version,
                   verification="Julia backend initialized; bounded regression correlation {0:.4f}.".format(correlation),
                   extra={"backend_ok": True})
    except Exception as exc:
        # Python package present, backend not ready. This is the distinction
        # AC8 exists for.
        record("pysr", False, cause="backend_init", version=version,
               message="Julia backend initialization failed: {0}: {1}".format(type(exc).__name__, exc),
               extra={"backend_ok": False})
except ImportError as exc:
    fail_from_exception("pysr", "import", exc)
except Exception as exc:
    fail_from_exception("pysr", "probe", exc)


# -----------------------------------------------------------------------------
# pandas_ta -- D5 steps 1 and 6
# -----------------------------------------------------------------------------
# The accessor call is the load-bearing part. D0 records that a bare
# 'import pandas_ta' would pass without proving the pandas accessor registered,
# and this is the only check validating the solver-forced pandas 2.3.3 bump
# against the API talib_engine.py actually calls ('df.ta.<indicator>').
try:
    import pandas as pd
    import numpy as np
    import pandas_ta

    version = read_version("pandas_ta")
    frame = pd.DataFrame({"close": np.linspace(100.0, 140.0, 140)})
    if not hasattr(frame, "ta"):
        record("pandas_ta", False, cause="probe", version=version,
               message="pandas_ta imported but did not register the '.ta' DataFrame accessor "
                       "against pandas {0}.".format(pd.__version__))
    else:
        rsi = frame.ta.rsi(length=14)
        finite = int(np.isfinite(np.asarray(rsi, dtype="float64")).sum())
        if finite <= 0:
            record("pandas_ta", False, cause="probe", version=version,
                   message="Accessor '.ta.rsi(14)' produced no finite values.")
        else:
            record("pandas_ta", True, version=version,
                   verification="Accessor '.ta.rsi(14)' returned {0} finite values against pandas {1}.".format(
                       finite, pd.__version__))
except ImportError as exc:
    fail_from_exception("pandas_ta", "import", exc)
except Exception as exc:
    fail_from_exception("pandas_ta", "probe", exc)


payload = {
    "interpreter": sys.executable,
    "pythonVersion": "{0}.{1}.{2}".format(*sys.version_info[:3]),
    "productionEntry": production_entry,
    "capabilities": results,
}
sys.stdout.write("\n" + BEGIN + "\n" + json.dumps(payload) + "\n" + END + "\n")
sys.stdout.flush()
`;
