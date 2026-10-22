import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LaneOS',
    short_name: 'LaneOS',
    start_url: '/lane',
    display: 'standalone',
    background_color: '#f4f6f8',
    theme_color: '#0b1f1a',
  };
}
