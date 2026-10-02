import { classifyUssdResponse, screenMatchesExpectation } from '@/services/activationRules';
import type { ActivationOutcome, UssdTextMatch } from '@/types';

/**
 * UssdResponseParser — reads operator screens with the product's own texts.
 * Same rules as the backend (private.classify_ussd_response), which re-checks
 * every claim: a screen that matches neither (or both) texts is UNKNOWN, never
 * success.
 */
export const UssdResponseParser = {
  /** Final screen → SUCCESS | FAILED | UNKNOWN. */
  classify(texts: { success?: UssdTextMatch; failure?: UssdTextMatch }, screen: string | null | undefined): ActivationOutcome {
    return classifyUssdResponse(texts, screen);
  },

  /** The screen shows what the flow expects before this step (no expectation = ok). */
  matchesExpectation(screen: string | null | undefined, expect: UssdTextMatch | undefined): boolean {
    return screenMatchesExpectation(screen, expect);
  },

  /** An intermediate screen already shows a failure text (e.g. "saldo insuficiente"). */
  showsFailure(texts: { failure?: UssdTextMatch }, screen: string | null | undefined): boolean {
    return classifyUssdResponse({ failure: texts.failure }, screen) === 'FAILED';
  },
};
