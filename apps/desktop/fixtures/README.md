# Test Data Fixtures

Test data and seed scripts for development and testing.

## Files

```
fixtures/
+-- README.md                      # This file
+-- backtest-test-case.json        # Test cases from test/3.txt
+-- backtest-test-case.schema.json # JSON schema (optional)

scripts/
+-- seed-test-data.ts              # TypeScript seed script
+-- seed-test-algorithms.sql       # SQL seed script
```

## Quick Start

### Method 1: TypeScript Seed Script (Recommended)

```bash
# Seed test data (preserves existing data)
npm run seed:test

# Clean existing test data and reseed
npm run seed:test:clean
```

### Method 2: Direct SQL Seeding

```bash
# Execute SQL script directly
npm run seed:sql

# Or manually
sqlite3 apps/desktop/data/StratCraft.db < scripts/seed-test-algorithms.sql
```

## What Gets Seeded?

The seed scripts populate the `nona_algorithms` table with test algorithms from `test/3.txt`:

| Type | strategy_type | Count | Examples |
|------|--------------|-------|----------|
| **Analysis** (Trend-Range) | 9 | 2 | FreqMarketState002, FreqMarketState005 |
| **Precondition** | 4 | 6 | SignalTriggerEMA001-004, MyStrategy5778 |
| **Entry Step** | 0 | 12 | EnsembleVotingStrategy017, FreqExecute002 |
| **Exit** (Postcondition) | 6 | 2 | FreqExit001Simple, FreqExit005Simple |
| **Advisor** | 8 | 1 | LLMAdaptiveAdvisor001 |

**Total**: ~23 test algorithms

All seeded algorithms have `user_id = 'default'` for easy identification and cleanup.

## Active Test Case

The current active test case (from test/3.txt line 29-34):

```json
{
  "id": "test-case-4",
  "workflow": {
    "analysis": "FreqMarketState005",
    "precondition": "",
    "execution": "EnsembleVotingStrategy017",
    "postcondition": "FreqExit005Simple"
  }
}
```

## Backtest Configuration

From `backtest-test-case.json`:

```json
{
  "symbol": "AAPL",
  "start_time": "2018-11-01 00:00:00",
  "end_time": "2021-01-01 00:00:00",
  "timeframe": "1D",
  "initial_capital": 100005,
  "order_size_value": 8000,
  "order_size_unit": "cash"
}
```

## Usage in Development

### 1. Seed Test Data

```bash
npm run seed:test:clean
```

### 2. Start the App

```bash
npm run dev
```

### 3. Navigate to Backtest Page

Open the Backtest Nexus plugin and verify:

- **Page 1 (Select Algorithm)**: Should show `FreqMarketState005`
- **Page 2 (Pre-condition)**: Should show precondition algorithms
- **Page 3 (Select Steps)**: Should show `EnsembleVotingStrategy017`
- **Page 4 (Post-condition)**: Should show `FreqExit005Simple`

### 4. Execute Backtest

Select the algorithms and click "Execute" to run the test workflow.

## Cleaning Up Test Data

```bash
# Delete all test algorithms
sqlite3 data/StratCraft.db "DELETE FROM nona_algorithms WHERE user_id = 'default'"

# Or use clean seed
npm run seed:test:clean
```

## Customizing Test Data

### Edit Fixture File

Modify `fixtures/backtest-test-case.json` to add/remove test cases:

```json
{
  "testCases": [
    {
      "id": "my-test-case",
      "description": "My custom test",
      "active": true,
      "workflow": {
        "analysis": "MyAnalysis",
        "precondition": "MyPrecondition",
        "execution": "MyExecution",
        "postcondition": "MyExit"
      }
    }
  ]
}
```

### Re-run Seed Script

```bash
npm run seed:test:clean
```

## Troubleshooting

### No algorithms showing in UI

1. Check database:
   ```bash
   sqlite3 data/StratCraft.db "SELECT COUNT(*) FROM nona_algorithms WHERE user_id = 'default'"
   ```

2. Check user_id filter in UI:
   - Frontend queries use `userId: 'default'`
   - Change seed script to use `'default'` instead of `'default'`

3. Restart the app

### Seed script fails

1. Ensure database exists:
   ```bash
   ls -la apps/desktop/data/StratCraft.db
   ```

2. Run the app first to create database:
   ```bash
   npm run dev
   ```

3. Re-run seed script

## Related Files

- Source test config: `test/3.txt` (PHP format, repo-root relative)
- Fixture (JSON): `apps/desktop/fixtures/backtest-test-case.json`
- TypeScript seed: `apps/desktop/scripts/seed-test-data.ts`
- SQL seed: `apps/desktop/scripts/seed-test-algorithms.sql`

## Notes

- Test data uses `user_id = 'default'` by default
- Frontend queries use `userId: 'default'`
- For UI testing, consider changing seed script to use `'default'`
- All seeded algorithms have `status = 1` (active) and `activate = 1` (enabled)
