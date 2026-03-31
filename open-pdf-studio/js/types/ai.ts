export interface AIUser {
  id: string;
  email: string;
  full_name: string | null;
  is_verified: boolean;
  created_at: string;
}

export interface AIPlan {
  name: string;
  monthly_token_limit: number;
  monthly_request_limit: number;
  price_cents: number;
  features: string | null;
}

export interface AISubscription {
  plan_name: string;
  status: string;
  tokens_used: number;
  tokens_limit: number;
  requests_used: number;
  requests_limit: number;
  current_period_end: string | null;
}

export interface AIUsage {
  tokens_used: number;
  tokens_limit: number;
  tokens_remaining: number;
  requests_used: number;
  requests_limit: number;
  requests_remaining: number;
  plan_name: string;
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

export interface AICheckoutResponse {
  checkout_url: string;
}

export type AIAction = 'summarize' | 'qa' | 'translate' | 'rewrite' | 'explain' | 'extract' | 'chat';

export type AIContext = 'page' | 'all' | 'selection';

export type AIPanelMode = 'floating' | 'docked';
