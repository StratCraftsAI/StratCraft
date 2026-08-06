/**
 * Modal Dialog Type Definitions
 *
 * @see TICKET_096 - Host Layer Message Utils Design (Section 11)
 */

export type ModalType = 'info' | 'warning' | 'error' | 'confirm' | 'destructive';

/**
 * Tier-upgrade payload (TICKET_799).
 *
 * Carried on ModalOptions when `action === 'tier-upgrade'`. Lets the install
 * gate's acquisition-choice dialog render the right CTAs (Upgrade Plan +
 * optional Buyout) and route their clicks back to the caller, while keeping
 * `showModal`'s `Promise<boolean>` signature untouched -- OK/Cancel still
 * map to true/false; the acquisition CTAs invoke their callbacks and then
 * close the dialog as if Cancel was pressed.
 */
export interface TierUpgradePayload {
  /** Desktop plugin ID that triggered the gate (e.g. 'com.stratcraft.signal-generator-nexus'). */
  pluginId: string;
  /** Display name for the dialog title (e.g. 'Sigma'). */
  pluginName: string;
  /** Tier the plugin requires (e.g. 'gold'). */
  requiredTier: string;
  /** User's current effective tier (e.g. 'pro'). */
  currentTier: string;
  /** Click handler for the primary Upgrade Plan button. Dialog closes after invocation. */
  onUpgrade: () => void;
  /**
   * Click handler for the Buyout button. When omitted, the Buyout button is
   * not rendered (e.g. no buyout bundle covers this plugin -- see
   * first-party paid plugin check). Dialog closes after invocation.
   */
  onBuyout?: () => void;
  /** Optional pre-formatted price suffix appended to the Upgrade button (e.g. '$29 / mo'). */
  subscriptionPrice?: string;
  /** Optional pre-formatted price suffix appended to the Buyout button (e.g. '$199'). */
  buyoutPrice?: string;
}

export interface ModalOptions {
  type?: ModalType;
  title?: string;
  content: string;
  okText?: string;
  cancelText?: string;
  showCancel?: boolean;
  /** Optional action identifier for interactive content (e.g., 'auth-required' renders Sign up link) */
  action?: string;
  /**
   * Tier-upgrade-specific payload, consumed only when `action === 'tier-upgrade'`.
   * Ignored for every other action / modal type.
   */
  tierUpgrade?: TierUpgradePayload;
}

export interface ModalState {
  visible: boolean;
  options: ModalOptions | null;
  resolve: ((value: boolean) => void) | null;
}

export interface ModalContextValue {
  showModal: (options: ModalOptions) => Promise<boolean>;
  confirm: (
    content: string,
    options?: Omit<ModalOptions, 'type' | 'content'>
  ) => Promise<boolean>;
  alert: (
    content: string,
    options?: Omit<ModalOptions, 'content'>
  ) => Promise<void>;
}
