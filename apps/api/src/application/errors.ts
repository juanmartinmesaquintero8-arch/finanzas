/** La entidad solicitada no existe (HTTP 404). */
export class EntityNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} no encontrada: ${id}`);
    this.name = 'EntityNotFoundError';
  }
}

/** La solicitud es inválida a nivel de aplicación, p. ej. horizonte excedido (HTTP 400). */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}
