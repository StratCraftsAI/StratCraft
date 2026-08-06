#!/usr/bin/env bash
# Constants owned by the StratCraft build and development launcher.

# Measured on the current 26-workspace Electron development topology:
# 19 tsup watchers use two instances each; five Vite plugin watchers, one
# TypeScript watcher, electron-vite, Electron, and its network service use ten
# more. Keep explicit headroom for startup-time watcher overlap and small tool
# version drift without returning to the unsupported historical 70-instance
# estimate.
readonly ELECTRON_DEV_INOTIFY_MEASURED_DEMAND=48
readonly ELECTRON_DEV_INOTIFY_SAFETY_MARGIN=8
readonly ELECTRON_DEV_INOTIFY_REQUIRED_HEADROOM=$((
    ELECTRON_DEV_INOTIFY_MEASURED_DEMAND + ELECTRON_DEV_INOTIFY_SAFETY_MARGIN
))
