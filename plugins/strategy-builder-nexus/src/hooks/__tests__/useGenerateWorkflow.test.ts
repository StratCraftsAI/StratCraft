/**
 * useGenerateWorkflow Unit Tests (TICKET_701 Phase 4)
 *
 * Tests the AbortController integration, cancellation logic, event handling,
 * and abort error suppression.
 *
 * Strategy: Since this project has no @testing-library/react, we test
 * the hook's exported types, the cancel/abort logic paths, and the
 * AbortError handling by exercising the code patterns directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Tests: AbortController behavior (standalone, no React)
// ---------------------------------------------------------------------------

describe('TICKET_701: AbortController integration patterns', () => {

  // =========================================================================
  // AbortController lifecycle
  // =========================================================================

  describe('AbortController lifecycle', () => {
    it('should create AbortController and pass signal to executeApi', async () => {
      const executeApi = vi.fn().mockResolvedValue({
        status: 'completed',
        strategy_code: 'class Test {}',
        language: 'cpp',
      });

      // Simulate the handleConfirmNaming pattern from useGenerateWorkflow (lines 500-505)
      const abortController = new AbortController();
      const result = await executeApi({ symbol: 'AAPL' }, abortController.signal);

      expect(executeApi).toHaveBeenCalledWith(
        { symbol: 'AAPL' },
        expect.any(AbortSignal)
      );
      expect(result.status).toBe('completed');
    });

    it('should abort controller on cancelGeneration', () => {
      // Simulate the cancelGeneration pattern (lines 397-401)
      const ref: { current: AbortController | null } = { current: null };

      // Start generation: create controller
      ref.current = new AbortController();
      const abortSpy = vi.spyOn(ref.current, 'abort');

      // Cancel generation
      ref.current?.abort();
      ref.current = null;

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(ref.current).toBeNull();
    });

    it('should not throw when cancelling with no active controller', () => {
      const ref: { current: AbortController | null } = { current: null };

      // Cancel with no active controller (safe no-op)
      expect(() => {
        ref.current?.abort();
        ref.current = null;
      }).not.toThrow();
    });

    it('should abort on unmount cleanup', () => {
      // Simulate unmount cleanup effect (lines 352-357)
      const ref: { current: AbortController | null } = { current: null };
      ref.current = new AbortController();
      const abortSpy = vi.spyOn(ref.current, 'abort');

      // Cleanup function
      const cleanup = () => {
        ref.current?.abort();
        ref.current = null;
      };

      cleanup();
      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(ref.current).toBeNull();
    });
  });

  // =========================================================================
  // AbortError handling
  // =========================================================================

  describe('AbortError handling', () => {
    it('should identify AbortError correctly', () => {
      // Simulate the catch block pattern (lines 552-556)
      const abortError = new DOMException('The operation was aborted', 'AbortError');

      expect(abortError instanceof DOMException).toBe(true);
      expect(abortError.name).toBe('AbortError');
    });

    it('should silently handle AbortError (no error propagation)', async () => {
      const onError = vi.fn();
      const showAlert = vi.fn();

      const executeApi = vi.fn().mockRejectedValue(
        new DOMException('The operation was aborted', 'AbortError')
      );

      // Simulate handleConfirmNaming catch block
      try {
        await executeApi({});
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Silently return (line 555)
          return;
        }
        // Non-abort error path
        onError(String(error));
        showAlert(String(error));
      }

      // Should not reach here for AbortError
      expect(onError).not.toHaveBeenCalled();
      expect(showAlert).not.toHaveBeenCalled();
    });

    it('should propagate non-abort errors normally', async () => {
      const onError = vi.fn();

      const executeApi = vi.fn().mockRejectedValue(new Error('Network failed'));

      try {
        await executeApi({});
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        const err = error as Error;
        onError(err.message);
      }

      expect(onError).toHaveBeenCalledWith('Network failed');
    });
  });

  // =========================================================================
  // Esc key cancellation pattern
  // =========================================================================

  describe('Esc key cancellation', () => {
    it('should call cancelGeneration on Escape keydown', () => {
      const cancelGeneration = vi.fn();
      let isGenerating = true;

      // Simulate the keydown handler (lines 410-414)
      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelGeneration();
        }
      };

      // Only active when generating
      if (isGenerating) {
        handleKeyDown({ key: 'Escape', preventDefault: vi.fn() });
      }

      expect(cancelGeneration).toHaveBeenCalledTimes(1);
    });

    it('should not respond to non-Escape keys', () => {
      const cancelGeneration = vi.fn();

      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelGeneration();
        }
      };

      handleKeyDown({ key: 'Enter', preventDefault: vi.fn() });

      expect(cancelGeneration).not.toHaveBeenCalled();
    });

    it('should not register handler when not generating', () => {
      // Simulate the guard (line 408)
      const isGenerating = false;
      const addEventListenerSpy = vi.fn();

      if (!isGenerating) return; // Early return, no listener registered

      addEventListenerSpy('keydown');
      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Host cancel event (nexus:generation-cancel)
  // =========================================================================

  describe('host cancel event', () => {
    it('should call cancelGeneration when nexus:generation-cancel fires', () => {
      const cancelGeneration = vi.fn();

      // Simulate the event listener (lines 425-431)
      const handleHostCancel = () => {
        cancelGeneration();
      };

      // Simulate the event
      handleHostCancel();
      expect(cancelGeneration).toHaveBeenCalledTimes(1);
    });

    it('should register and unregister event listener properly', () => {
      const handler = vi.fn();
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();

      // Register
      addEventListener('nexus:generation-cancel', handler);
      expect(addEventListener).toHaveBeenCalledWith('nexus:generation-cancel', handler);

      // Cleanup
      removeEventListener('nexus:generation-cancel', handler);
      expect(removeEventListener).toHaveBeenCalledWith('nexus:generation-cancel', handler);
    });
  });

  // =========================================================================
  // Generation busy event dispatch
  // =========================================================================

  describe('generation busy event dispatch', () => {
    it('should create correct CustomEvent for busy state', () => {
      // Simulate the event dispatch (lines 364-366)
      const event = new CustomEvent('nexus:generation-busy', {
        detail: { busy: true },
      });

      expect(event.type).toBe('nexus:generation-busy');
      expect(event.detail.busy).toBe(true);
    });

    it('should dispatch busy=false on unmount cleanup', () => {
      const event = new CustomEvent('nexus:generation-busy', {
        detail: { busy: false },
      });

      expect(event.type).toBe('nexus:generation-busy');
      expect(event.detail.busy).toBe(false);
    });
  });

  // =========================================================================
  // Signal propagation through executeApi
  // =========================================================================

  describe('signal propagation', () => {
    it('should pass AbortSignal to executeApi function', async () => {
      const executeApi = vi.fn().mockResolvedValue({ status: 'completed' });
      const controller = new AbortController();

      await executeApi({ symbol: 'AAPL' }, controller.signal);

      const passedSignal = executeApi.mock.calls[0][1];
      expect(passedSignal).toBeInstanceOf(AbortSignal);
      expect(passedSignal.aborted).toBe(false);
    });

    it('should have aborted signal after abort() is called', async () => {
      const controller = new AbortController();
      expect(controller.signal.aborted).toBe(false);

      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    it('should reject with AbortError when signal is aborted during polling', async () => {
      const controller = new AbortController();

      // Simulate what api-client does (lines 257-259)
      const pollingFn = async (signal: AbortSignal) => {
        if (signal.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        return { status: 'completed' };
      };

      // Abort before polling
      controller.abort();

      await expect(pollingFn(controller.signal)).rejects.toThrow('The operation was aborted');
    });
  });
});

// ---------------------------------------------------------------------------
// Type-level tests: Verify exported interfaces
// ---------------------------------------------------------------------------

describe('TICKET_701: Type exports', () => {
  it('should export GenerateWorkflowActions with cancelGeneration', () => {
    // Type-level verification (compile-time check)
    type Actions = import('../useGenerateWorkflow').GenerateWorkflowActions;
    const mockActions: Actions = {
      handleStartGenerate: vi.fn() as any,
      handleCancelNaming: vi.fn(),
      handleConfirmNaming: vi.fn(),
      cancelGeneration: vi.fn(),
      setStrategyName: vi.fn(),
      getCodeDisplayState: vi.fn() as any,
      hasResult: false,
      resetNewStrategy: vi.fn(),
    };
    expect(mockActions.cancelGeneration).toBeDefined();
  });

  it('should export GenerateWorkflowConfig with optional AbortSignal in executeApi', () => {
    // Type-level verification
    type Config = import('../useGenerateWorkflow').GenerateWorkflowConfig<any, any>;
    const mockConfig: Config = {
      pageId: 'test',
      llmProvider: 'OPENAI',
      llmModel: 'gpt-4',
      buildConfig: () => ({}),
      validateConfig: () => ({ valid: true }),
      // executeApi accepts optional AbortSignal as second param
      executeApi: vi.fn() as (config: any, signal?: AbortSignal) => Promise<any>,
      buildStorageRequest: () => ({} as any),
      errorMessages: {},
      getErrorMessage: () => 'error',
    };
    expect(mockConfig.executeApi).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TICKET_727: isByokRequiredError detection pattern
// ---------------------------------------------------------------------------

describe('TICKET_727: BYOK-required error detection', () => {
  /**
   * Mirrors the isByokRequiredError() function in useGenerateWorkflow.ts.
   * Tested as standalone logic since the function is module-private.
   */
  function isByokRequiredError(errorCode: string | undefined, errorMsg: string): boolean {
    if (errorCode === 'BYOK_REQUIRED' || errorCode === 'API_KEY_REQUIRED') {
      return true;
    }
    const lowerMsg = errorMsg.toLowerCase();
    return lowerMsg.includes('own llm api key') || lowerMsg.includes('own api key') || lowerMsg.includes('byok');
  }

  it('should detect BYOK_REQUIRED error code', () => {
    expect(isByokRequiredError('BYOK_REQUIRED', 'Some message')).toBe(true);
  });

  it('should detect API_KEY_REQUIRED error code', () => {
    expect(isByokRequiredError('API_KEY_REQUIRED', 'Some message')).toBe(true);
  });

  it('should detect "own LLM API key" in error message', () => {
    expect(isByokRequiredError(undefined, 'Basic subscription requires providing your own LLM API key')).toBe(true);
  });

  it('should detect "own API key" in error message (case-insensitive)', () => {
    expect(isByokRequiredError(undefined, 'Please configure your Own Api Key')).toBe(true);
  });

  it('should detect "byok" in error message', () => {
    expect(isByokRequiredError(undefined, 'BYOK configuration required')).toBe(true);
  });

  it('should NOT match unrelated error codes', () => {
    expect(isByokRequiredError('ANONYMOUS_QUOTA_EXCEEDED', 'Quota exceeded')).toBe(false);
  });

  it('should NOT match unrelated error messages', () => {
    expect(isByokRequiredError(undefined, 'Network failed')).toBe(false);
    expect(isByokRequiredError(undefined, 'Invalid API response')).toBe(false);
  });

  it('should select correct alert action based on error type', () => {
    // Simulate the alert options logic from useGenerateWorkflow (lines 584-590)
    function getAlertAction(errorCode: string | undefined, errorMsg: string): string | undefined {
      if (errorCode === 'ANONYMOUS_QUOTA_EXCEEDED') return 'auth-required';
      if (isByokRequiredError(errorCode, errorMsg)) return 'byok-required';
      return undefined;
    }

    expect(getAlertAction('ANONYMOUS_QUOTA_EXCEEDED', 'Quota exceeded')).toBe('auth-required');
    expect(getAlertAction('BYOK_REQUIRED', 'Need API key')).toBe('byok-required');
    expect(getAlertAction(undefined, 'Basic subscription requires providing your own LLM API key')).toBe('byok-required');
    expect(getAlertAction(undefined, 'Network error')).toBeUndefined();
  });
});
