"""
Tushare Pro China A-Share OHLCV Query Script

TICKET_904_2: Standalone Python script for Tushare Pro data fetching.
Called via child_process.execFile from TushareProvider.

Input: command-line args (command, ...args, --token TOKEN)
Output: JSON to stdout

Commands:
  query     <symbol> <interval> <start_date> <end_date> --token <TOKEN>  -> OHLCVRow[] JSON
  search    <query> [limit] --token <TOKEN>                              -> ProviderSymbolInfo[] JSON
  daterange <symbol> --token <TOKEN>                                     -> { startTime, endTime } JSON
  check     --token <TOKEN>                                              -> { "connected": true/false }

Symbol format: Tushare Pro notation (000001.SZ, 600000.SH).
Matches user-facing format -- no conversion needed.

Token: Tushare Pro API token passed via --token flag.
"""

import sys
import json


def _extract_token(args: list[str]) -> str:
    """Extract --token value from argument list."""
    for i, arg in enumerate(args):
        if arg == '--token' and i + 1 < len(args):
            return args[i + 1]
    return ''


def _get_pro_api(token: str):
    """Initialize Tushare Pro API with token."""
    import tushare as ts
    return ts.pro_api(token)


def query_ohlcv(symbol: str, interval: str, start_date: str, end_date: str, token: str):
    """Download OHLCV data and output as JSON array."""
    from datetime import datetime

    if not token:
        print(json.dumps({"error": "Tushare Pro token not configured"}))
        sys.exit(1)

    pro = _get_pro_api(token)

    fmt_start = start_date.replace('-', '')
    fmt_end = end_date.replace('-', '')

    if interval == 'daily':
        df = pro.daily(ts_code=symbol, start_date=fmt_start, end_date=fmt_end)
    elif interval == 'weekly':
        df = pro.weekly(ts_code=symbol, start_date=fmt_start, end_date=fmt_end)
    elif interval == 'monthly':
        df = pro.monthly(ts_code=symbol, start_date=fmt_start, end_date=fmt_end)
    else:
        print(json.dumps({"error": f"Unsupported interval: {interval}"}))
        sys.exit(1)

    if df is None or df.empty:
        print(json.dumps([]))
        return

    rows = []
    for _, row in df.iterrows():
        dt = datetime.strptime(str(row['trade_date']), '%Y%m%d')
        ts_val = int(dt.timestamp())

        vol = float(row['vol']) if row['vol'] is not None else 0.0

        rows.append({
            "timestamp": ts_val,
            "open": float(row['open']),
            "high": float(row['high']),
            "low": float(row['low']),
            "close": float(row['close']),
            "volume": vol,
        })

    rows.sort(key=lambda r: r["timestamp"])
    print(json.dumps(rows))


def search_symbols(query: str, limit: int, token: str):
    """Search for A-share symbols by code prefix or name substring."""
    if not token:
        print(json.dumps({"error": "Tushare Pro token not configured"}))
        sys.exit(1)

    pro = _get_pro_api(token)

    df = pro.stock_basic(exchange='', list_status='L',
                         fields='ts_code,symbol,name,exchange')
    if df is None or df.empty:
        print(json.dumps([]))
        return

    query_lower = query.lower()
    symbols = []

    for _, row in df.iterrows():
        ts_code = str(row['ts_code'])
        bare_code = str(row['symbol'])
        name = str(row['name'])
        exchange_raw = str(row['exchange'])

        if not (bare_code.startswith(query_lower)
                or ts_code.lower().startswith(query_lower)
                or query_lower in name.lower()):
            continue

        if exchange_raw == 'SSE':
            exchange = 'SSE'
        elif exchange_raw == 'SZSE':
            exchange = 'SZSE'
        else:
            exchange = exchange_raw

        symbols.append({
            "symbol": ts_code,
            "name": name,
            "type": "stock",
            "exchange": exchange,
        })

        if len(symbols) >= limit:
            break

    print(json.dumps(symbols))


def get_date_range(symbol: str, token: str):
    """Get data availability date range for a symbol."""
    from datetime import datetime

    if not token:
        print(json.dumps({"error": "Tushare Pro token not configured"}))
        sys.exit(1)

    pro = _get_pro_api(token)

    df = pro.daily(ts_code=symbol, start_date='19900101')

    if df is None or df.empty:
        print(json.dumps({"startTime": None, "endTime": None}))
        return

    dates = sorted(df['trade_date'].tolist())
    first = datetime.strptime(str(dates[0]), '%Y%m%d').strftime('%Y-%m-%d')
    last = datetime.strptime(str(dates[-1]), '%Y%m%d').strftime('%Y-%m-%d')

    print(json.dumps({
        "startTime": first,
        "endTime": last,
    }))


def check_connection(token: str):
    """Verify python3 + tushare is importable and API token is valid."""
    try:
        if not token:
            print(json.dumps({
                "connected": False,
                "reason": "not-configured",
                "error": "Tushare Pro API token not configured",
            }))
            return

        pro = _get_pro_api(token)
        df = pro.trade_cal(exchange='SSE', is_open='1',
                           start_date='20250101', end_date='20250110')
        connected = df is not None and not df.empty
        print(json.dumps({"connected": connected}))
    except Exception as e:
        error_str = str(e)
        if 'token' in error_str.lower() or 'auth' in error_str.lower():
            print(json.dumps({
                "connected": False,
                "reason": "auth-failed",
                "error": error_str,
            }))
        else:
            print(json.dumps({"connected": False, "error": error_str}))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified. Usage: query|search|daterange|check"}))
        sys.exit(1)

    command = sys.argv[1]
    token = _extract_token(sys.argv)

    try:
        if command == "query":
            if len(sys.argv) < 6:
                print(json.dumps({"error": "Usage: query <symbol> <interval> <start_date> <end_date> --token <TOKEN>"}))
                sys.exit(1)
            query_ohlcv(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], token)

        elif command == "search":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Usage: search <query> [limit] --token <TOKEN>"}))
                sys.exit(1)
            limit_str = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith('--') else '20'
            search_symbols(sys.argv[2], int(limit_str), token)

        elif command == "daterange":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Usage: daterange <symbol> --token <TOKEN>"}))
                sys.exit(1)
            get_date_range(sys.argv[2], token)

        elif command == "check":
            check_connection(token)

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
