// IndexNow (indexnow.org): avisa a los buscadores (Bing, Yandex, Seznam…) de
// que una URL ha cambiado. La clave es pública por diseño: se sirve en
// /<clave>.txt para demostrar que el sitio es nuestro, así que va en las
// opciones y no en un secreto.
import { origenDe, urlDeEntrada, type OpcionesGeo } from "./config.ts";

export const API_INDEXNOW = "https://api.indexnow.org/indexnow";
export const HOST_INDEXNOW = "api.indexnow.org";

const CLAVE_VALIDA = /^[a-zA-Z0-9-]{8,128}$/;

/** La clave configurada, validada; `null` si IndexNow no está activo. */
export function claveIndexNow(opciones: OpcionesGeo): string | null {
  if (opciones.indexnow === undefined) return null;
  const clave = opciones.indexnow?.clave;
  if (typeof clave !== "string" || !CLAVE_VALIDA.test(clave)) {
    throw new Error("emdash-geo: indexnow.clave debe tener entre 8 y 128 caracteres de [a-zA-Z0-9-]");
  }
  return clave;
}

/** Ruta pública del fichero de la clave («/<clave>.txt»). */
export function rutaClaveIndexNow(clave: string): string {
  return `/${clave}.txt`;
}

export interface AvisoIndexNow {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** Cuerpo JSON del aviso para una lista de URL del propio sitio. */
export function cuerpoIndexNow(opciones: OpcionesGeo, clave: string, urls: string[]): AvisoIndexNow {
  const origen = origenDe(opciones);
  return {
    host: new URL(origen).host,
    key: clave,
    keyLocation: `${origen}${rutaClaveIndexNow(clave)}`,
    urlList: urls,
  };
}

/**
 * Envía el aviso. No lanza nunca: devuelve el código HTTP (200 o 202 es que
 * se aceptó) o `null` si la petición no llegó a salir.
 */
export async function avisarIndexNow(
  fetchar: (url: string, init?: RequestInit) => Promise<Response>,
  opciones: OpcionesGeo,
  clave: string,
  urls: string[],
): Promise<number | null> {
  if (urls.length === 0) return null;
  try {
    const r = await fetchar(API_INDEXNOW, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(cuerpoIndexNow(opciones, clave, urls)),
    });
    return r.status;
  } catch {
    return null;
  }
}

// ── Ganchos del plugin ──
// Tipos mínimos y estructurales para no importar EmDash desde core (así se
// prueban sin él). Coinciden con los eventos de EmDash 1.6.0:
// `content:afterPublish`/`afterUnpublish` → { content, collection } con
// `content.slug` en el primer nivel; `content:beforeDelete`/`afterDelete` →
// { id, collection, permanent }.

interface CtxIndexNow {
  http?: { fetch(url: string, init?: RequestInit): Promise<Response> };
  content?: { get(collection: string, id: string): Promise<{ slug: string | null; status: string } | null> };
  log: { info(m: string, d?: unknown): void; warn(m: string, d?: unknown): void };
}

/** URL pública de una entrada de una colección configurada, o `null`. */
export function urlIndexNow(opciones: OpcionesGeo, coleccion: string, slug: unknown): string | null {
  const config = opciones.colecciones[coleccion];
  if (!config || typeof slug !== "string" || slug === "") return null;
  return urlDeEntrada(origenDe(opciones), config, slug);
}

/**
 * Ganchos de IndexNow para `definePlugin({ hooks })`, o `null` si no está
 * activo. Nunca bloquean ni cancelan: los errores solo se anotan en el log.
 */
export function ganchosIndexNow(opciones: OpcionesGeo) {
  const clave = claveIndexNow(opciones);
  if (!clave) return null;
  // URL de lo que se está borrando, entre `beforeDelete` y `afterDelete`
  // (este último solo trae el id y la entrada ya está en la papelera).
  const borrando = new Map<string, string>();

  const avisar = async (ctx: CtxIndexNow, url: string, motivo: string) => {
    if (!ctx.http) {
      ctx.log.warn("geo: IndexNow sin acceso a la red (falta network:request)");
      return;
    }
    const estado = await avisarIndexNow((u, i) => ctx.http!.fetch(u, i), opciones, clave, [url]);
    if (estado === 200 || estado === 202) ctx.log.info(`geo: IndexNow ${motivo} ${url} → ${estado}`);
    else ctx.log.warn(`geo: IndexNow ${motivo} ${url} → ${estado ?? "sin respuesta"}`);
  };

  const alCambiar = (motivo: string) => ({
    timeout: 5_000,
    errorPolicy: "continue" as const,
    handler: async (event: { content: Record<string, unknown>; collection: string }, ctx: CtxIndexNow) => {
      const url = urlIndexNow(opciones, event.collection, event.content.slug);
      if (url) await avisar(ctx, url, motivo);
    },
  });

  return {
    "content:afterPublish": alCambiar("publicada"),
    "content:afterUnpublish": alCambiar("despublicada"),
    "content:beforeDelete": {
      // Corre antes de borrar y lo retrasa: rápido, y nunca devuelve `false`.
      timeout: 2_000,
      errorPolicy: "continue" as const,
      handler: async (event: { id: string; collection: string }, ctx: CtxIndexNow): Promise<void> => {
        if (!opciones.colecciones[event.collection] || !ctx.content) return;
        try {
          const item = await ctx.content.get(event.collection, event.id);
          const url = item?.status === "published" ? urlIndexNow(opciones, event.collection, item.slug) : null;
          if (url) borrando.set(`${event.collection}:${event.id}`, url);
        } catch {
          // Sin la entrada no hay URL que avisar.
        }
      },
    },
    "content:afterDelete": {
      timeout: 5_000,
      errorPolicy: "continue" as const,
      handler: async (event: { id: string; collection: string; permanent: boolean }, ctx: CtxIndexNow) => {
        const entrada = `${event.collection}:${event.id}`;
        const url = borrando.get(entrada);
        borrando.delete(entrada);
        if (url) await avisar(ctx, url, "borrada");
      },
    },
  };
}
