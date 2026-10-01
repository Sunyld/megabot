import type { Href } from 'expo-router';

import type { EntityRef } from '@/types';

/** Maps a backend entity reference (notification / activity target) to a route. */
export function hrefFor(ref: EntityRef): Href {
  switch (ref.type) {
    case 'order':
      return { pathname: '/orders/[id]', params: { id: ref.id } };
    case 'payment':
      return { pathname: '/payments/[id]', params: { id: ref.id } };
    case 'device':
      return { pathname: '/devices/[id]', params: { id: ref.id } };
    case 'sim':
      return { pathname: '/sims', params: { focus: ref.id } };
    case 'conversation':
      return { pathname: '/whatsapp/[id]', params: { id: ref.id } };
    case 'task':
      return '/automation';
    case 'whatsapp':
      return '/whatsapp';
    case 'automation':
      return '/automation';
  }
}
