/**
 * Algorithm Code Registry - Centralized Algorithm Code Management
 *
 * TICKET_168: Centralized Algorithm Code Registry
 * TICKET_690: Python backtrader templates removed (C++ only pipeline)
 *
 * Registry pattern retained for future C++ template population.
 * All lookups return null, falling back to DB code (normal path for
 * user-generated strategies).
 */

// =============================================================================
// Types
// =============================================================================

export interface AlgorithmCodeTemplate {
  strategyName: string;
  strategyType: number;
  code: string;
  description?: string;
}

export type StrategyPhase = 'analysis' | 'precondition' | 'execution' | 'postcondition';

// =============================================================================
// Code Templates - Analysis (strategy_type = 9)
// TICKET_690: Python backtrader templates removed
// =============================================================================

const ANALYSIS_TEMPLATES: Record<string, string> = {};

// =============================================================================
// Code Templates - Execution (strategy_type = 0, 1, 2, 3)
// TICKET_690: Python backtrader templates removed
// =============================================================================

const EXECUTION_TEMPLATES: Record<string, string> = {};

// =============================================================================
// Code Templates - Precondition (strategy_type = 4)
// TICKET_690: Python backtrader templates removed
// =============================================================================

const PRECONDITION_TEMPLATES: Record<string, string> = {};

// =============================================================================
// Code Templates - Postcondition (strategy_type = 6)
// TICKET_690: Python backtrader templates removed
// =============================================================================

const POSTCONDITION_TEMPLATES: Record<string, string> = {};

// =============================================================================
// Registry Class
// =============================================================================

class AlgorithmCodeRegistry {
  private templates: Map<string, AlgorithmCodeTemplate> = new Map();

  constructor() {
    this.registerAll();
  }

  /**
   * Register all built-in algorithm templates
   */
  private registerAll(): void {
    // Analysis (strategy_type = 9)
    Object.entries(ANALYSIS_TEMPLATES).forEach(([name, code]) => {
      this.register(name, 9, code);
    });

    // Precondition (strategy_type = 4)
    Object.entries(PRECONDITION_TEMPLATES).forEach(([name, code]) => {
      this.register(name, 4, code);
    });

    // Execution (strategy_type = 0)
    Object.entries(EXECUTION_TEMPLATES).forEach(([name, code]) => {
      this.register(name, 0, code);
    });

    // Postcondition (strategy_type = 6)
    Object.entries(POSTCONDITION_TEMPLATES).forEach(([name, code]) => {
      this.register(name, 6, code);
    });
  }

  /**
   * Register an algorithm code template
   */
  register(strategyName: string, strategyType: number, code: string, description?: string): void {
    this.templates.set(strategyName, {
      strategyName,
      strategyType,
      code,
      description,
    });
  }

  /**
   * Get code for a strategy by name
   * Returns null if not found in registry
   */
  getCode(strategyName: string): string | null {
    const template = this.templates.get(strategyName);
    return template?.code || null;
  }

  /**
   * Check if code is valid (must be a substantive code block)
   */
  isValidCode(strategyName: string, code: string): boolean {
    // Code is invalid if it equals the strategy name (common bug pattern)
    if (code === strategyName) {
      return false;
    }
    // Code should be reasonably long for a strategy definition
    if (code.length < 100) {
      return false;
    }
    return true;
  }

  /**
   * Get valid code for an algorithm
   * If database code is invalid, returns registry code
   * If both are invalid, returns null (fallback to db code handled by caller)
   */
  getValidCode(strategyName: string, dbCode: string): string | null {
    // If database code is valid (contains class definition), use it
    if (this.isValidCode(strategyName, dbCode)) {
      return dbCode;
    }

    // Otherwise, try to get from registry
    const registryCode = this.getCode(strategyName);
    if (registryCode) {
      console.debug(
        `[AlgorithmCodeRegistry] Using registry code for "${strategyName}"`
      );
      return registryCode;
    }

    // No valid code in registry - this is expected for user-created algorithms
    // Caller will fallback to db code
    return null;
  }

  /**
   * Get all registered strategy names
   */
  getAllNames(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Get all templates for a specific strategy type
   */
  getByType(strategyType: number): AlgorithmCodeTemplate[] {
    return Array.from(this.templates.values()).filter((t) => t.strategyType === strategyType);
  }

  /**
   * Validate all algorithms and return issues
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    this.templates.forEach((template) => {
      if (!this.isValidCode(template.strategyName, template.code)) {
        issues.push(`Invalid code for "${template.strategyName}": missing class definition`);
      }
    });

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const algorithmCodeRegistry = new AlgorithmCodeRegistry();

// Export templates for seed script generation
export const CODE_TEMPLATES = {
  analysis: ANALYSIS_TEMPLATES,
  precondition: PRECONDITION_TEMPLATES,
  execution: EXECUTION_TEMPLATES,
  postcondition: POSTCONDITION_TEMPLATES,
};
