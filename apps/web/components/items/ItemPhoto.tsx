'use client';

import { ImageUpload } from '@/components/ImageUpload';
import { setItemImage } from '@/app/(tenant)/backoffice/items/actions';
import { PUBLIC_BUCKET } from '@/lib/storage';

export function ItemPhoto({ itemId, folder, value, previewUrl }: { itemId: string; folder: string; value: string | null; previewUrl: string | null }) {
  return <ImageUpload bucket={PUBLIC_BUCKET} folder={folder} base={itemId} value={value} previewUrl={previewUrl} label="Add photo" onChange={(p) => setItemImage(itemId, p)} />;
}
