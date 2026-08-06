"""
Sample Strategy for Testing

TICKET_133 Phase 1: Executor Core Development

This is a simple moving average crossover strategy that demonstrates
the qnx_data module interface.
"""

import qnx_data
import numpy as np

def calculate_sma(data: np.ndarray, period: int) -> np.ndarray:
    """Calculate Simple Moving Average."""
    result = np.full(len(data), np.nan)
    for i in range(period - 1, len(data)):
        result[i] = np.mean(data[i - period + 1:i + 1])
    return result

def run_backtest():
    """Main backtest entry point."""
    # Get market data from C++
    data = qnx_data.get_market_data()
    config = qnx_data.get_config()

    # Extract arrays
    close = np.array(data['close'])
    timestamp = np.array(data['timestamp'])

    # Get strategy parameters
    params = config.get('strategy_params', {})
    fast_period = params.get('fast_period', 10)
    slow_period = params.get('slow_period', 20)

    # Execution config
    execution = config.get('execution', {})
    initial_capital = execution.get('initial_capital', 100000.0)
    commission_rate = execution.get('commission', 0.001)

    # Calculate indicators
    fast_ma = calculate_sma(close, fast_period)
    slow_ma = calculate_sma(close, slow_period)

    # Track state
    position = 0.0
    capital = initial_capital
    trades = []
    equity_curve = []

    entry_price = 0.0
    entry_time = 0

    # Run through data
    for i in range(slow_period, len(close)):
        # Record equity
        equity = capital + position * close[i]
        equity_curve.append({
            'timestamp': int(timestamp[i]),
            'equity': equity,
            'drawdown': 0.0  # Simplified
        })

        # Report progress
        if i % 100 == 0:
            progress = (i / len(close)) * 100
            qnx_data.report_progress(progress, f"Processing bar {i}/{len(close)}")

        # Skip if no signal possible
        if np.isnan(fast_ma[i]) or np.isnan(slow_ma[i]):
            continue

        # Generate signals
        if position == 0:
            # Check for buy signal (fast crosses above slow)
            if fast_ma[i] > slow_ma[i] and fast_ma[i-1] <= slow_ma[i-1]:
                # Buy
                quantity = capital * 0.95 / close[i]  # 95% of capital
                commission = quantity * close[i] * commission_rate
                position = quantity
                entry_price = close[i]
                entry_time = int(timestamp[i])
                capital -= commission

        elif position > 0:
            # Check for sell signal (fast crosses below slow)
            if fast_ma[i] < slow_ma[i] and fast_ma[i-1] >= slow_ma[i-1]:
                # Sell
                exit_price = close[i]
                commission = position * exit_price * commission_rate
                pnl = position * (exit_price - entry_price) - commission

                trades.append({
                    'entry_time': entry_time,
                    'exit_time': int(timestamp[i]),
                    'symbol': data['symbol'],
                    'side': 'buy',
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'quantity': position,
                    'pnl': pnl,
                    'commission': commission,
                    'reason': 'MA crossover'
                })

                capital += position * exit_price - commission
                position = 0

    # Calculate metrics
    total_pnl = capital - initial_capital
    total_return = total_pnl / initial_capital

    winning_trades = [t for t in trades if t['pnl'] > 0]
    losing_trades = [t for t in trades if t['pnl'] <= 0]

    win_rate = len(winning_trades) / len(trades) if trades else 0.0

    profit_factor = abs(sum(t['pnl'] for t in winning_trades) /
                       sum(t['pnl'] for t in losing_trades)) if losing_trades else 0.0

    # Calculate Sharpe ratio (simplified)
    if len(equity_curve) > 1:
        returns = np.diff([e['equity'] for e in equity_curve]) / np.array([e['equity'] for e in equity_curve[:-1]])
        sharpe = np.mean(returns) / np.std(returns) * np.sqrt(252) if np.std(returns) > 0 else 0.0
    else:
        sharpe = 0.0

    # Calculate max drawdown
    equity_values = [e['equity'] for e in equity_curve]
    peak = equity_values[0]
    max_dd = 0.0
    for eq in equity_values:
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak
        if dd > max_dd:
            max_dd = dd

    # Update drawdown in equity curve
    peak = equity_values[0]
    for e in equity_curve:
        if e['equity'] > peak:
            peak = e['equity']
        e['drawdown'] = (peak - e['equity']) / peak

    # Set results
    qnx_data.set_results({
        'success': True,
        'metrics': {
            'total_pnl': total_pnl,
            'total_return': total_return,
            'sharpe_ratio': sharpe,
            'max_drawdown': max_dd,
            'total_trades': len(trades),
            'winning_trades': len(winning_trades),
            'losing_trades': len(losing_trades),
            'win_rate': win_rate,
            'profit_factor': profit_factor
        },
        'equity_curve': equity_curve[-100:],  # Last 100 points
        'trades': trades
    })

    qnx_data.report_progress(100.0, "Backtest complete")

# Run the backtest
if __name__ == '__main__' or True:  # Always run when imported
    run_backtest()
