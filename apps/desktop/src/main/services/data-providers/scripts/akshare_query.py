"""
AKShare China A-Share OHLCV Query Script

TICKET_904_1: Standalone Python script for AKShare data fetching.
Called via child_process.execFile from AKShareProvider.

Input: command-line args (command, symbol, interval, start_date, end_date)
Output: JSON to stdout

Commands:
  query     <symbol> <interval> <start_date> <end_date>  -> OHLCVRow[] JSON
  search    <query> [limit]                              -> ProviderSymbolInfo[] JSON
  daterange <symbol>                                     -> { startTime, endTime } JSON
  check                                                  -> { "connected": true/false }

Symbol format: bare 6-digit code (000001, 600000).
TS layer strips .SH/.SZ suffix before calling this script.

Data sources (Sina-backed, overseas-compatible):
  Daily:    ak.stock_zh_a_daily    (symbol='sh600000'/'sz000001')
  Intraday: ak.stock_zh_a_minute   (symbol='sh600000'/'sz000001', period='1'/'5'/'15'/'30'/'60')
  Weekly/Monthly: ak.stock_zh_a_hist (East Money, may be geo-blocked)
"""

import sys
import json


def _to_sina_symbol(bare_code: str) -> str:
    """Convert bare 6-digit code to Sina prefix format: 6xxxxx -> sh, 0/3xxxxx -> sz."""
    if bare_code.startswith('6'):
        return 'sh' + bare_code
    return 'sz' + bare_code


def query_ohlcv(symbol: str, interval: str, start_date: str, end_date: str):
    """Download OHLCV data and output as JSON array."""
    import akshare as ak
    from datetime import datetime

    is_intraday = interval in ('1', '5', '15', '30', '60')
    is_daily = interval == 'daily'
    sina_symbol = _to_sina_symbol(symbol)

    if is_intraday:
        df = ak.stock_zh_a_minute(
            symbol=sina_symbol,
            period=interval,
            adjust="",
        )
        if df is not None and not df.empty:
            fmt_start = start_date.replace('-', '')
            fmt_end = end_date.replace('-', '')
            df['_date_str'] = df['day'].astype(str).str.replace('-', '').str[:8]
            df = df[(df['_date_str'] >= fmt_start) & (df['_date_str'] <= fmt_end)]

    elif is_daily:
        df = ak.stock_zh_a_daily(
            symbol=sina_symbol,
            start_date=start_date.replace('-', ''),
            end_date=end_date.replace('-', ''),
            adjust="",
        )

    else:
        df = ak.stock_zh_a_hist(
            symbol=symbol,
            period=interval,
            start_date=start_date.replace('-', ''),
            end_date=end_date.replace('-', ''),
            adjust="",
        )

    if df is None or df.empty:
        print(json.dumps([]))
        return

    if is_intraday:
        date_col = 'day'
        date_fmt = '%Y-%m-%d %H:%M:%S'
    elif is_daily:
        date_col = 'date'
        date_fmt = '%Y-%m-%d'
    else:
        date_col = "\u65e5\u671f"
        date_fmt = '%Y-%m-%d'

    if is_daily:
        open_col, high_col, low_col, close_col, vol_col = 'open', 'high', 'low', 'close', 'volume'
    elif is_intraday:
        open_col, high_col, low_col, close_col, vol_col = 'open', 'high', 'low', 'close', 'volume'
    else:
        open_col = "\u5f00\u76d8"
        high_col = "\u6700\u9ad8"
        low_col = "\u6700\u4f4e"
        close_col = "\u6536\u76d8"
        vol_col = "\u6210\u4ea4\u91cf"

    rows = []
    for _, row in df.iterrows():
        dt = datetime.strptime(str(row[date_col]), date_fmt)
        rows.append({
            "timestamp": int(dt.timestamp()),
            "open": float(row[open_col]),
            "high": float(row[high_col]),
            "low": float(row[low_col]),
            "close": float(row[close_col]),
            "volume": float(row[vol_col]),
        })

    rows.sort(key=lambda r: r["timestamp"])
    print(json.dumps(rows))


def search_symbols(query: str, limit: int):
    """Search for A-share symbols by code prefix or name substring."""
    import akshare as ak

    try:
        df = ak.stock_zh_a_spot_em()
    except Exception:
        df = ak.stock_zh_a_spot()

    if df is None or df.empty:
        print(json.dumps([]))
        return

    cols = df.columns.tolist()
    code_key = "\u4ee3\u7801"
    name_key = "\u540d\u79f0"
    code_col = code_key if code_key in cols else cols[0]
    name_col = name_key if name_key in cols else cols[1]

    query_lower = query.lower()
    symbols = []

    for _, row in df.iterrows():
        raw_code = str(row[code_col])
        name = str(row[name_col])

        # Sina spot returns prefixed codes (sh600000, sz000001, bj920000);
        # East Money spot returns bare codes (600000). Strip prefix to normalize.
        if raw_code[:2] in ('sh', 'sz', 'bj'):
            bare_code = raw_code[2:]
        else:
            bare_code = raw_code

        if not (bare_code.startswith(query_lower) or query_lower in name.lower()):
            continue

        if bare_code.startswith('6'):
            display_symbol = bare_code + ".SH"
            exchange = "SSE"
        elif bare_code.startswith('0') or bare_code.startswith('3'):
            display_symbol = bare_code + ".SZ"
            exchange = "SZSE"
        else:
            display_symbol = bare_code + ".SZ"
            exchange = "SZSE"

        symbols.append({
            "symbol": display_symbol,
            "name": name,
            "type": "stock",
            "exchange": exchange,
        })

        if len(symbols) >= limit:
            break

    print(json.dumps(symbols))


def get_date_range(symbol: str):
    """Get data availability date range for a symbol."""
    import akshare as ak

    sina_symbol = _to_sina_symbol(symbol)
    df = ak.stock_zh_a_daily(
        symbol=sina_symbol,
        start_date="19900101",
        end_date="21001231",
        adjust="",
    )

    if df is None or df.empty:
        print(json.dumps({"startTime": None, "endTime": None}))
        return

    first_date = str(df.iloc[0]['date'])
    last_date = str(df.iloc[-1]['date'])

    print(json.dumps({
        "startTime": first_date,
        "endTime": last_date,
    }))


def check_connection():
    """Verify python3 + akshare is importable and API responds."""
    try:
        import akshare as ak
        from datetime import date, timedelta

        today = date.today()
        probe_end = today.strftime('%Y%m%d')
        probe_start = (today - timedelta(days=10)).strftime('%Y%m%d')

        df = ak.stock_zh_a_daily(
            symbol='sh000001',
            start_date=probe_start,
            end_date=probe_end,
            adjust='',
        )
        connected = df is not None and not df.empty
        print(json.dumps({"connected": connected}))
    except Exception as e:
        print(json.dumps({"connected": False, "error": str(e)}))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified. Usage: query|search|daterange|check"}))
        sys.exit(1)

    command = sys.argv[1]

    try:
        if command == "query":
            if len(sys.argv) != 6:
                print(json.dumps({"error": "Usage: query <symbol> <interval> <start_date> <end_date>"}))
                sys.exit(1)
            query_ohlcv(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])

        elif command == "search":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Usage: search <query> [limit]"}))
                sys.exit(1)
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 20
            search_symbols(sys.argv[2], limit)

        elif command == "daterange":
            if len(sys.argv) != 3:
                print(json.dumps({"error": "Usage: daterange <symbol>"}))
                sys.exit(1)
            get_date_range(sys.argv[2])

        elif command == "check":
            check_connection()

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
