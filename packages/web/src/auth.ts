export interface AuthState {
  token: string | null;
}

export function createAuthState(token: string | null = null): AuthState {
  return { token };
}

export function isAuthenticated(state: AuthState): boolean {
  return Boolean(state.token);
}
