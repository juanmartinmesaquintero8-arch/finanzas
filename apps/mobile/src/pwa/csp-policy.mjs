/**
 * Política de seguridad de contenido (CSP) de la app del celular.
 * Le dice al navegador de dónde puede cargar cosas: solo del propio sitio.
 * Va en un <meta> porque GitHub Pages no permite enviar cabeceras propias; lo escribe
 * scripts/postbuild.mjs en cada página compilada (no el layout de React).
 *
 * - script-src: aquí solo 'self'. Los scripts en línea que Next escribe en cada página se autorizan
 *   por su huella (sha256) al compilar, en scripts/postbuild.mjs (injectContentSecurityPolicy). Un <meta>
 *   en un sitio estático no admite nonces, y nunca se usa 'unsafe-eval'.
 * - style-src: 'unsafe-inline' porque React escribe atributos style="..." en el HTML (p. ej. la barra
 *   de navegación de @finanzas/ui) y sus huellas exigirían 'unsafe-hashes'. Un estilo inyectado no
 *   puede ejecutar código; el riesgo es mucho menor que en scripts.
 * - img-src data: por imágenes pequeñas incrustadas; font-src 'self' porque Inter (next/font) se
 *   sirve desde el propio sitio.
 * - frame-ancestors no funciona dentro de un <meta>: por eso no se incluye.
 */
// Archivo .mjs (JavaScript puro) para que scripts/postbuild.mjs lo importe en Node sin avisos;
// el resto de la app lo usa con tipos a través de csp.ts.
const DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

export const CONTENT_SECURITY_POLICY = Object.entries(DIRECTIVES)
  .map(([name, sources]) => `${name} ${sources.join(' ')}`)
  .join('; ');
