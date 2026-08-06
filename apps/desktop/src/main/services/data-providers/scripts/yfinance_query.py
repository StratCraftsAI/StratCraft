"""
YFinance OHLCV Query Script

TICKET_292: Standalone Python script for yfinance data fetching.
Called via child_process.execFile from YFinanceProvider.

Input: command-line args (command, symbol, interval, start_date, end_date)
Output: JSON to stdout

Commands:
  query  <symbol> <interval> <start> <end>  -> OHLCVRow[] JSON
  search <query> <limit>                    -> ProviderSymbolInfo[] JSON
  info   <symbol>                           -> { startTime, endTime } JSON
  check                                     -> { "connected": true/false }
"""

import sys
import json
from datetime import datetime, timedelta


def _to_yfinance_exclusive_end(end_date: str) -> str:
    """Convert an inclusive YYYY-MM-DD end date to yfinance's exclusive end.

    TICKET_958 C2 chunk-seam contract: every QuantNexus provider script
    treats `end_date` as INCLUSIVE (caller's chunk-end day). yfinance's
    `Ticker.history(end=...)` is EXCLUSIVE -- the bar dated `end_date`
    is silently dropped. Across N chunks that strips N trading days at
    every chunk seam, which is exactly the kind of cover-not-intersect
    cache-freshness bypass TICKET_958 closes.

    Fix: add one calendar day so the requested final day is included.
    Calendar (not trading) day is correct because yfinance internally
    filters to its own session calendar -- a trading-day shift here
    would itself drop the requested day across weekends/holidays.
    """
    dt = datetime.strptime(end_date, "%Y-%m-%d")
    return (dt + timedelta(days=1)).strftime("%Y-%m-%d")


def query_ohlcv(symbol: str, interval: str, start_date: str, end_date: str):
    """Download OHLCV data and output as JSON array."""
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    yfinance_end = _to_yfinance_exclusive_end(end_date)
    df = ticker.history(start=start_date, end=yfinance_end, interval=interval)

    if df.empty:
        print(json.dumps([]))
        return

    rows = []
    for idx, row in df.iterrows():
        # Convert pandas Timestamp to Unix seconds
        ts = int(idx.timestamp())
        rows.append({
            "timestamp": ts,
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": float(row["Volume"]),
        })

    # Ensure sorted by timestamp ASC
    rows.sort(key=lambda r: r["timestamp"])
    print(json.dumps(rows))


def search_symbols(query: str, limit: int):
    """Search for symbols matching query."""
    import yfinance as yf

    try:
        # yfinance search API
        results = yf.Search(query)
        quotes = results.quotes if hasattr(results, 'quotes') else []
        symbols = []
        for q in quotes[:limit]:
            symbol_type = "stock"
            qt = q.get("quoteType", "").lower()
            if qt == "equity":
                symbol_type = "stock"
            elif qt == "etf":
                symbol_type = "etf"
            elif qt == "cryptocurrency":
                symbol_type = "crypto"
            elif qt == "currency":
                symbol_type = "forex"
            elif qt == "index":
                symbol_type = "index"

            symbols.append({
                "symbol": q.get("symbol", ""),
                "name": q.get("shortname", q.get("longname", "")),
                "type": symbol_type,
                "exchange": q.get("exchange", ""),
            })
        print(json.dumps(symbols))
    except Exception as e:
        print(json.dumps({"error": f"Search failed: {str(e)}"}))
        sys.exit(1)


def get_symbol_info(symbol: str):
    """Get data availability date range for a symbol.

    TICKET_305 Phase 2: Returns { startTime, endTime } as ISO date strings.
    Primary: Ticker.info['firstTradeDateMilliseconds']
    Fallback: ticker.history(period='max', interval='1mo') first row date
    """
    import yfinance as yf
    from datetime import datetime, timezone

    ticker = yf.Ticker(symbol)
    info = ticker.info

    start_time = None

    # Primary: firstTradeDateMilliseconds (milliseconds since epoch)
    first_trade_ms = info.get('firstTradeDateMilliseconds')
    if first_trade_ms and isinstance(first_trade_ms, (int, float)):
        dt = datetime.fromtimestamp(first_trade_ms / 1000, tz=timezone.utc)
        start_time = dt.strftime('%Y-%m-%d')

    # Fallback: minimal history download when info field is null
    if not start_time:
        try:
            df = ticker.history(period='max', interval='1mo')
            if not df.empty:
                start_time = df.index[0].strftime('%Y-%m-%d')
        except Exception:
            pass

    # endTime = current UTC date (latest available data)
    end_time = datetime.now(tz=timezone.utc).strftime('%Y-%m-%d')

    print(json.dumps({"startTime": start_time, "endTime": end_time}))


def check_connection():
    """Verify python3 + yfinance module are importable. No network call needed."""
    try:
        import yfinance as yf
        # Verify module is functional by checking version attribute
        _ = yf.__version__
        print(json.dumps({"connected": True}))
    except Exception as e:
        print(json.dumps({"connected": False, "error": str(e)}))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified. Usage: query|search|check"}))
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

        elif command == "info":
            if len(sys.argv) != 3:
                print(json.dumps({"error": "Usage: info <symbol>"}))
                sys.exit(1)
            get_symbol_info(sys.argv[2])

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
