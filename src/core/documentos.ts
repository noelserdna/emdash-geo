// Documentos de descubrimiento para buscadores y agentes de IA. Funciones puras:
// reciben las opciones y el índice de contenido y devuelven texto u objetos.
// Todo lo que declaran existe: la versión Markdown de las páginas, la búsqueda
// pública de EmDash, los listados JSON y el servidor MCP de solo lectura.
import {
  contentSignal,
  firmaAutor,
  nombrePublico,
  origenDe,
  prefijoApi,
  VERSION,
  type Ficha,
  type Indice,
  type OpcionesGeo,
  type Senales,
} from "./config.ts";

/** Rastreadores y agentes de IA a los que se nombra expresamente en robots.txt. */
export const BOTS_IA = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "meta-externalagent",
  "MistralAI-User",
  "DuckAssistBot",
  "CCBot",
] as const;

/** Rastreadores de entrenamiento (lista del robots.txt gestionado de Cloudflare). */
const BOTS_ENTRENAMIENTO = new Set([
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "Google-Extended",
  "GPTBot",
  "meta-externalagent",
]);

export const TIPO_OPENAPI = "application/vnd.oai.openapi+json;version=3.1";

const aviso = (o: OpcionesGeo) => (o.aviso ? ` ${o.aviso}` : "");
const idioma = (o: OpcionesGeo) => o.sitio.idioma ?? "es";
const mcpActivo = (o: OpcionesGeo) => o.mcp !== false;

export function nombreHabilidad(o: OpcionesGeo): string {
  const dominio = new URL(origenDe(o)).hostname.replace(/^www\./, "");
  return `consultar-${dominio.replace(/[^a-z0-9]+/g, "-")}`;
}

export function robotsTxt(o: OpcionesGeo, senales: Senales): string {
  const origen = origenDe(o);
  const reglas = [
    `Content-Signal: ${contentSignal(senales)}`,
    "Allow: /",
    // Las imágenes del contenido viven bajo /_emdash/api/media/.
    "Allow: /_emdash/api/media/",
    ...(o.robots?.permitir ?? []).map((r) => `Allow: ${r}`),
    "Disallow: /_emdash/",
    ...(o.robots?.bloquear ?? []).map((r) => `Disallow: ${r}`),
  ];
  const permitidos = BOTS_IA.filter((b) => senales.aiTrain || !BOTS_ENTRENAMIENTO.has(b));
  const vetados = [...BOTS_ENTRENAMIENTO].filter(() => !senales.aiTrain);
  return [
    `# ${origen} — ${o.sitio.nombre}`,
    "# Preferencias de uso del contenido según https://contentsignals.org/",
    "",
    "User-agent: *",
    ...reglas,
    "",
    "# Buscadores y asistentes de IA: mismo trato, dicho expresamente.",
    ...permitidos.map((bot) => `User-agent: ${bot}`),
    ...reglas,
    ...(vetados.length > 0
      ? ["", "# Rastreadores de entrenamiento de modelos: no.", ...vetados.map((bot) => `User-agent: ${bot}`), "Disallow: /"]
      : []),
    "",
    `Sitemap: ${origen}/sitemap.xml`,
    `Sitemap: ${origen}/sitemap-secciones.xml`,
    ...(o.robots?.sitemaps ?? []).map((s) => `Sitemap: ${s}`),
    "",
    "# Catálogo de recursos para agentes (ARD)",
    `Agentmap: ${origen}/.well-known/ai-catalog.json`,
    "",
  ].join("\n");
}

export interface Herramienta {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; openWorldHint: false };
}

const SOLO_LECTURA = { readOnlyHint: true, openWorldHint: false } as const;
const SIN_ARGUMENTOS = { type: "object", properties: {}, additionalProperties: false };

export function herramientasMcp(o: OpcionesGeo): Herramienta[] {
  const secciones = Object.values(o.colecciones).map((c) => c.titulo.toLowerCase());
  const ejemplo = Object.values(o.colecciones)[0]?.ruta.replace(":slug", "<slug>") ?? "/pagina";
  return [
    {
      name: "buscar",
      title: "Buscar en la web",
      description: `Busca en ${o.sitio.nombre} (${secciones.join(", ")}). Devuelve títulos, URL y fragmentos.`,
      inputSchema: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Palabras que buscar." },
          limite: { type: "integer", minimum: 1, maximum: 20, description: "Máximo de resultados (10 por defecto)." },
        },
        required: ["consulta"],
        additionalProperties: false,
      },
      annotations: SOLO_LECTURA,
    },
    ...Object.entries(o.colecciones).map(([clave, c]) => ({
      name: `listar_${nombrePublico(clave, c)}`,
      title: `Listar: ${c.titulo}`,
      description: `${c.descripcion ?? c.titulo}. Lista lo publicado con título, resumen, URL y fechas.`,
      inputSchema: SIN_ARGUMENTOS,
      annotations: SOLO_LECTURA,
    })),
    {
      name: "leer_pagina",
      title: "Leer una página en Markdown",
      description: `Devuelve en Markdown el texto completo de una página pública de la web, por ejemplo ${ejemplo}.`,
      inputSchema: {
        type: "object",
        properties: { ruta: { type: "string", description: "Ruta o URL de la página." } },
        required: ["ruta"],
        additionalProperties: false,
      },
      annotations: SOLO_LECTURA,
    },
  ];
}

export function instruccionesMcp(o: OpcionesGeo): string {
  const firma = firmaAutor(o.autor);
  return `${o.sitio.descripcion}${firma ? ` Autoría: ${firma}.` : ""} Solo lectura y sin credenciales. Al usar el contenido, cita la URL de la página${firma ? " y a su autora o autor" : ""}.${aviso(o)}`;
}

export function infoServidor(o: OpcionesGeo) {
  const propio = o.mcp === false ? undefined : o.mcp;
  const dominio = new URL(origenDe(o)).hostname.replace(/^www\./, "");
  return {
    name: propio?.nombre ?? dominio.replace(/[^a-z0-9]+/g, "-"),
    title: o.sitio.nombre,
    version: propio?.version ?? VERSION,
  };
}

export function tarjetaMcp(o: OpcionesGeo) {
  const origen = origenDe(o);
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
    version: "1.0",
    protocolVersion: "2025-06-18",
    serverInfo: infoServidor(o),
    description: o.sitio.descripcion,
    documentationUrl: `${origen}/llms.txt`,
    transport: { type: "streamable-http", endpoint: `${origen}/mcp` },
    endpoint: `${origen}/mcp`,
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false, schemes: [] },
    instructions: instruccionesMcp(o),
    tools: herramientasMcp(o).map(({ name, title, description }) => ({ name, title, description })),
  };
}

export function descripcionHabilidad(o: OpcionesGeo): string {
  return `Consultar y citar el contenido de ${o.sitio.nombre} (${new URL(origenDe(o)).hostname}): ${o.sitio.descripcion}`;
}

/** Habilidad publicada para agentes: cómo consultar y citar esta web. */
export function habilidadMd(o: OpcionesGeo): string {
  const origen = origenDe(o);
  const firma = firmaAutor(o.autor);
  const api = prefijoApi(o);
  const claves = Object.keys(o.colecciones).join(",");
  const listados = Object.entries(o.colecciones)
    .map(([clave, c]) => `\`${origen}${api}/${nombrePublico(clave, c)}.json\``)
    .join(", ");
  const ejemplo = Object.values(o.colecciones)[0]?.ruta.replace(":slug", "ejemplo") ?? "/pagina";
  const pasos = [
    `Índice del sitio: \`${origen}/llms.txt\`.`,
    `Cualquier página en Markdown: añade \`.md\` a su URL (\`${origen}${ejemplo}.md\`) o pide la URL normal con la cabecera \`Accept: text/markdown\`.`,
    `Búsqueda: \`GET ${origen}/_emdash/api/search?q=<palabras>&collections=${claves}\` (JSON).`,
    `Listados en JSON: ${listados}.`,
    ...(mcpActivo(o)
      ? [`Servidor MCP de solo lectura, sin credenciales: \`${origen}/mcp\` (herramientas ${herramientasMcp(o).map((h) => `\`${h.name}\``).join(", ")}).`]
      : []),
  ];
  return `---
name: ${nombreHabilidad(o)}
description: ${descripcionHabilidad(o).replace(/\n/g, " ")}
---

# Consultar ${new URL(origen).hostname}

${o.sitio.descripcion}${firma ? `\n\nAutoría: ${firma}.` : ""}

## Cómo leer el contenido

${pasos.map((p, i) => `${i + 1}. ${p}`).join("\n")}

## Cómo usarlo bien

- Cita siempre la URL de la página${firma ? " y a su autora o autor" : ""}.
- Respeta las fechas de publicación y de revisión que acompañan a cada texto.
- No atribuyas a la web afirmaciones que no estén en sus páginas.${o.aviso ? `\n- ${o.aviso}` : ""}
`;
}

export async function sha256(texto: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function rutaHabilidad(o: OpcionesGeo): string {
  return `/.well-known/agent-skills/${nombreHabilidad(o)}/SKILL.md`;
}

export async function indiceHabilidades(o: OpcionesGeo) {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: nombreHabilidad(o),
        type: "skill-md",
        description: descripcionHabilidad(o),
        url: rutaHabilidad(o),
        digest: `sha256:${await sha256(habilidadMd(o))}`,
      },
    ],
  };
}

/** Catálogo de API (RFC 9727). */
export function catalogoApi(o: OpcionesGeo) {
  const origen = origenDe(o);
  const api = prefijoApi(o);
  return {
    linkset: [
      {
        anchor: `${origen}${api}/`,
        "service-desc": [{ href: `${origen}${api}/openapi.json`, type: TIPO_OPENAPI }],
        "service-doc": [{ href: `${origen}/llms.txt`, type: "text/markdown" }],
        status: [{ href: `${origen}/_emdash/api/health`, type: "application/json" }],
      },
      ...(mcpActivo(o)
        ? [
            {
              anchor: `${origen}/mcp`,
              "service-desc": [{ href: `${origen}/.well-known/mcp/server-card.json`, type: "application/json" }],
              "service-doc": [{ href: `${origen}${rutaHabilidad(o)}`, type: "text/markdown" }],
            },
          ]
        : []),
    ],
  };
}

/** Preguntas de ejemplo para los catálogos: los títulos de lo publicado. */
function consultas(indice: Indice, max = 4): string[] {
  const titulos = Object.values(indice.colecciones).flatMap((fichas) => fichas.slice(0, 2).map((f) => f.titulo));
  return titulos.slice(0, max);
}

/** Catálogo de recursos para agentes (ARD, /.well-known/ai-catalog.json). */
export function catalogoIa(o: OpcionesGeo, indice: Indice) {
  const origen = origenDe(o);
  const dominio = new URL(origen).hostname;
  const urn = (espacio: string, nombre: string) => `urn:air:${dominio}:${espacio}:${nombre}`;
  const ejemplos = consultas(indice);
  const preguntas = ejemplos.length >= 2 ? ejemplos : [o.sitio.nombre, o.sitio.descripcion.slice(0, 120)];
  return {
    specVersion: "1.0",
    host: { displayName: o.sitio.nombre, identifier: origen, documentationUrl: `${origen}/llms.txt` },
    entries: [
      ...(mcpActivo(o)
        ? [
            {
              identifier: urn("server", infoServidor(o).name),
              displayName: `Servidor MCP de lectura: ${o.sitio.nombre}`,
              description: "Buscar y leer el contenido publicado. Solo lectura, sin credenciales.",
              type: "application/mcp-server-card+json",
              url: `${origen}/.well-known/mcp/server-card.json`,
              representativeQueries: preguntas,
            },
          ]
        : []),
      {
        identifier: urn("api", "contenido"),
        displayName: "API de lectura del contenido",
        description: "Búsqueda y listados en JSON, y cada página en Markdown.",
        type: TIPO_OPENAPI,
        url: `${origen}${prefijoApi(o)}/openapi.json`,
        representativeQueries: preguntas,
      },
      {
        identifier: urn("skill", nombreHabilidad(o)),
        displayName: `Habilidad: consultar y citar ${dominio}`,
        description: descripcionHabilidad(o),
        type: "text/markdown",
        url: `${origen}${rutaHabilidad(o)}`,
        representativeQueries: preguntas,
      },
      {
        identifier: urn("doc", "llms-txt"),
        displayName: "Índice del sitio para modelos de lenguaje (llms.txt)",
        description: "Lista del contenido publicado con enlace a su versión Markdown.",
        type: "text/markdown",
        url: `${origen}/llms.txt`,
        representativeQueries: preguntas,
      },
    ],
  };
}

/** OpenAPI 3.1 de la superficie pública de lectura. */
export function openApi(o: OpcionesGeo) {
  const origen = origenDe(o);
  const api = prefijoApi(o);
  const claves = Object.keys(o.colecciones);
  const fecha = { type: ["string", "null"], format: "date-time" };
  const listados = Object.fromEntries(
    Object.entries(o.colecciones).map(([clave, c]) => [
      `${api}/${nombrePublico(clave, c)}.json`,
      {
        get: {
          operationId: `listar_${nombrePublico(clave, c)}`,
          summary: c.descripcion ?? c.titulo,
          responses: {
            "200": {
              description: `${c.titulo}: lo publicado.`,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { total: { type: "integer" }, items: { type: "array", items: { $ref: "#/components/schemas/Ficha" } } },
                  },
                },
              },
            },
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: `${o.sitio.nombre} — API de lectura`,
      version: VERSION,
      description: `${o.sitio.descripcion} API pública de solo lectura, sin credenciales. Cita la URL de la página al usar el contenido.${aviso(o)}`,
    },
    servers: [{ url: origen }],
    externalDocs: { description: "Índice del sitio (llms.txt)", url: `${origen}/llms.txt` },
    paths: {
      ...listados,
      "/_emdash/api/search": {
        get: {
          operationId: "buscar",
          summary: "Búsqueda de texto completo en el contenido publicado",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Palabras que buscar." },
            {
              name: "collections",
              in: "query",
              schema: { type: "string", default: claves.join(",") },
              description: `Colecciones separadas por comas: ${Object.entries(o.colecciones).map(([k, c]) => `${k} (${c.ruta})`).join(", ")}.`,
            },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 10 } },
          ],
          responses: {
            "200": {
              description: "Resultados ordenados por relevancia.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "object",
                        properties: {
                          items: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                collection: { type: "string", enum: claves },
                                slug: { type: "string" },
                                title: { type: "string" },
                                snippet: { type: "string", description: "Fragmento con <mark> en las coincidencias." },
                                score: { type: "number" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/{ruta}.md": {
        get: {
          operationId: "leerPaginaMarkdown",
          summary: "Cualquier página pública en Markdown",
          description: "Añade .md a la ruta de una página. También vale pedir la URL normal con Accept: text/markdown.",
          parameters: [{ name: "ruta", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "La página en Markdown.", content: { "text/markdown": { schema: { type: "string" } } } },
            "404": { description: "No existe." },
          },
        },
      },
      "/_emdash/api/health": {
        get: { operationId: "estado", summary: "Estado del servicio", responses: { "200": { description: "En servicio." } } },
      },
    },
    components: {
      schemas: {
        Ficha: {
          type: "object",
          properties: {
            slug: { type: "string" },
            titulo: { type: "string" },
            resumen: { type: "string" },
            url: { type: "string", format: "uri" },
            markdown: { type: "string", format: "uri", description: "La misma página en Markdown." },
            publicado: fecha,
            actualizado: fecha,
            revisado: { ...fecha, description: "Fecha de la revisión experta, si la hay." },
          },
        },
      },
    },
  };
}

/** auth.md: cómo se autentican los agentes. Para leer, no hace falta. */
export function authMd(o: OpcionesGeo): string {
  const origen = origenDe(o);
  const dominio = new URL(origen).hostname;
  const editorial =
    o.editorial === false
      ? ""
      : `
## Acceso editorial (solo el equipo de la web)

La gestión del contenido se hace por el servidor MCP del gestor, \`${origen}/_emdash/api/mcp\`, protegido con OAuth 2.1:

- Metadatos del recurso protegido (RFC 9728): \`${origen}/.well-known/oauth-protected-resource\`.
- Servidor de autorización (RFC 8414), emisor \`${origen}/_emdash\`: \`${origen}/.well-known/oauth-authorization-server/_emdash\`.
- Método: código de autorización con PKCE (S256) o flujo de dispositivo; los clientes se registran de forma dinámica en el \`registration_endpoint\` de esos metadatos.
- Credencial: token de portador en la cabecera \`Authorization: Bearer <token>\`.

Ese acceso exige que una persona del equipo editorial inicie sesión y apruebe los permisos. No se conceden cuentas a agentes de terceros ni hay alta automática.
`;
  return `# auth.md — ${dominio}

Guía para agentes de IA sobre el acceso a ${origen}.

## El contenido público no necesita credenciales

Todo lo que publica esta web se lee sin registro, sin clave y sin token:

- Páginas en HTML o en Markdown (añade \`.md\` a la URL o envía \`Accept: text/markdown\`).
- Índice: \`${origen}/llms.txt\`.
- Búsqueda y listados en JSON: descritos en \`${origen}${prefijoApi(o)}/openapi.json\`.${mcpActivo(o) ? `\n- Servidor MCP de solo lectura: \`${origen}/mcp\`.` : ""}

No existe registro de agentes para el contenido público porque no hace falta: no hay nada que reclamar ni credencial que emitir. Usa un \`User-Agent\` que te identifique y respeta \`${origen}/robots.txt\`.
${editorial}`;
}

/** Personal Agent Protocol: declaración de solo web, sin sesiones ni API con cuenta. */
export function poppy(o: OpcionesGeo) {
  return {
    protocol_version: "0.1",
    organization: { name: o.sitio.nombre, domain: new URL(origenDe(o)).hostname.replace(/^www\./, "") },
    web: {},
  };
}

export function llmsTxt(o: OpcionesGeo, indice: Indice): string {
  const origen = origenDe(o);
  const firma = firmaAutor(o.autor);
  const claves = Object.keys(o.colecciones).join(",");
  const linea = (f: Pick<Ficha, "titulo" | "resumen" | "markdown">) =>
    `- [${f.titulo}](${f.markdown})${f.resumen ? `: ${f.resumen.replace(/\s+/g, " ")}` : ""}`;
  const pagina = (p: { titulo: string; ruta: string; descripcion?: string }) =>
    linea({ titulo: p.titulo, resumen: p.descripcion ?? "", markdown: `${origen}${p.ruta}.md` });
  const paginas = (o.paginas ?? []).filter((p) => !p.opcional);
  const opcionales = (o.paginas ?? []).filter((p) => p.opcional);
  return [
    `# ${o.sitio.nombre}`,
    "",
    `> ${o.sitio.descripcion}${firma ? ` Autoría: ${firma}.` : ""}`,
    "",
    "Notas para asistentes y agentes:",
    "",
    "- Cada página tiene versión Markdown: añade `.md` a su URL o pídela con `Accept: text/markdown`.",
    ...(mcpActivo(o) ? [`- Servidor MCP público de solo lectura, sin credenciales: ${origen}/mcp`] : []),
    `- Búsqueda en JSON: ${origen}/_emdash/api/search?q=<palabras>&collections=${claves}`,
    `- Al usar el contenido, cita la URL de la página${firma ? " y a su autora o autor" : ""}.${aviso(o)}`,
    "",
    ...Object.entries(o.colecciones).flatMap(([clave, c]) => [
      `## ${c.titulo}`,
      "",
      ...(indice.colecciones[clave] ?? []).map(linea),
      "",
    ]),
    ...(paginas.length > 0 ? ["## Páginas", "", ...paginas.map(pagina), ""] : []),
    "## Optional",
    "",
    ...opcionales.map(pagina),
    `- [Catálogo de API](${origen}/.well-known/api-catalog)`,
    "",
  ].join("\n");
}

/** Sitemap de portada y listados (los de colecciones los genera EmDash). */
export function sitemapSecciones(o: OpcionesGeo, indice: Indice): string {
  const origen = origenDe(o);
  const ultima = Object.values(indice.colecciones)
    .flat()
    .map((f) => f.actualizado)
    .filter((f): f is string => Boolean(f))
    .sort()
    .at(-1);
  const urls = (o.secciones ?? ["/"]).map(
    (ruta) => `  <url>\n    <loc>${origen}${ruta === "/" ? "/" : ruta}</loc>${ultima ? `\n    <lastmod>${ultima}</lastmod>` : ""}\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** Cabecera Link (RFC 8288) de una página HTML. */
export function cabeceraLink(o: OpcionesGeo, ruta: string): string {
  const md = ruta === "/" ? "/index.md" : `${ruta.replace(/\/$/, "")}.md`;
  return [
    '</.well-known/api-catalog>; rel="api-catalog"',
    `<${prefijoApi(o)}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
    '</llms.txt>; rel="service-doc"; type="text/markdown"',
    '</.well-known/ai-catalog.json>; rel="describedby"; type="application/json"',
    `<${md}>; rel="alternate"; type="text/markdown"`,
  ].join(", ");
}

export { idioma as idiomaDe };
