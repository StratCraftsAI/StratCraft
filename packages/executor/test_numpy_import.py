"""Test numpy import first, then use qnx_data."""
print("Step 1: Importing numpy first...")
import numpy as np
print(f"NumPy version: {np.__version__}")
print("NumPy imported successfully!")

print("Step 2: Importing qnx_data...")
import qnx_data
print("qnx_data imported!")

print("Step 3: Calling get_market_data()...")
data = qnx_data.get_market_data()
print(f"Got data with {len(data['close'])} bars")

result = {
    'success': True,
    'metrics': {'test': 1.0},
    'trades': [],
    'equity_curve': [],
}
qnx_data.set_results(result)
print("Done!")
