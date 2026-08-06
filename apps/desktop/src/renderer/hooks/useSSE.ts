/**
 * Server-Sent Events Hook
 *
 * @deprecated TICKET_133: V1 SSE hooks for Python FastAPI server
 * V3 architecture uses IPC events from Executor process.
 * Use useExecutor() from './useExecutor' for backtest progress.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_CONFIG } from '@shared/constants';

interface SSEOptions {
  url: string;
  onMessage?: (data: unknown) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

interface SSEState {
  isConnected: boolean;
  error: Error | null;
  lastMessage: unknown | null;
}

export function useSSE(options: SSEOptions) {
  const { url, onMessage, onError, onOpen } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const [state, setState] = useState<SSEState>({
    isConnected: false,
    error: null,
    lastMessage: null,
  });

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      return;
    }

    const fullUrl = url.startsWith('http') ? url : `${API_CONFIG.SSE_URL}${url}`;
    eventSourceRef.current = new EventSource(fullUrl);

    eventSourceRef.current.onopen = () => {
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
      onOpen?.();
    };

    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setState((prev) => ({ ...prev, lastMessage: data }));
        onMessage?.(data);
      } catch {
        setState((prev) => ({ ...prev, lastMessage: event.data }));
        onMessage?.(event.data);
      }
    };

    eventSourceRef.current.onerror = (event) => {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: new Error('SSE connection error'),
      }));
      onError?.(event);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [url, onMessage, onError, onOpen]);

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setState({
      isConnected: false,
      error: null,
      lastMessage: null,
    });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
  };
}

/**
 * Backtest progress SSE Hook
 * @deprecated TICKET_133: Use useExecutor() for V3 progress events
 */
export function useBacktestProgress(
  taskId: string | null,
  onProgress?: (data: { progress: number; status: string }) => void
) {
  return useSSE({
    url: taskId ? `/backtest/progress/${taskId}` : '',
    onMessage: (data) => {
      if (
        data &&
        typeof data === 'object' &&
        'progress' in data &&
        'status' in data
      ) {
        onProgress?.(data as { progress: number; status: string });
      }
    },
  });
}
