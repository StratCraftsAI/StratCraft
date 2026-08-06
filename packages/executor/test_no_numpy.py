"""Test without numpy - just qnx_data basic call."""
print("Python script starting...")
import qnx_data
print("qnx_data imported")

# DON'T call get_market_data() as it requires numpy
qnx_data.report_progress(100, "Test passed without numpy")

result = {
    'success': True,
    'metrics': {},
    'trades': [],
    'equity_curve': [],
}
qnx_data.set_results(result)
print("Done")
