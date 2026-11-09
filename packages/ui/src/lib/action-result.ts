/** Resultado serializable de una Server Action (nunca lanza al cliente). */
export type ActionResult = { ok: true; notice?: string } | { ok: false; error: string };
