/**
 * useHub - React hooks for interacting with the Data Hub
 * 
 * Provides:
 * - useHubState: Reactive hook for global state keys
 * - useHubEvent: Hook for subscribing to global events
 * - useHub: Direct access to the hub client
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { hubClient } from '../lib/hub-client';
import { HubStateKey, HubStateMap, HubEventType, HubEventPayload } from '../../shared/types/hub/schema';

/**
 * Access the Hub Client directly
 */
export function useHub() {
  return hubClient;
}

/**
 * Reactive hook for a specific Data Hub state key
 */
export function useHubState<K extends HubStateKey>(key: K, initialValue?: HubStateMap[K]) {
  const [value, setValue] = useState<HubStateMap[K] | undefined>(initialValue);

  // Load initial value
  useEffect(() => {
    hubClient.state.get(key).then(val => {
      if (val !== undefined) setValue(val);
    });
  }, [key]);

  // Subscribe to updates
  useEffect(() => {
    return hubClient.state.subscribe(key, (newVal) => {
      setValue(newVal);
    });
  }, [key]);

  const updateValue = useCallback((newVal: HubStateMap[K]) => {
    hubClient.state.set(key, newVal);
  }, [key]);

  return [value, updateValue] as const;
}

/**
 * Hook for subscribing to Hub events
 */
export function useHubEvent<E extends HubEventType>(
  type: E, 
  callback: (payload: HubEventPayload[E]) => void,
  options?: { filter?: (p: HubEventPayload[E]) => boolean, replay?: boolean }
) {
  // Use refs to avoid re-subscribing when callback or filter changes
  const callbackRef = useRef(callback);
  const filterRef = useRef(options?.filter);

  useEffect(() => {
    callbackRef.current = callback;
    filterRef.current = options?.filter;
  }, [callback, options?.filter]);

  useEffect(() => {
    const wrappedCallback = (payload: HubEventPayload[E]) => {
      if (!filterRef.current || filterRef.current(payload)) {
        callbackRef.current(payload);
      }
    };

    return hubClient.events.on(type, wrappedCallback, { 
      replay: options?.replay 
    });
  }, [type, options?.replay]);
}
