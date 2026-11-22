# emdash-geo

Plugin de [EmDash CMS](https://emdashcms.com) para **SEO y GEO** (*generative engine optimization*): hace que un sitio sea legible para buscadores y para agentes de IA sin escribir nada a mano en cada proyecto.

EmDash ya resuelve una parte (sitemaps de colecciones, metadatos del `<head>`, verificación de Google y Bing, imagen social por defecto, búsqueda pública, WebMCP con `WebMcpSearch`). Este plugin añade lo que falta:

| Qué | Dónde |
| --- | --- |
| Cualquier página en Markdown, por negociación de contenido (`Accept: text/markdown`) o añadiendo `.md` | toda la web |
| Índice para modelos de lenguaje | `/llms.txt` |
| `robots.txt` con [Content Signals](https://contentsignals.org/), reglas para los rastreadores de IA y las imágenes abiertas | `/robots.txt` |
| Sitemap de portada y listados | `/sitemap-secciones.xml` |
| Cabeceras `Link` (RFC 8288) en las páginas HTML | toda la web |
| Catálogo de API (RFC 9727) y OpenAPI de la lectura pública | `/.well-known/api-catalog`, `/api/openapi.json` |
| Listados JSON de cada colección | `/api/<coleccion>.json` |
| Servidor MCP público de solo lectura (buscar, listar, leer en Markdown) | `/mcp` |
| Tarjeta del servidor MCP | `/.well-known/mcp/server-card.json` |
| Índice de habilidades para agentes y su `SKILL.md` | `/.well-known/agent-skills/` |
| Catálogo de recursos para agentes (ARD) | `/.well-known/ai-catalog.json` |
| `auth.md` y declaración Personal Agent Protocol | `/auth.md`, `/.well-known/poppy.json` |
| Constructores de datos estructurados (autoría, revisión experta, fuentes, migas, preguntas frecuentes) | `emdash-geo/schema` |

Con ello el sitio pasa las pruebas de [isitagentready.com](https://isitagentready.com) (Cloudflare) que tienen sentido para una web de contenido.

Todo lo que el plugin declara existe y funciona: no publica capacidades de pega. El servidor MCP de `/mcp` es distinto del MCP de EmDash (`/_emdash/api/mcp`), que es del equipo editorial y exige OAuth; este solo lee lo publicado y no pide credenciales.

## Instalación

```sh
pnpm add emdash-geo
```

Las opciones se comparten entre el descriptor y el envoltorio del Worker, así que conviene tenerlas en un fichero:

```ts
// src/geo.config.ts
import type { OpcionesGeo } from "emdash-geo";

export const GEO: OpcionesGeo = {
  sitio: {
    url: "https://ejemplo.com",
    nombre: "Huerto de Ana",
    descripcion: "Guías de huerto urbano escritas por una agrónoma.",
    busqueda: "/buscar?q=",
  },
  autor: {
    nombre: "Dra. Ana Ruiz",
    tratamiento: "Dra.",
    cargo: "Agrónoma",
    credencial: { nombre: "N.º de colegiada", valor: "123" },
    ruta: "/sobre-mi",
  },
  colecciones: {
    posts: { ruta: "/articulos/:slug", titulo: "Artículos", campoRevisado: "reviewed_at" },
  },
  paginas: [{ titulo: "Sobre mí", ruta: "/sobre-mi" }],
  secciones: ["/", "/articulos"],
};
```

```js
// astro.config.mjs
import { geo } from "emdash-geo";
import { GEO } from "./src/geo.config.ts";

emdash({ plugins: [geo(GEO)] });
// y en vite.ssr.noExternal: ["emdash-geo"]
```

```ts
// src/worker.ts
import handler from "@emdash-cms/cloudflare/worker";
import { withGeo } from "emdash-geo";
import { GEO } from "./geo.config";

export default { ...handler, fetch: withGeo(handler, GEO).fetch };
```

`withGeo` envuelve cualquier manejador con forma `fetch(request, env, ctx)`. Si el sitio usa otros envoltorios (por ejemplo `emdash-modo-liga`), `withGeo` va por dentro.

### En las plantillas

```astro
---
import { nodosSitio, paginaRevisada, migas, serializar } from "emdash-geo/schema";
import WebMcpSearch from "emdash/ui/webmcp-search";
import { GEO } from "../geo.config";
const grafo = serializar([...nodosSitio(GEO), paginaRevisada(GEO, { url, titulo, revisado })]);
---
<script type="application/ld+json" is:inline set:html={grafo} />
<link rel="alternate" type="text/markdown" href={`${Astro.url.pathname}.md`} />
<link rel="ai-catalog" href="/.well-known/ai-catalog.json" />
<WebMcpSearch collections={["posts"]} routeMap={{ posts: "/articulos/:slug" }} />
```

## Cómo funciona

- **`geo()`** registra un plugin nativo con una ruta pública, `/_emdash/api/plugins/geo/indice`, que lista lo publicado en las colecciones configuradas, y los ajustes de uso del contenido (buscadores, respuestas de IA, entrenamiento), editables en el panel.
- **`withGeo()`** responde a las rutas de la tabla y deja pasar el resto. El contenido lo obtiene llamando al propio sitio (el índice del plugin, la búsqueda de EmDash y las páginas HTML), siempre sin cookies ni credenciales: solo puede ver lo público.
- El Markdown sale del mismo HTML que ve una persona: se toma `<main>`, se quitan navegación, formularios y scripts, y se antepone una cabecera con título, descripción, URL canónica y autoría.

## Opciones

Están documentadas en `src/core/config.ts` (`OpcionesGeo`). Las principales: `sitio`, `autor`, `colecciones`, `paginas`, `secciones`, `senales`, `aviso`, `robots`, `mcp` (`false` lo desactiva), `editorial` y `prefijoApi`.

Los textos que genera el plugin (llms.txt, auth.md, descripciones de herramientas) están en español.

## Desarrollo

```sh
pnpm install
pnpm test        # node --test
pnpm run build   # tsc → dist/
```

## Licencia

MIT
