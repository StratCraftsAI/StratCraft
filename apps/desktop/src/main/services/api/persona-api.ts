/**
 * Persona Service API
 *
 * TICKET_426_2: Persona Constraint System
 *
 * Backend proxy for persona list. Personas live on backend (YAML config),
 * not in local SQLite -- no direct DB fallback.
 */

import { authenticatedJsonFetch } from '../../utils/api-request';
import { API_PERSONA_LIST_LEGACY } from '@StratCraft/types';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import { ApiResponse } from './types';

interface PersonaItem {
  id: string;
  label: string;
  description: {
    must_include: string[];
    regime_bias: string[];
    holding_period: string;
    risk_style: string;
    forbidden: string[];
  };
}

interface BackendPersonaListResponse {
  success: boolean;
  personas: PersonaItem[];
  total: number;
}

export async function listPersonas(): Promise<ApiResponse<PersonaItem[]>> {
  try {
    const response = await authenticatedJsonFetch<BackendPersonaListResponse>(
      API_PERSONA_LIST_LEGACY,
      { method: 'GET' }
    );

    if (!response.success) {
      return { success: false, error: mainT(getCurrentMainLocale(), 'errors', 'main.backtestApi.backendUnsuccessful') };
    }

    return { success: true, data: response.personas };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
