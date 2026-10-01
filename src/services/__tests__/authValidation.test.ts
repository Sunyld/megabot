import { isAppError } from '../errors';
import { assertValidNewPassword, assertValidSignUp, validateSignUpForm } from '../authValidation';

const valid = {
  name: 'Ana Langa',
  businessName: 'MegaBot Test',
  email: 'ana@megabot.test',
  password: 'segredo123',
  confirmPassword: 'segredo123',
};

const reasonOf = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    return isAppError(error) ? error.reason : 'not-an-app-error';
  }
  return undefined;
};

describe('validateSignUpForm', () => {
  it('accepts a valid form', () => {
    expect(validateSignUpForm(valid)).toEqual({});
  });

  it('checks the business name length (2–80)', () => {
    expect(validateSignUpForm({ ...valid, businessName: 'A' }).businessName).toBeDefined();
    expect(validateSignUpForm({ ...valid, businessName: 'x'.repeat(81) }).businessName).toBeDefined();
    expect(validateSignUpForm({ ...valid, businessName: `  ${'x'.repeat(80)}  ` }).businessName).toBeUndefined();
  });

  it('checks email format and password length', () => {
    expect(validateSignUpForm({ ...valid, email: 'ana@' }).email).toBeDefined();
    expect(validateSignUpForm({ ...valid, password: '1234567', confirmPassword: '1234567' }).password).toBeDefined();
  });

  it('requires the confirmation to match', () => {
    expect(validateSignUpForm({ ...valid, confirmPassword: 'outra-coisa' }).confirmPassword).toBe(
      'As palavras-passe não coincidem.'
    );
  });
});

describe('service-side guards', () => {
  it('reports precise reasons', () => {
    expect(reasonOf(() => assertValidSignUp({ ...valid, businessName: ' ' }))).toBe('INVALID_BUSINESS_NAME');
    expect(reasonOf(() => assertValidSignUp({ ...valid, email: 'no-at-sign' }))).toBe('INVALID_EMAIL');
    expect(reasonOf(() => assertValidSignUp({ ...valid, password: 'short' }))).toBe('WEAK_PASSWORD');
    expect(reasonOf(() => assertValidNewPassword('short'))).toBe('WEAK_PASSWORD');
    expect(reasonOf(() => assertValidSignUp(valid))).toBeUndefined();
  });
});
