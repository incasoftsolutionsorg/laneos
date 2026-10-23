import type { Tone } from '@laneos/ui';

export const PO_STATUS: Record<string, [string, Tone]> = {
  draft: ['Draft', 'neutral'], sent: ['Sent', 'info'], partially_received: ['Partially received', 'warning'],
  received: ['Received', 'success'], cancelled: ['Cancelled', 'neutral'],
};
