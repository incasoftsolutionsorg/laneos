import type { Tone } from '@laneos/ui';

/** Badge colours for tenant status in the platform admin. */
export const STATUS_TONE: Record<string, Tone> = { trial: 'info', active: 'success', past_due: 'warning', suspended: 'danger', cancelled: 'neutral' };
