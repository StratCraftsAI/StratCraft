"""Minimal test - no imports except qnx_data."""
import qnx_data

qnx_data.report_progress(50, "Hello from Python")

data = qnx_data.get_market_data()

result = {
    'success': True,
    'metrics': {'bars': len(data['close'])},
    'trades': [],
    'equity_curve': [],
}
qnx_data.set_results(result)
