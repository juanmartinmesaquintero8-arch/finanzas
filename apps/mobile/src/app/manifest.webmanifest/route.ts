import { BASE_PATH } from '@/pwa/base-path';
import { buildManifest } from '@/pwa/manifest';

// Con `output: 'export'` esto se escribe como un archivo estático al compilar.
export const dynamic = 'force-static';

export function GET() {
  return new Response(JSON.stringify(buildManifest(BASE_PATH)), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}
