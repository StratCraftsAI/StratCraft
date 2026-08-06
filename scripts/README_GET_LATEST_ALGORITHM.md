# Get Latest Algorithm Script


`get_latest_algorithm.py` ????? `nona_algorithms` ?????????????, ?????????.

?????? Docker Nona Server 06 ?? `/app/backend_server/scripts/get_latest_prompt_template.py` ??.


- [OK] ?????????ID???
- [OK] ?????JSON??(classification_metadata, strategy_rules)
- [OK] ?????Python??



```bash
python3 scripts/get_latest_algorithm.py
```

```
================================================================================
 Algorithm Data Saved
================================================================================
| Field                     | Value                                              |
|---------------------------|----------------------------------------------------|
| Algorithm ID              | 1                                                  |
| Strategy Name             | New Strategy                                       |
| Strategy Type             | 9                                                  |
| Class Name                | NewStrategy                                        |
| Signal Source             | indicator_detector_trend                           |
| Code Length               | 4394                                               |
| User ID                   | default                                            |
| Status                    | 1                                                  |
| Created At                | 2026-01-14 05:45:00                                |
| Saved To                  | latest_algorithm_1_20260114_055234.txt             |
================================================================================
```

### 2. ????ID???

```bash
python3 scripts/get_latest_algorithm.py --id 1
python3 scripts/get_latest_algorithm.py -i 1
```


```bash
# ???Python??
python3 scripts/get_latest_algorithm.py --field code

python3 scripts/get_latest_algorithm.py --field classification_metadata

python3 scripts/get_latest_algorithm.py --field strategy_rules

python3 scripts/get_latest_algorithm.py --field description
```


```bash
# ??ID?1???, ???code??
python3 scripts/get_latest_algorithm.py --id 1 --field code

# ??ID?5???, ???metadata
python3 scripts/get_latest_algorithm.py -i 5 -f classification_metadata
```


```bash
python3 scripts/get_latest_algorithm.py --help
```



```
<repo-root>/logs/records/latest_algorithm_{id}_{timestamp}.txt
```


```
================================================================================
Algorithm ID: 1
Strategy Name: New Strategy
Strategy Type: 9
User ID: default
Status: 1
File Path: generated/New Strategy.py
Created At: 2026-01-14 05:45:00
Updated At: 2026-01-14 05:45:00
Export Time: 2026-01-14T05:52:34.783162
================================================================================

DESCRIPTION:
================================================================================
trend regime detection strategy

CLASSIFICATION METADATA:
================================================================================
{
  "class_name": "NewStrategy",
  "signal_source": "indicator_detector_trend",
  "strategy_role": "market_regime",
  "trading_style": "neutral",
  "strategy_composition": "atomic",
  "components": {
    "indicator": {
      "regime_type": "trend",
      "llm_provider": "DEEPSEEK",
      "llm_model": "deepseek-chat"
    }
  },
  "tags": [
    "indicator",
    "regime",
    "market-analysis"
  ],
  "created_at": "2026-01-14T05:45:00.366Z"
}

STRATEGY RULES:
================================================================================
{
  "regime_type": "trend",
  "entry_conditions": [],
  "exit_conditions": [],
  "indicators": [...],
  "rules": [],
  "factors": []
}

PYTHON CODE:
================================================================================

import backtrader as bt
from typing import List
from src.strategies.base.market_state_base import MarketStateBase, MarketState

class NewStrategy(MarketStateBase):
    # ... ??Python?? ...

================================================================================
END OF PYTHON CODE
================================================================================
```


?? `--field` ???, ???????:

```
================================================================================
Algorithm ID: 1
Strategy Name: New Strategy
...
================================================================================

FIELD: CODE
================================================================================

import backtrader as bt
...

================================================================================
END OF CODE
================================================================================
```


|---------------------------|---------|------------------------------------------|
| `id`                      | INTEGER | ??ID(??)                            |
| `code`                    | TEXT    | LLM?????Python??                   |
| `strategy_name`           | TEXT    | ????                                  |
| `strategy_type`           | INTEGER | ????(9=Regime Detector)             |
| `classification_metadata` | TEXT    | ?????(JSON??, WordPress??)      |
| `strategy_rules`          | TEXT    | ????(JSON??, WordPress??)        |
| `description`             | TEXT    | ????                                  |
| `user_id`                 | TEXT    | ??ID                                    |
| `file_path`               | TEXT    | ??????                              |
| `status`                  | INTEGER | ??(0=??, 1=??)                     |
| `create_time`             | TEXT    | ????                                  |
| `update_time`             | TEXT    | ????                                  |



1. **STRATEGY_GENERATION_RESPONSE_FORMAT_STANDARD**
   - `code` ???????Python??(?????)
   - JSON???????

2. **REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL (WordPress??)**
   - `classification_metadata` ??????:
     - `class_name`, `signal_source`, `strategy_role`, `trading_style`
     - `strategy_composition`, `components`, `tags`, `created_at`
   - `strategy_rules` ??????:
     - `regime_type`, `entry_conditions`, `exit_conditions`
     - `indicators`, `rules`, `factors`


```bash
python3 scripts/get_latest_algorithm.py
```

### ??2:??Python??
```bash
# ???Python??????
python3 scripts/get_latest_algorithm.py --field code
```

```bash
# ??classification_metadata????WordPress??
python3 scripts/get_latest_algorithm.py --field classification_metadata
```

```bash
python3 scripts/get_latest_algorithm.py --id 1 > v1.txt
python3 scripts/get_latest_algorithm.py --id 2 > v2.txt
diff v1.txt v2.txt
```


```
Error: Database not found at: <repo-root>/apps/desktop/data/StratCraft.db

Make sure the application has been run at least once to create the database.
```


```
No records found in nona_algorithms table.
```


### ??ID???
```
No records found in nona_algorithms table.
```



```
docker exec nona_server_06 cat /app/backend_server/scripts/get_latest_prompt_template.py
```

- ???:MySQL -> SQLite
- ???:`created_at` -> `create_time`, `updated_at` -> `update_time`
- ????:`prompt_template` -> `code`, `classification_metadata`, `strategy_rules`
- ????:?? `pathlib.Path` ????


- **????**:`scripts/get_latest_algorithm.py`
- **????**:`logs/records/`
- **?????**:`apps/desktop/data/StratCraft.db`
  - `docs/design/_COMPONENT7_SAVE_MISSING.md`
  - `docs/design/REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md`
