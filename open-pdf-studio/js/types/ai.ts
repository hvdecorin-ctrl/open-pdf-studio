// These types describe the shape of values served by the OIDC-backed AI
// store. Identity + billing live on account.impertio.app — this app only
// consumes claims coming back from /oauth/userinfo and the JWT profile.

// Minimum claims the desktop app decodes from the stored JWT. Same shape
// as UserProfile in src-tauri/src/auth.rs.
export interface AIUser {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export interface AISubscription {
  tier?: 'free' | 'pro' | 'studio' | string;
  status?: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'incomplete' | string;
}

export interface AICredits {
  total: number;
  monthly: number;
  topup: number;
  resets_at: string | null;
}

// Alias so existing imports keep compiling.
export type AIUsage = AICredits;

// The full /oauth/userinfo payload.
export interface AIUserInfo {
  sub: string;
  email: string | null;
  email_verified: boolean | null;
  name: string | null;
  picture: string | null;
  subscription: AISubscription | null;
  credits: AICredits | null;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  action: string;
  timestamp: number;
}

export interface AIChatResponse {
  content: string;
  cached: boolean;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export type AIAction = 'summarize' | 'qa' | 'translate' | 'rewrite' | 'explain' | 'extract' | 'chat';

export type AIContext = 'page' | 'all' | 'selection';

export type AIPanelMode = 'floating' | 'docked';
