# Executor Artifact Schemas

This directory hosts JSON Schema files shared between Python artifact writers
(under `packages/nona-algorithm/`) and the C++ artifact loader (under
`packages/research-kernels/src/signal/`). Each schema is the single source of truth
for the on-disk format of a v2 signal-source artifact and is consumed in two
places: Python `jsonschema.validate()` at fit time, and C++
`nlohmann::json-schema-validator` at load time.

| File | Producers | Consumers | Spec |
|---|---|---|---|
| `artifact_meta.schema.json` | All v2 signals via `SignalSourceBaseV2._write_meta()` and `signal_sources/ml/_onnx_export.save_onnx()` | Python `_onnx_meta.validate_meta()`; C++ `OnnxArtifactLoader::load()` |  Q3,  Q2,  Decision 5 |
| `evaluation_envelope.schema.json` | C++ evaluation owners | Electron Main and retained Python research/training adapters |  |
| `evaluation_arrow_schema_v1.json` | C++ Arrow/Parquet evaluation data plane | C++, Electron Main, and retained Python bounded readers |  |
| `market_data_arrow_schema_v1.json` | Bounded market-data providers and C++ data plane | C++ evaluation owners and retained training adapters |  |

Adding a new schema: place the file here, document it in the table above,
and import it from both the Python and C++ sides. Do not fork per-language
copies -- the whole point of this directory is one schema, two languages.
