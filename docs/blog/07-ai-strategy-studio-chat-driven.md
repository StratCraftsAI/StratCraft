---
title: "AI Strategy Studio: Build Trading Strategies Through Conversation"
slug: "ai-strategy-studio-chat-driven"
category: "Feature"
tags: ["ai strategy generator chat", "conversational strategy builder", "natural language trading"]
excerpt: "AI Strategy Studio lets you describe trading strategies in natural language and generates executable Python code through a chat interface."
estimated_reading_time: "6 min"
---

## Introduction

AI Strategy Studio is a conversational strategy builder in StratCraft that lets you describe trading strategies in plain English and generates complete, executable Python code through a chat interface. Unlike the form-based builder modes that require you to configure indicators and parameters manually, AI Strategy Studio uses a free-form conversation where you describe what you want and the AI builds it.

This is the most accessible strategy builder mode in StratCraft -- no knowledge of technical indicators or Python required. Describe your trading idea, iterate through conversation, and get a backtest-ready strategy. Available to Pro plan users.

## Key Highlights

- **Chat-Driven Generation** -- Describe your strategy in natural language. The AI asks clarifying questions, proposes rules, and generates code.
- **Automatic Rule Extraction** -- The AI parses your conversation and extracts structured strategy rules (entry conditions, exit conditions, filters) into an editable rules panel.
- **One-Click Actions** -- Generate Code, Save Strategy, or Run Backtest directly from the chat interface with action buttons.
- **Persistent Sessions** -- Conversations are saved to SQLite, so you can continue strategy development across sessions.
- **Fully Independent** -- AI Strategy Studio does not depend on any other builder mode. It generates standalone strategies from scratch.

## How It Works

1. **Start a Conversation** -- Open AI Strategy Studio and describe your trading idea. For example: "I want a mean-reversion strategy that buys when price drops 2 standard deviations below the 20-day mean, and sells when it returns to the mean."
2. **Iterate** -- The AI may ask clarifying questions: "What timeframe? Should we add a volume filter? What about stop-losses?" Answer in natural language.
3. **Review Strategy Rules** -- As the conversation progresses, the AI extracts structured rules into the Strategy Rules Panel. You can manually edit these rules if needed.
4. **Generate Code** -- Click the "Generate Code" action button. The AI produces a complete Python strategy file inheriting from `StandaloneStrategyBase`.
5. **Backtest** -- Click "Run Backtest" to execute the strategy directly from the chat interface.

### Example Conversation

```
You: I want to trade breakouts on daily charts. Buy when price
    closes above the 50-day high with volume at least 1.5x the
    20-day average volume.

AI:  I'll create a breakout strategy with these rules:
     - Entry: Close > 50-day High AND Volume > 1.5x 20-day Avg Volume
     - What exit conditions would you like? Time-based, trailing
       stop, or indicator-based?

You: Use a 3% trailing stop and exit if price drops below the
    20-day moving average.

AI:  Strategy rules updated:
     - Entry: Price breakout above 50-day high with volume confirmation
     - Exit: 3% trailing stop OR close below 20-day SMA
     [Generate Code] [Save Strategy] [Run Backtest]
```

## Screenshots

<!-- SCREENSHOT: AI Strategy Studio chat interface with conversation history and action buttons -->
<!-- FILE: images/blog/ai-strategy-studio-chat-driven/01.png -->

<!-- SCREENSHOT: Strategy Rules Panel showing extracted entry/exit rules from conversation -->
<!-- FILE: images/blog/ai-strategy-studio-chat-driven/02.png -->

<!-- SCREENSHOT: Generated Python code output from chat-driven strategy -->
<!-- FILE: images/blog/ai-strategy-studio-chat-driven/03.png -->

## Why This Matters

The barrier to algorithmic trading has always been technical: you need to know programming, understand indicator math, and translate trading intuition into formal rules. AI Strategy Studio eliminates this barrier by letting traders express ideas the way they naturally think about markets -- in conversation.

This does not mean dumbing down the output. The generated strategies are the same standard Python files as every other builder mode, fully inspectable and editable. The conversation interface is simply a more natural way to arrive at those strategies, especially for traders who have strong market intuition but limited programming experience.

The persistent session design also supports iterative strategy development. You can start a conversation, backtest the result, come back the next day, and say "the drawdown is too high -- add a volatility filter." The AI has full context from previous messages and builds on your existing strategy.

## Getting Started

- **Requires Pro Plan** -- AI Strategy Studio is a Pro feature
- **BYOK Required** -- Bring your own API key for any supported LLM provider
- **Navigate**: Strategy Builder > AI Strategy Studio
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

AI Strategy Studio generates `strategy_type: 1` (Execution) with `signal_source: vibing_chat`. The API endpoint is `/api/vibing_chat`. Generated strategies inherit from `StandaloneStrategyBase`. Chat sessions are persisted in the local SQLite database with full message history. The rule extraction system parses LLM responses to identify entry conditions, exit conditions, and filter rules, displaying them in a structured panel that supports manual editing before code generation.
