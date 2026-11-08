/** Rango de un entero de 64 bits con signo: lo que la base de datos y la API pueden guardar. */
export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;

export const isInt64 = (value: bigint): boolean => value >= INT64_MIN && value <= INT64_MAX;

/** Largos máximos de texto al ESCRIBIR: los mismos de los formularios y de la API. */
export const MAX_TEXT = { id: 100, name: 80, description: 160, category: 60 } as const;

/** Largo máximo de texto al IMPORTAR una copia: con margen para copias ya guardadas con textos más largos. */
export const MAX_IMPORT_TEXT = 2000;
