// Punto de entrada que carga EmDash (formato native): `createPlugin(opciones)`.
// El plugin aporta el índice público de contenido que consume el envoltorio
// del Worker y los ajustes de uso del contenido editables desde el panel.
import { definePlugin, type PluginRoute, type ResolvedPlugin, type RouteContext } from "emdash";
import {
  ID_PLUGIN,
  origenDe,
  senalesDe,
  urlDeEntrada,
  VERSION,
  type ColeccionGeo,
  type Ficha,
  type Indice,
  type OpcionesGeo,
  type Senales,
} from "./core/config.ts";

export { ID_PLUGIN, VERSION };

export function esquemaAjustes(opciones: OpcionesGeo) {
  const s = senalesDe(opciones);
  return {
    search: {
      type: "boolean" as const,
      label: "Aparecer en buscadores",
      description: "Content-Signal search: permite indexar el sitio y mostrarlo en resultados.",
      default: s.search,
    },
    aiInput: {
      type: "boolean" as const,
      label: "Respuestas de asistentes de IA",
      description: "Content-Signal ai-input: los asistentes pueden usar el contenido para responder, citándolo.",
      default: s.aiInput,
    },
    aiTrain: {
      type: "boolean" as const,
      label: "Entrenamiento de modelos de IA",
      description: "Content-Signal ai-train: si se desactiva, robots.txt veta además a los rastreadores de entrenamiento.",
      default: s.aiTrain,
    },
  };
}

function fecha(valor: unknown): string | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function leerSenales(ctx: RouteContext, opciones: OpcionesGeo): Promise<Senales> {
  const ajustes: Partial<Senales> = {};
  for (const clave of ["search", "aiInput", "aiTrain"] as const) {
    try {
      const valor = await ctx.settings?.get(clave);
      if (typeof valor === "boolean") ajustes[clave] = valor;
    } catch {
      // Sin ajuste guardado: vale la opción del sitio.
    }
  }
  return senalesDe(opciones, ajustes);
}

async function listar(ctx: RouteContext, origen: string, clave: string, coleccion: ColeccionGeo): Promise<Ficha[]> {
  const fichas: Ficha[] = [];
  let cursor: string | undefined;
  do {
    const pagina = (await ctx.content!.list(clave, {
      limit: 100,
      where: { status: "published" },
      ...(cursor ? { cursor } : {}),
    })) as { items: Record<string, any>[]; nextCursor?: string | null };
    for (const item of pagina.items) {
      if (item.status && item.status !== "published") continue;
      const slug = String(item.slug ?? item.id);
      const datos = (item.data ?? {}) as Record<string, unknown>;
      const url = urlDeEntrada(origen, coleccion, slug);
      fichas.push({
        slug,
        titulo: String(datos.title ?? slug),
        resumen: String(datos[coleccion.campoResumen ?? "excerpt"] ?? "").trim(),
        url,
        markdown: `${url}.md`,
        publicado: fecha(item.publishedAt),
        actualizado: fecha(item.updatedAt),
        revisado: coleccion.campoRevisado ? fecha(datos[coleccion.campoRevisado]) : null,
      });
    }
    cursor = pagina.nextCursor ?? undefined;
  } while (cursor && fichas.length < 2000);
  if (coleccion.orden === "titulo") fichas.sort((a, b) => a.titulo.localeCompare(b.titulo));
  else fichas.sort((a, b) => (b.publicado ?? "").localeCompare(a.publicado ?? ""));
  return fichas;
}

export function createPlugin(opciones: OpcionesGeo): ResolvedPlugin {
  const origen = origenDe(opciones);
  const rutas: Record<string, PluginRoute> = {
    /** Pública y cacheable: lo publicado en las colecciones configuradas. */
    indice: {
      public: true,
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
      request: { body: "none" },
      handler: async (ctx: RouteContext): Promise<Indice> => {
        const colecciones: Record<string, Ficha[]> = {};
        for (const [clave, coleccion] of Object.entries(opciones.colecciones)) {
          try {
            colecciones[clave] = await listar(ctx, origen, clave, coleccion);
          } catch (error) {
            ctx.log.warn(`geo: no se pudo listar la colección ${clave}`, String(error));
            colecciones[clave] = [];
          }
        }
        return { senales: await leerSenales(ctx, opciones), colecciones };
      },
    },
  };
  return definePlugin({
    id: ID_PLUGIN,
    version: VERSION,
    capabilities: ["content:read"],
    routes: rutas,
    admin: { settingsSchema: esquemaAjustes(opciones) },
  });
}
