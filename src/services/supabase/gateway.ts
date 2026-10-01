/**
 * Thin adapter between the auth service and supabase-js. It only translates
 * shapes (Supabase session ↔ GatewaySession) and forwards raw errors; all
 * decisions (validation, tenant context, error messages) live in auth.ts, which
 * is tested against a fake gateway.
 */
import type { AuthChangeEvent, AuthSession } from '@supabase/supabase-js';

import type { MegabotSupabaseClient } from '@/lib/supabase';
import type { SignUpInput } from '@/types';

import type { AuthUserLike, MembershipRecord } from './tenancy';

export type GatewaySession = {
  user: AuthUserLike & { id: string };
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
};

export type GatewayAuthEvent = AuthChangeEvent;

export type SignUpPayload = {
  email: string;
  password: string;
  options: { data: { name: string; business_name: string } };
};

export type RecoveryCredentials =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string };

export interface AuthGateway {
  /** Returns `null` when the account was created without a session (email confirmation on). */
  signUp(payload: SignUpPayload): Promise<GatewaySession | null>;
  signIn(email: string, password: string): Promise<GatewaySession>;
  /** Ends the session server-side when possible; always clears the local session. */
  signOut(): Promise<void>;
  /** Clears only the local session (no network). */
  signOutLocally(): Promise<void>;
  getSession(): Promise<GatewaySession | null>;
  /** Memberships of the user as allowed by RLS, with tenant + settings embedded. */
  fetchMemberships(userId: string): Promise<MembershipRecord[]>;
  resetPasswordForEmail(email: string, redirectTo: string): Promise<void>;
  establishRecoverySession(credentials: RecoveryCredentials): Promise<GatewaySession>;
  updatePassword(newPassword: string): Promise<void>;
  onAuthStateChange(listener: (event: GatewayAuthEvent, session: GatewaySession | null) => void): () => void;
}

/**
 * Sign-up request. Only `business_name` matters to the backend: the database
 * trigger reads it from auth.users.raw_user_meta_data to provision the tenant.
 * The password confirmation is a UI concern and is never part of the payload.
 */
export function buildSignUpPayload(input: SignUpInput): SignUpPayload {
  return {
    email: input.email.trim(),
    password: input.password,
    options: { data: { name: input.name.trim(), business_name: input.businessName.trim() } },
  };
}

export type ParsedRecoveryUrl =
  | RecoveryCredentials
  | { kind: 'error'; code: string; description: string }
  | { kind: 'none' };

/**
 * Reads Supabase's redirect parameters from a deep link. With the default
 * (implicit) flow they arrive in the fragment (#access_token=…&type=recovery);
 * the query string (?code=… for PKCE, ?error=…) is checked too.
 */
export function parseRecoveryUrl(url: string): ParsedRecoveryUrl {
  const params = new Map<string, string>();
  const collect = (part: string | undefined) => {
    if (!part) return;
    for (const pair of part.split('&')) {
      const [rawKey, ...rest] = pair.split('=');
      if (!rawKey) continue;
      const decode = (value: string) => {
        try {
          return decodeURIComponent(value.replace(/\+/g, ' '));
        } catch {
          return value;
        }
      };
      params.set(decode(rawKey), decode(rest.join('=')));
    }
  };

  const [beforeHash, hash] = url.split('#', 2);
  collect(beforeHash.split('?', 2)[1]);
  collect(hash);

  const error = params.get('error_code') ?? params.get('error');
  if (error) {
    return { kind: 'error', code: error, description: params.get('error_description') ?? '' };
  }
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken };
  const code = params.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'none' };
}

function toGatewaySession(session: AuthSession): GatewaySession {
  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000)
    : new Date(Date.now() + session.expires_in * 1000);
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      phone: session.user.phone ?? null,
      user_metadata: session.user.user_metadata ?? null,
    },
    expiresAt: expiresAt.toISOString(),
  };
}

const MEMBERSHIPS_QUERY =
  'role, created_at, tenant:tenants!inner(id, name, slug, status, settings:tenant_settings(currency, timezone, locale))';

export function createSupabaseGateway(getClient: () => MegabotSupabaseClient): AuthGateway {
  return {
    async signUp(payload) {
      const { data, error } = await getClient().auth.signUp(payload);
      if (error) throw error;
      return data.session ? toGatewaySession(data.session) : null;
    },

    async signIn(email, password) {
      const { data, error } = await getClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      return toGatewaySession(data.session);
    },

    async signOut() {
      const client = getClient();
      const { error } = await client.auth.signOut();
      // Expired session / offline: make sure nothing stays on the device.
      if (error) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    },

    async signOutLocally() {
      await getClient()
        .auth.signOut({ scope: 'local' })
        .catch(() => undefined);
    },

    async getSession() {
      const { data, error } = await getClient().auth.getSession();
      if (error) throw error;
      return data.session ? toGatewaySession(data.session) : null;
    },

    async fetchMemberships(userId) {
      const { data, error } = await getClient()
        .from('tenant_users')
        .select(MEMBERSHIPS_QUERY)
        .eq('user_id', userId)
        .order('created_at');
      if (error) throw error;
      return data.map((row) => ({
        role: row.role,
        created_at: row.created_at,
        tenant: {
          id: row.tenant.id,
          name: row.tenant.name,
          slug: row.tenant.slug,
          status: row.tenant.status,
          settings: row.tenant.settings,
        },
      }));
    },

    async resetPasswordForEmail(email, redirectTo) {
      const { error } = await getClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },

    async establishRecoverySession(credentials) {
      const client = getClient();
      if (credentials.kind === 'tokens') {
        const { data, error } = await client.auth.setSession({
          access_token: credentials.accessToken,
          refresh_token: credentials.refreshToken,
        });
        if (error) throw error;
        if (!data.session) throw new Error('Recovery session missing');
        return toGatewaySession(data.session);
      }
      const { data, error } = await client.auth.exchangeCodeForSession(credentials.code);
      if (error) throw error;
      return toGatewaySession(data.session);
    },

    async updatePassword(newPassword) {
      const { error } = await getClient().auth.updateUser({ password: newPassword });
      if (error) throw error;
    },

    onAuthStateChange(listener) {
      const { data } = getClient().auth.onAuthStateChange((event, session) => {
        listener(event, session ? toGatewaySession(session) : null);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
