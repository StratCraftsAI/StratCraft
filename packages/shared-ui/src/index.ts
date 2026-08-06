export {
  ErrorState,
  default as ErrorStateDefault,
  type ErrorStateVariant,
  type ErrorStateAction,
  type ErrorStateProps,
} from './components/ErrorState';

export {
  createWatchdog,
  useEventWatchdog,
  type UseEventWatchdogParams,
  type WatchdogTimer,
} from './hooks/useEventWatchdog';
