"""
BaoStock China A-Share OHLCV Query Script

TICKET_337: Standalone Python script for BaoStock data fetching.
Called via child_process.execFile from BaoStockProvider.

Input: command-line args (command, symbol, interval, start_date, end_date)
Output: JSON to stdout

Commands:
  query     <symbol> <interval> <start_date> <end_date>  -> OHLCVRow[] JSON
  search    <query> [limit]                              -> ProviderSymbolInfo[] JSON
  daterange <symbol>                                     -> { startTime, endTime } JSON
  check                                                  -> { "connected": true/false }

Symbol format: BaoStock notation (sh.600000, sz.000001).
TS layer handles conversion from user-facing 600000.SH / 000001.SZ.
"""

import sys
import json
import io
import contextlib


@contextlib.contextmanager
def _suppress_stdout():
    """Redirect stdout to devnull during baostock API calls.

    baostock prints 'login success!' / 'logout success!' to stdout,
    which contaminates our JSON output. This context manager suppresses
    those messages so only our JSON reaches the TS layer via stdout.
    """
    real_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        yield
    finally:
        sys.stdout = real_stdout


def query_ohlcv(symbol: str, interval: str, start_date: str, end_date: str):
    """Download OHLCV data and output as JSON array."""
    import baostock as bs
    from datetime import datetime

    with _suppress_stdout():
        lg = bs.login()
    if lg.error_code != '0':
        print(json.dumps({"error": f"BaoStock login failed: {lg.error_msg}"}))
        sys.exit(1)

    try:
        # Intraday intervals use time field; daily+ do not
        is_intraday = interval in ('5', '15', '30', '60')
        if is_intraday:
            fields = "date,time,open,high,low,close,volume,amount"
        else:
            fields = "date,open,high,low,close,volume,amount"

        rs = bs.query_history_k_data_plus(
            symbol,
            fields,
            start_date=start_date,
            end_date=end_date,
            frequency=interval,
            adjustflag='3',  # No adjustment (raw prices)
        )

        if rs.error_code != '0':
            print(json.dumps({"error": f"BaoStock query failed: {rs.error_msg}"}))
            sys.exit(1)

        rows = []
        while rs.next():
            row = rs.get_row_data()

            # Skip rows with empty price data
            if not row[2] or not row[3] or not row[4] or not row[5]:
                continue

            if is_intraday:
                # row: [date, time, open, high, low, close, volume, amount]
                # time format: YYYYMMDDHHMMSSmmm
                time_str = row[1]
                dt = datetime.strptime(time_str[:14], "%Y%m%d%H%M%S")
                ts = int(dt.timestamp())
                o, h, l, c = float(row[2]), float(row[3]), float(row[4]), float(row[5])
                vol = float(row[6]) if row[6] else 0.0
            else:
                # row: [date, open, high, low, close, volume, amount]
                dt = datetime.strptime(row[0], "%Y-%m-%d")
                ts = int(dt.timestamp())
                o, h, l, c = float(row[1]), float(row[2]), float(row[3]), float(row[4])
                vol = float(row[5]) if row[5] else 0.0

            rows.append({
                "timestamp": ts,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": vol,
            })

        # Ensure sorted by timestamp ASC
        rows.sort(key=lambda r: r["timestamp"])
        print(json.dumps(rows))
    finally:
        with _suppress_stdout():
            bs.logout()


def _find_recent_trading_day():
    """Find the most recent trading day (BaoStock returns 0 stocks on non-trading days)."""
    from datetime import date, timedelta
    today = date.today()
    # Try last 10 days to find a trading day
    for i in range(10):
        d = today - timedelta(days=i)
        if d.weekday() < 5:  # Skip weekends
            return d.strftime('%Y-%m-%d')
    return today.strftime('%Y-%m-%d')


def search_symbols(query: str, limit: int):
    """Search for symbols by code prefix or name substring.

    BaoStock query_stock_basic(code_name=) only supports exact name match,
    so we use query_all_stock() to get all tradeable stocks and filter locally.
    """
    import baostock as bs

    with _suppress_stdout():
        lg = bs.login()
    if lg.error_code != '0':
        print(json.dumps({"error": f"BaoStock login failed: {lg.error_msg}"}))
        sys.exit(1)

    try:
        trading_day = _find_recent_trading_day()
        rs = bs.query_all_stock(day=trading_day)

        if rs.error_code != '0':
            print(json.dumps({"error": f"BaoStock search failed: {rs.error_msg}"}))
            sys.exit(1)

        query_lower = query.lower()
        symbols = []
        while rs.next():
            row = rs.get_row_data()
            # row: [code, tradeStatus, code_name]
            code = row[0]       # e.g. "sh.600000"
            name = row[2]       # e.g. "SPDB" (Chinese stock name)
            numeric_code = code[3:] if '.' in code else code  # "600000"

            # Match: query is prefix of numeric code, exchange prefix, or substring of name
            if not (numeric_code.startswith(query_lower)
                    or code.startswith(query_lower)
                    or query_lower in name.lower()):
                continue

            if code.startswith("sh."):
                display_symbol = numeric_code + ".SH"
                exchange = "SSE"
            elif code.startswith("sz."):
                display_symbol = numeric_code + ".SZ"
                exchange = "SZSE"
            else:
                display_symbol = code
                exchange = ""

            symbols.append({
                "symbol": display_symbol,
                "name": name,
                "type": "stock",
                "exchange": exchange,
            })

            if len(symbols) >= limit:
                break

        print(json.dumps(symbols))
    finally:
        with _suppress_stdout():
            bs.logout()


def get_date_range(symbol: str):
    """Get data availability date range for a symbol."""
    import baostock as bs
    from datetime import datetime, timezone

    with _suppress_stdout():
        lg = bs.login()
    if lg.error_code != '0':
        print(json.dumps({"error": f"BaoStock login failed: {lg.error_msg}"}))
        sys.exit(1)

    try:
        # Probe earliest data: query from a very early date with daily frequency
        rs = bs.query_history_k_data_plus(
            symbol,
            "date,close",
            start_date='1990-01-01',
            end_date='2100-12-31',
            frequency='d',
            adjustflag='3',
        )

        if rs.error_code != '0':
            print(json.dumps({"error": f"BaoStock daterange failed: {rs.error_msg}"}))
            sys.exit(1)

        first_date = None
        last_date = None
        while rs.next():
            row = rs.get_row_data()
            date_str = row[0]
            if not first_date:
                first_date = date_str
            last_date = date_str

        print(json.dumps({
            "startTime": first_date,
            "endTime": last_date,
        }))
    finally:
        with _suppress_stdout():
            bs.logout()


def check_connection():
    """Verify python3 + baostock module are importable and login succeeds."""
    try:
        import baostock as bs
        with _suppress_stdout():
            lg = bs.login()
        connected = lg.error_code == '0'
        error_msg = None if connected else lg.error_msg
        with _suppress_stdout():
            bs.logout()
        result = {"connected": connected}
        if error_msg:
            result["error"] = error_msg
        print(json.dumps(result))
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
