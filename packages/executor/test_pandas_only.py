"""
Test pandas only in V3 Executor.
"""
import sys
print(f"Python: {sys.version}")

import qnx_data

qnx_data.report_progress(10, "Importing pandas...")
import pandas as pd
print(f"pandas: {pd.__version__}")

qnx_data.report_progress(50, "Getting data...")
data = qnx_data.get_market_data()
print(f"Data bars: {len(data['close'])}")

qnx_data.report_progress(70, "Creating DataFrame...")
df = pd.DataFrame({
    'close': data['close'],
    'volume': data['volume'],
})
print(f"DataFrame shape: {df.shape}")

qnx_data.report_progress(100, "Pandas test PASSED")

result = {
    'success': True,
    'metrics': {'pandas_version': pd.__version__, 'rows': len(df)},
    'trades': [],
    'equity_curve': [],
}
qnx_data.set_results(result)
