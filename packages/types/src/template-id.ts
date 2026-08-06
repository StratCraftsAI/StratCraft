/**
 * TICKET_1030_6: Central TemplateId registry.
 *
 * Single source of truth for every signal template identifier used across
 * the codebase. Follows the same const-object + narrow-type pattern as
 * `data-provider-id.ts` (TICKET_1023_3) and satisfies the "NO MAGIC
 * NUMBERS" rule (TICKET_179).
 *
 * Additive only: adding a new template is a typed migration. Removing a
 * value is a breaking change that touches every consumer + the Python
 * `PARAM_SCHEMA` registry.
 */

export const TemplateId = {
  RSI_V1: 'rsi_v1',
  SMA_CROSS_V1: 'sma_cross_v1',
  MACD_V1: 'macd_v1',
  XGBOOST_RETURN_V1: 'xgboost_return_v1',
  XGBOOST_RETURN_V2: 'xgboost_return_v2',
  XGBOOST_RETURN_V3: 'xgboost_return_v3',
  HMM_REGIME_V1: 'hmm_regime_v1',
  GMM_REGIME_V1: 'gmm_regime_v1',
  LIGHTGBM_RETURN_V1: 'lightgbm_return_v1',
  LIGHTGBM_RETURN_V2: 'lightgbm_return_v2',
  SKLEARN_RIDGE_RETURN_V1: 'sklearn_ridge_return_v1',
  SKLEARN_LASSO_RETURN_V1: 'sklearn_lasso_return_v1',
  SKLEARN_RANDOM_FOREST_RETURN_V1: 'sklearn_random_forest_return_v1',
  SKLEARN_LOGISTIC_RETURN_V1: 'sklearn_logistic_return_v1',
  NGRAM_NEXT_BAR_V1: 'ngram_next_bar_v1',
  PYTORCH_MLP_RETURN_V1: 'pytorch_mlp_return_v1',
  PYTORCH_LSTM_RETURN_V1: 'pytorch_lstm_return_v1',
  FT_TRANSFORMER_RETURN_V1: 'ft_transformer_return_v1',
  PYTORCH_GRU_RETURN_V1: 'pytorch_gru_return_v1',
  SKLEARN_ELASTICNET_RETURN_V1: 'sklearn_elasticnet_return_v1',
  SKLEARN_BAYESIAN_RIDGE_RETURN_V1: 'sklearn_bayesian_ridge_return_v1',
  CATBOOST_RETURN_V2: 'catboost_return_v2',
  DOUBLE_ENSEMBLE_RETURN_V2: 'double_ensemble_return_v2',
  PYTORCH_TCN_RETURN_V1: 'pytorch_tcn_return_v1',
} as const;

export type TemplateIdValue = typeof TemplateId[keyof typeof TemplateId];
