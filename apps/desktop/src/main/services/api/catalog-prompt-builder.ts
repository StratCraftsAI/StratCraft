import type { CatalogStrategy } from '../../../shared/data/catalog-strategy-registry';

export interface CatalogCustomization {
  preference?: string;
  timeframe?: string;
  riskLevel?: string;
}

export function buildCatalogPrompt(
  strategy: CatalogStrategy,
  customization?: CatalogCustomization,
): string {
  const lines: string[] = [];

  lines.push('You are generating a C++ trading strategy for the StratForge framework (ABI v2).');
  lines.push('');
  lines.push(`STRATEGY: ${strategy.title} - ${strategy.subtitle}`);
  lines.push(`CATEGORY: ${strategy.categoryTitle}`);
  lines.push(`RISK LEVEL: ${customization?.riskLevel || strategy.riskLevel}`);
  lines.push(`TIMEFRAMES: ${customization?.timeframe || strategy.timeframe.join(', ')}`);
  lines.push(`MARKETS: ${strategy.marketType.join(', ')}`);
  lines.push('');

  lines.push('DECISION PIPELINE:');
  strategy.pipeline.forEach((stage, i) => {
    lines.push(`Stage ${i + 1} - ${stage.title}:`);
    stage.conditions.forEach(cond => {
      lines.push(`  - ${cond}`);
    });
  });
  lines.push('');

  lines.push('INDICATORS AND FORMULAS:');
  strategy.indicators.forEach(ind => {
    lines.push(`  - ${ind.name} (${ind.role}): ${ind.formula}`);
  });
  lines.push('');

  lines.push('ENTRY RULES:');
  strategy.entryRules.forEach(rule => {
    lines.push(`  - ${rule}`);
  });
  lines.push('');

  lines.push('EXIT RULES:');
  strategy.exitRules.forEach(rule => {
    lines.push(`  - ${rule}`);
  });
  lines.push('');

  lines.push('RISK MANAGEMENT:');
  strategy.riskRules.forEach(rule => {
    lines.push(`  - ${rule}`);
  });
  lines.push('');

  lines.push('SUITABILITY:');
  lines.push(`  Works in: ${strategy.worksIn.join('; ')}`);
  lines.push(`  Fails in: ${strategy.failsIn.join('; ')}`);
  lines.push('');

  if (customization?.preference) {
    lines.push('USER CUSTOMIZATION:');
    lines.push(customization.preference);
    lines.push('');
  }

  lines.push('Generate a complete C++ strategy class using:');
  lines.push('- QNX_STRATEGY_FACTORY_EXPORT(ClassName)');
  lines.push('- stratforge::Strategy base class');
  lines.push('- onBar() for bar-by-bar logic');
  lines.push('- buy()/sell()/setStopLoss()/setTakeProfit() for order management');
  lines.push('- Framework indicator helpers where available');
  lines.push('');
  lines.push('The strategy must implement ALL stages of the decision pipeline above.');

  return lines.join('\n');
}
