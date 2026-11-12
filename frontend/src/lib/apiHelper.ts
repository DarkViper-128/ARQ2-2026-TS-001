/**
 * Extrae un arreglo de una respuesta de API que puede venir en varios formatos:
 * - Arreglo plano: [...]
 * - Objeto envuelto: { events: [...] } / { orders: [...] } / { tickets: [...] }
 * - Objeto singolo: { ... }
 */
export function extractList<T>(data: any): T[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    // Intentar propiedades comunes de envoltorio
    for (const key of ['events', 'orders', 'tickets', 'data', 'results', 'items']) {
      if (Array.isArray(data[key])) return data[key];
    }
    // Objeto singolo -> envolver en arreglo
    return [data];
  }
  return [];
}
