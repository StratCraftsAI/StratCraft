#!/usr/bin/env python3
"""
Generate test data for StratCraft benchmarks

Reference: TICKET_174 - C++ Executor Benchmark Framework

Generates Parquet files with OHLCV data for benchmark testing.
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, timedelta

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    import numpy as np
except ImportError:
    print("Required packages: pip install pyarrow numpy")
    sys.exit(1)


def generate_ohlcv(
    num_bars: int,
    start_price: float = 100.0,
    volatility: float = 0.02,
    trend: float = 0.0001,
    seed: int = 42
) -> dict:
    """Generate synthetic OHLCV data."""
    np.random.seed(seed)

    # Generate returns
    returns = np.random.normal(trend, volatility, num_bars)

    # Generate prices
    close = np.zeros(num_bars)
    close[0] = start_price

    for i in range(1, num_bars):
        close[i] = close[i - 1] * (1 + returns[i])

    # Generate OHLC from close
    high_mult = 1 + np.abs(np.random.normal(0, volatility / 2, num_bars))
    low_mult = 1 - np.abs(np.random.normal(0, volatility / 2, num_bars))

    open_prices = np.roll(close, 1)
    open_prices[0] = start_price
    high = np.maximum(close, open_prices) * high_mult
    low = np.minimum(close, open_prices) * low_mult

    # Generate volume
    volume = np.random.lognormal(mean=10, sigma=1, size=num_bars)

    # Generate timestamps (1-minute intervals)
    start_time = datetime(2021, 1, 1, 0, 0, 0)
    timestamps = [
        int((start_time + timedelta(minutes=i)).timestamp())
        for i in range(num_bars)
    ]

    return {
        "timestamp": timestamps,
        "open": open_prices.tolist(),
        "high": high.tolist(),
        "low": low.tolist(),
        "close": close.tolist(),
        "volume": volume.tolist(),
    }


def write_parquet(data: dict, output_path: Path) -> None:
    """Write data to Parquet file."""
    table = pa.table({
        "timestamp": pa.array(data["timestamp"], type=pa.int64()),
        "open": pa.array(data["open"], type=pa.float64()),
        "high": pa.array(data["high"], type=pa.float64()),
        "low": pa.array(data["low"], type=pa.float64()),
        "close": pa.array(data["close"], type=pa.float64()),
        "volume": pa.array(data["volume"], type=pa.float64()),
    })

    pq.write_table(table, output_path, compression="snappy")


def main():
    parser = argparse.ArgumentParser(
        description="Generate test data for StratCraft benchmarks"
    )
    parser.add_argument(
        "--bars",
        type=int,
        default=1000000,
        help="Number of bars to generate (default: 1000000)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output file path (default: benchmark/data/test_<bars>.parquet)"
    )
    parser.add_argument(
        "--volatility",
        type=float,
        default=0.02,
        help="Price volatility (default: 0.02)"
    )
    parser.add_argument(
        "--trend",
        type=float,
        default=0.0001,
        help="Price trend per bar (default: 0.0001)"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed (default: 42)"
    )
    parser.add_argument(
        "--sizes",
        action="store_true",
        help="Generate multiple sizes: 10K, 100K, 1M, 10M bars"
    )

    args = parser.parse_args()

    script_dir = Path(__file__).parent
    data_dir = script_dir.parent / "data"
    data_dir.mkdir(exist_ok=True)

    if args.sizes:
        # Generate multiple sizes
        sizes = [10000, 100000, 1000000, 10000000]
        for size in sizes:
            output_path = data_dir / f"test_{size // 1000}k.parquet"
            print(f"Generating {size:,} bars -> {output_path}")

            data = generate_ohlcv(
                num_bars=size,
                volatility=args.volatility,
                trend=args.trend,
                seed=args.seed
            )
            write_parquet(data, output_path)

            file_size_mb = output_path.stat().st_size / (1024 * 1024)
            print(f"  Size: {file_size_mb:.2f} MB")
    else:
        # Generate single file
        if args.output:
            output_path = Path(args.output)
        else:
            output_path = data_dir / f"test_{args.bars // 1000}k.parquet"

        print(f"Generating {args.bars:,} bars -> {output_path}")

        data = generate_ohlcv(
            num_bars=args.bars,
            volatility=args.volatility,
            trend=args.trend,
            seed=args.seed
        )
        write_parquet(data, output_path)

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"Size: {file_size_mb:.2f} MB")

    print("Done.")


if __name__ == "__main__":
    main()
