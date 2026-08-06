/**
 * useAssistantStore Unit Tests (TICKET_593_1)
 *
 * Tests for the assistant panel Zustand store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAssistantStore } from '../useAssistantStore';

describe('useAssistantStore (TICKET_593_1)', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAssistantStore.setState({
      panelOpen: false,
      assistantEnabled: true,
    });
  });

  describe('initial state', () => {
    it('should have panelOpen=false by default', () => {
      expect(useAssistantStore.getState().panelOpen).toBe(false);
    });

    it('should have assistantEnabled=true by default', () => {
      expect(useAssistantStore.getState().assistantEnabled).toBe(true);
    });
  });

  describe('setPanelOpen', () => {
    it('should set panelOpen to true', () => {
      useAssistantStore.getState().setPanelOpen(true);
      expect(useAssistantStore.getState().panelOpen).toBe(true);
    });

    it('should set panelOpen to false', () => {
      useAssistantStore.setState({ panelOpen: true });
      useAssistantStore.getState().setPanelOpen(false);
      expect(useAssistantStore.getState().panelOpen).toBe(false);
    });
  });

  describe('togglePanel', () => {
    it('should toggle panelOpen from false to true', () => {
      useAssistantStore.getState().togglePanel();
      expect(useAssistantStore.getState().panelOpen).toBe(true);
    });

    it('should toggle panelOpen from true to false', () => {
      useAssistantStore.setState({ panelOpen: true });
      useAssistantStore.getState().togglePanel();
      expect(useAssistantStore.getState().panelOpen).toBe(false);
    });
  });

  describe('setAssistantEnabled', () => {
    it('should set assistantEnabled to false', () => {
      useAssistantStore.getState().setAssistantEnabled(false);
      expect(useAssistantStore.getState().assistantEnabled).toBe(false);
    });

    it('should set assistantEnabled to true', () => {
      useAssistantStore.setState({ assistantEnabled: false });
      useAssistantStore.getState().setAssistantEnabled(true);
      expect(useAssistantStore.getState().assistantEnabled).toBe(true);
    });

    it('should close panel when disabling assistant mode', () => {
      useAssistantStore.setState({ panelOpen: true, assistantEnabled: true });
      useAssistantStore.getState().setAssistantEnabled(false);
      expect(useAssistantStore.getState().panelOpen).toBe(false);
      expect(useAssistantStore.getState().assistantEnabled).toBe(false);
    });

    it('should not affect panelOpen when enabling assistant mode', () => {
      useAssistantStore.setState({ panelOpen: false, assistantEnabled: false });
      useAssistantStore.getState().setAssistantEnabled(true);
      expect(useAssistantStore.getState().panelOpen).toBe(false);
      expect(useAssistantStore.getState().assistantEnabled).toBe(true);
    });
  });
});
