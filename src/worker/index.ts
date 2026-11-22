// Envoltorio del manejador `fetch` del sitio. Sirve los documentos de
// descubrimiento, el servidor MCP público, la versión Markdown de las páginas
// (negociación de contenido) y añade las cabeceras Link. Todo lo demás pasa
// intacto al manejador de EmDash.
//
// No importa nada de EmDash: el contenido lo obtiene llamando al propio
// manejador (la ruta pública `indice` del plugin, la búsqueda y las páginas).
import {
  contentSignal,
  nombrePublico,
  origenDe,
  prefijoApi,
  RUTA_INDICE,
  senalesDe,
  urlDeEntrada,
  type Indice,
  type OpcionesGeo,
} from "../core/config.ts";
import {
  authMd,
  cabeceraLink,
  catalogoApi,
  catalogoIa,
  habilidadMd,
  indiceHabilidades,
  llmsTxt,
  openApi,
  poppy,
  robotsTxt,
  rutaHabilidad,
  sitemapSecciones,
  tarjetaMcp,
  TIPO_OPENAPI,
} from "../core/documentos.ts";
import { esPagina, htmlAMarkdown } from "../core/markdown.ts";
import { atenderMcp, type FuentesMcp } from "../core/mcp.ts";

export interface ManejadorFetch<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx: any) => Response | Promise<Response>;
}

export interface ManejadorEnvuelto<Env = unknown> {
  fetch: (request: Request, env: Env, ctx: any) => Promise<Response>;
}

export interface OpcionesWorkerGeo {
  /** Segundos que se guarda en memoria el índice de contenido (por defecto 60). */
  cacheIndice?: number;
  /** Reloj inyectable para pruebas. */
  ahora?: () => number;
}

const CACHE = "public, max-age=300";
const CABECERAS_JSON = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": CACHE };
const CABECERAS_MD = { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": CACHE };

const json = (datos: unknown, cabeceras: Record<string, string> = {}) =>
  new Response(JSON.stringify(datos, null, 2), { headers: { ...CABECERAS_JSON, ...cabeceras } });
const markdown = (texto: string, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(texto, { status: init.status ?? 200, headers: { ...CABECERAS_MD, ...init.headers } });

function sinCuerpo(respuesta: Response): Response {
  return new Response(null, { status: respuesta.status, headers: respuesta.headers });
}

export function withGeo<Env = unknown>(
  manejador: ManejadorFetch<Env>,
  opciones: OpcionesGeo,
  ajustes: OpcionesWorkerGeo = {},
): ManejadorEnvuelto<Env> {
  const base = manejador.fetch;
  if (!base) throw new Error("withGeo: el handler no tiene fetch");
  const origen = origenDe(opciones);
  const api = prefijoApi(opciones);
  const ahora = ajustes.ahora ?? (() => Date.now());
  const vidaIndice = (ajustes.cacheIndice ?? 60) * 1000;
  let cache: { hasta: number; indice: Indice } | null = null;

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const ruta = url.pathname;
      const metodo = request.method;

      /** Petición interna al sitio, sin cookies ni credenciales: solo lo público. */
      const interno = (destino: string, accept: string) =>
        Promise.resolve(base.call(manejador, new Request(new URL(destino, url), { headers: { accept } }), env, ctx));

      const indice = async (): Promise<Indice> => {
        if (cache && cache.hasta > ahora()) return cache.indice;
        let leido: Indice = { senales: senalesDe(opciones), colecciones: {} };
        try {
          const r = await interno(RUTA_INDICE, "application/json");
          if (r.ok) {
            const cuerpo = (await r.json()) as { data?: Indice } & Partial<Indice>;
            const datos = cuerpo.data ?? cuerpo;
            if (datos.colecciones) leido = { senales: datos.senales ?? leido.senales, colecciones: datos.colecciones };
            cache = { hasta: ahora() + vidaIndice, indice: leido };
          }
        } catch {
          // Sin índice (plugin sin activar, base de datos sin iniciar): documentos sin listados.
        }
        return leido;
      };

      const leer = async (rutaPagina: string): Promise<string | null> => {
        if (!esPagina(rutaPagina, api)) return null;
        const r = await interno(rutaPagina, "text/html");
        if (!r.ok || !(r.headers.get("content-type") ?? "").includes("text/html")) return null;
        return htmlAMarkdown(await r.text(), opciones, rutaPagina).markdown;
      };

      // ── Servidor MCP público ──
      if (ruta === "/mcp" && opciones.mcp !== false) {
        const fuentes: FuentesMcp = {
          leer,
          listar: async (clave) => (await indice()).colecciones[clave] ?? [],
          buscar: async (consulta, limite) => {
            const claves = Object.keys(opciones.colecciones);
            const r = await interno(
              `/_emdash/api/search?q=${encodeURIComponent(consulta)}&collections=${claves.join(",")}&limit=${limite}`,
              "application/json",
            );
            if (!r.ok) return [];
            const cuerpo = (await r.json()) as { data?: { items?: Record<string, unknown>[] } };
            return (cuerpo.data?.items ?? []).flatMap((item) => {
              const coleccion = opciones.colecciones[String(item.collection)];
              if (!coleccion) return [];
              return [
                {
                  coleccion: coleccion.titulo,
                  titulo: String(item.title ?? ""),
                  url: urlDeEntrada(origen, coleccion, String(item.slug ?? item.id ?? "")),
                  fragmento: String(item.snippet ?? "").replace(/<\/?mark>/g, ""),
                },
              ];
            });
          },
        };
        return atenderMcp(request, opciones, fuentes);
      }

      if (metodo !== "GET" && metodo !== "HEAD") return base.call(manejador, request, env, ctx);
      const responder = (r: Response) => (metodo === "HEAD" ? sinCuerpo(r) : r);

      // ── Documentos de descubrimiento ──
      switch (ruta) {
        case "/robots.txt":
          return responder(
            new Response(robotsTxt(opciones, (await indice()).senales), {
              headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
            }),
          );
        case "/llms.txt":
          return responder(markdown(llmsTxt(opciones, await indice())));
        case "/sitemap-secciones.xml":
          return responder(
            new Response(sitemapSecciones(opciones, await indice()), {
              headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
            }),
          );
        case "/.well-known/api-catalog":
          return responder(
            json(catalogoApi(opciones), {
              "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
              Link: `<${origen}/.well-known/api-catalog>; rel="api-catalog"`,
            }),
          );
        case "/.well-known/mcp/server-card.json":
        case "/.well-known/mcp.json":
          if (opciones.mcp === false) break;
          return responder(json(tarjetaMcp(opciones)));
        case "/.well-known/agent-skills/index.json":
          return responder(json(await indiceHabilidades(opciones)));
        case "/.well-known/ai-catalog.json":
          return responder(json(catalogoIa(opciones, await indice())));
        case "/.well-known/poppy.json":
          return responder(json(poppy(opciones)));
        case "/auth.md":
          return responder(markdown(authMd(opciones)));
        case "/.well-known/oauth-authorization-server":
          // Alias sin sufijo de los metadatos OAuth de EmDash (emisor /_emdash):
          // hay clientes que solo prueban la ruta raíz de RFC 8414.
          if (opciones.editorial === false) break;
          return interno("/.well-known/oauth-authorization-server/_emdash", "application/json");
        case `${api}/openapi.json`:
          return responder(json(openApi(opciones), { "Content-Type": `${TIPO_OPENAPI}; charset=utf-8` }));
        default:
          if (ruta === rutaHabilidad(opciones)) return responder(markdown(habilidadMd(opciones)));
      }
      for (const [clave, coleccion] of Object.entries(opciones.colecciones)) {
        if (ruta === `${api}/${nombrePublico(clave, coleccion)}.json`) {
          const items = (await indice()).colecciones[clave] ?? [];
          return responder(json({ total: items.length, items }));
        }
      }

      // ── Markdown por negociación de contenido o sufijo .md ──
      const pideMd = ruta.endsWith(".md");
      const rutaPagina = pideMd ? (ruta === "/index.md" ? "/" : ruta.slice(0, -3)) : ruta;
      if (!esPagina(rutaPagina, api)) return base.call(manejador, request, env, ctx);

      const aceptaMd = (request.headers.get("accept") ?? "").toLowerCase().includes("text/markdown");
      if (pideMd || aceptaMd) {
        const pagina = await interno(rutaPagina + url.search, "text/html");
        if (!(pagina.headers.get("content-type") ?? "").includes("text/html")) return pagina;
        if (pagina.status === 404) {
          return responder(
            markdown(`# No encontrada\n\nNo hay ninguna página en ${origen}${rutaPagina}. Índice del sitio: ${origen}/llms.txt\n`, {
              status: 404,
              headers: { Vary: "Accept", "Cache-Control": "no-store" },
            }),
          );
        }
        if (!pagina.ok) return pagina;
        const { markdown: texto, tokens } = htmlAMarkdown(await pagina.text(), opciones, rutaPagina);
        return responder(
          markdown(texto, {
            headers: {
              Vary: "Accept",
              "x-markdown-tokens": String(tokens),
              "Content-Signal": contentSignal((await indice()).senales),
              Link: `<${origen}${rutaPagina}>; rel="canonical"`,
            },
          }),
        );
      }

      // ── Páginas HTML: cabeceras Link (RFC 8288) ──
      const respuesta = await base.call(manejador, request, env, ctx);
      if (!respuesta.ok || !(respuesta.headers.get("content-type") ?? "").includes("text/html")) return respuesta;
      const headers = new Headers(respuesta.headers);
      headers.append("Link", cabeceraLink(opciones, rutaPagina));
      headers.append("Vary", "Accept");
      return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers });
    },
  };
}
