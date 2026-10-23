import type { Tone } from '@laneos/ui';

export const ROLE_TONE: Record<string, Tone> = { owner: 'success', manager: 'info', cashier: 'neutral', stock_keeper: 'warning', accountant: 'brand' };

/** Roles the business requires 2-step verification for (tenants.require_2fa, blueprint §27.6). */
export const needs2fa = (rule: string, role: string) => rule === 'all' || role === 'owner' || (rule === 'managers' && role === 'manager');
