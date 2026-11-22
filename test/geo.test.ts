import assert from "node:assert/strict";
import { test } from "node:test";
import { robotsTxt, llmsTxt, catalogoApi, catalogoIa, indiceHabilidades, habilidadMd, sha256, tarjetaMcp } from "../src/core/documentos.ts";
import { htmlAMarkdown, esPagina } from "../src/core/markdown.ts";
import { senalesDe, RUTA_INDICE, type Indice, type OpcionesGeo } from "../src/core/config.ts";
import { withGeo } from "../src/worker/index.ts";
import { nodosSitio, paginaRevisada, serializar } from "../src/schema.ts";

const opciones: OpcionesGeo = {
  sitio: { url: "https://ejemplo.test", nombre: "Huerto de Ana", descripcion: "Guías de huerto urbano.", busqueda: "/buscar?q=" },
  autor: { nombre: "Dra. Ana Ruiz", tratamiento: "Dra.", cargo: "Agrónoma", credencial: { nombre: "N.º de colegiada", valor: "123" }, ruta: "/sobre-mi" },
  colecciones: {
    posts: { ruta: "/articulos/:slug", titulo: "Artículos", campoRevisado: "reviewed_at" },
    fichas: { ruta: "/plantas/:slug", titulo: "Plantas", campoResumen: "summary", orden: "titulo" },
  },
  paginas: [{ titulo: "Sobre mí", ruta: "/sobre-mi" }, { titulo: "Aviso legal", ruta: "/aviso-legal", opcional: true }],
  secciones: ["/", "/articulos"],
  aviso: "No sustituye al consejo de un profesional.",
};

const indice: Indice = {
  senales: senalesDe(opciones),
  colecciones: {
    posts: [{ slug: "tomates", titulo: "Cómo plantar tomates", resumen: "Paso a paso.", url: "https://ejemplo.test/articulos/tomates", markdown: "https://ejemplo.test/articulos/tomates.md", publicado: "2026-01-02T00:00:00.000Z", actualizado: "2026-01-03T00:00:00.000Z", revisado: null }],
    fichas: [],
  },
};

const HTML = `<!doctype html><html><head><title>Cómo plantar tomates | Huerto</title><meta name="description" content="Paso a paso &amp; sin prisa"><link rel="canonical" href="https://ejemplo.test/articulos/tomates"></head><body><header><nav><a href="/">Inicio</a></nav></header><main id="main"><h1>Cómo plantar tomates</h1><p>Riega <strong>poco</strong> y <a href="/plantas/tomate">a menudo</a>.</p><script>alert(1)</script></main><footer>Pie</footer></body></html>`;

/** Sitio falso: páginas HTML, el índice del plugin y la búsqueda de EmDash. */
const sitio = {
  vistas: [] as string[],
  async fetch(request: Request) {
    const url = new URL(request.url);
    sitio.vistas.push(`${request.method} ${url.pathname} ${request.headers.get("cookie") ?? "-"}`);
    if (url.pathname === RUTA_INDICE) return Response.json({ success: true, data: indice });
    if (url.pathname === "/_emdash/api/search") {
      return Response.json({ success: true, data: { items: [{ collection: "posts", slug: "tomates", title: "Cómo plantar tomates", snippet: "plantar <mark>tomates</mark>" }] } });
    }
    if (url.pathname === "/articulos/tomates" || url.pathname === "/") return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/_emdash/admin") return new Response("panel", { headers: { "content-type": "text/html" } });
    return new Response("<html><head><title>404</title></head><body><main>No</main></body></html>", { status: 404, headers: { "content-type": "text/html" } });
  },
};
const geo = withGeo(sitio, opciones);
const pedir = (ruta: string, init?: RequestInit) => geo.fetch(new Request(`https://ejemplo.test${ruta}`, init), undefined, undefined);

test("robots.txt declara las señales y abre las imágenes", () => {
  const txt = robotsTxt(opciones, senalesDe(opciones));
  assert.match(txt, /Content-Signal: search=yes, ai-input=yes, ai-train=yes/);
  assert.match(txt, /Allow: \/_emdash\/api\/media\//);
  assert.match(txt, /User-agent: GPTBot/);
  assert.match(txt, /Sitemap: https:\/\/ejemplo\.test\/sitemap-secciones\.xml/);
});

test("sin entrenamiento, robots.txt veta a los rastreadores de entrenamiento", () => {
  const txt = robotsTxt(opciones, senalesDe(opciones, { aiTrain: false }));
  assert.match(txt, /ai-train=no/);
  const [, vetados] = txt.split("# Rastreadores de entrenamiento de modelos: no.");
  assert.ok(vetados && /User-agent: GPTBot[\s\S]*Disallow: \/\n/.test(vetados));
  assert.match(txt, /User-agent: OAI-SearchBot/);
});

test("llms.txt lista lo publicado con su versión Markdown", () => {
  const txt = llmsTxt(opciones, indice);
  assert.match(txt, /^# Huerto de Ana/);
  assert.match(txt, /- \[Cómo plantar tomates\]\(https:\/\/ejemplo\.test\/articulos\/tomates\.md\): Paso a paso\./);
  assert.match(txt, /## Optional[\s\S]*Aviso legal/);
  assert.match(txt, /Dra\. Ana Ruiz, agrónoma \(n\.º de colegiada 123\)/);
});

test("el HTML se convierte a Markdown solo con el contenido de <main>", () => {
  const { markdown, tokens } = htmlAMarkdown(HTML, opciones, "/articulos/tomates");
  assert.match(markdown, /^---\ntitle: "Cómo plantar tomates \| Huerto"\ndescription: "Paso a paso & sin prisa"\nurl: https:\/\/ejemplo\.test\/articulos\/tomates/);
  assert.match(markdown, /# Cómo plantar tomates/);
  assert.match(markdown, /\[a menudo\]\(https:\/\/ejemplo\.test\/plantas\/tomate\)/);
  assert.doesNotMatch(markdown, /alert|Inicio|Pie/);
  assert.ok(tokens > 0);
});

test("esPagina descarta panel, API y ficheros", () => {
  assert.equal(esPagina("/articulos/tomates"), true);
  assert.equal(esPagina("/_emdash/admin"), false);
  assert.equal(esPagina("/api/posts.json"), false);
  assert.equal(esPagina("/img/foto.webp"), false);
  assert.equal(esPagina("/mcp"), false);
});

test("los catálogos apuntan a recursos del propio sitio", async () => {
  const api = catalogoApi(opciones);
  assert.equal(api.linkset[0]?.["service-desc"][0]?.href, "https://ejemplo.test/api/openapi.json");
  const ia = catalogoIa(opciones, indice);
  for (const e of ia.entries) {
    assert.ok(e.url.startsWith("https://ejemplo.test/"));
    assert.ok(e.identifier.startsWith("urn:air:ejemplo.test:"));
    assert.ok(e.representativeQueries.length >= 2);
  }
  const habilidades = await indiceHabilidades(opciones);
  assert.equal(habilidades.skills[0]?.digest, `sha256:${await sha256(habilidadMd(opciones))}`);
  assert.equal(tarjetaMcp(opciones).transport.endpoint, "https://ejemplo.test/mcp");
});

test("el envoltorio sirve los documentos de descubrimiento", async () => {
  const robots = await pedir("/robots.txt");
  assert.equal(robots.headers.get("content-type"), "text/plain; charset=utf-8");
  const catalogo = await pedir("/.well-known/api-catalog");
  assert.match(catalogo.headers.get("content-type") ?? "", /^application\/linkset\+json/);
  const habilidad = await pedir("/.well-known/agent-skills/consultar-ejemplo-test/SKILL.md");
  assert.equal(habilidad.status, 200);
  const listado = (await (await pedir("/api/articulos.json")).json()) as { total: number };
  assert.equal(listado.total, 1);
  assert.equal((await pedir("/llms.txt")).headers.get("content-type"), "text/markdown; charset=utf-8");
});

test("negociación de contenido: Markdown con Accept o con .md, HTML por defecto", async () => {
  const html = await pedir("/articulos/tomates");
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html.headers.get("link") ?? "", /rel="api-catalog"/);
  assert.match(html.headers.get("link") ?? "", /<\/articulos\/tomates\.md>; rel="alternate"; type="text\/markdown"/);

  const negociado = await pedir("/articulos/tomates", { headers: { accept: "text/markdown" } });
  assert.equal(negociado.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.ok(Number(negociado.headers.get("x-markdown-tokens")) > 0);
  assert.match(await negociado.text(), /# Cómo plantar tomates/);

  const sufijo = await pedir("/index.md");
  assert.equal(sufijo.headers.get("content-type"), "text/markdown; charset=utf-8");

  const inexistente = await pedir("/nada.md");
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.headers.get("content-type"), "text/markdown; charset=utf-8");
});

test("las peticiones internas no arrastran las cookies de quien llama", async () => {
  sitio.vistas.length = 0;
  await pedir("/articulos/tomates", { headers: { accept: "text/markdown", cookie: "sesion=secreta" } });
  assert.ok(sitio.vistas.some((v) => v === "GET /articulos/tomates -"));
  assert.ok(!sitio.vistas.some((v) => v.includes("secreta")));
});

test("el panel y los ficheros pasan intactos", async () => {
  const panel = await pedir("/_emdash/admin", { headers: { accept: "text/markdown" } });
  assert.equal(await panel.text(), "panel");
  assert.equal(panel.headers.get("link"), null);
});

test("servidor MCP: iniciar, listar herramientas, buscar y leer", async () => {
  const mcp = async (cuerpo: unknown) =>
    (await (await pedir("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) })).json()) as any;
  const inicio = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(inicio.result.protocolVersion, "2025-06-18");
  assert.equal(inicio.result.serverInfo.name, "ejemplo-test");

  const herramientas = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(herramientas.result.tools.map((t: { name: string }) => t.name), ["buscar", "listar_articulos", "listar_plantas", "leer_pagina"]);

  const busqueda = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "buscar", arguments: { consulta: "tomates" } } });
  const resultado = JSON.parse(busqueda.result.content[0].text);
  assert.equal(resultado.resultados[0].url, "https://ejemplo.test/articulos/tomates");
  assert.equal(resultado.resultados[0].fragmento, "plantar tomates");

  const pagina = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "leer_pagina", arguments: { ruta: "/articulos/tomates" } } });
  assert.match(pagina.result.content[0].text, /# Cómo plantar tomates/);

  const prohibida = await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "leer_pagina", arguments: { ruta: "/_emdash/admin" } } });
  assert.equal(prohibida.result.isError, true);
  const ajena = await mcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "leer_pagina", arguments: { ruta: "https://otro.test/articulos/tomates" } } });
  assert.equal(ajena.result.isError, true);

  const notificacion = await pedir("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(notificacion.status, 202);
  assert.equal((await pedir("/mcp")).status, 405);
});

test("datos estructurados: autoría, revisión y escape de «<»", () => {
  const grafo = JSON.parse(
    serializar([
      ...nodosSitio(opciones),
      paginaRevisada(opciones, { url: "https://ejemplo.test/a", titulo: "A </script>", revisado: "2026-02-01", tipo: "MedicalWebPage" }),
    ]),
  );
  const [persona, web, pagina] = grafo["@graph"];
  assert.equal(persona.name, "Ana Ruiz");
  assert.equal(persona.honorificPrefix, "Dra.");
  assert.equal(web.potentialAction.target.urlTemplate, "https://ejemplo.test/buscar?q={search_term_string}");
  assert.equal(pagina["@type"], "MedicalWebPage");
  assert.equal(pagina.reviewedBy["@id"], "https://ejemplo.test/#autor");
  assert.ok(!serializar([{ a: "</script>" }]).includes("</script>"));
});

test("agente A2A: tarjeta, búsqueda y lectura", async () => {
  const tarjeta = (await (await pedir("/.well-known/agent-card.json")).json()) as any;
  assert.equal(tarjeta.url, "https://ejemplo.test/a2a");
  assert.deepEqual(tarjeta.skills.map((s: { id: string }) => s.id), ["buscar", "leer"]);
  const a2a = async (texto: string, method = "message/send") =>
    (await (await pedir("/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { message: { role: "user", kind: "message", messageId: "m1", parts: [{ kind: "text", text: texto }] } } }),
    })).json()) as any;
  const busqueda = await a2a("tomates");
  assert.equal(busqueda.result.role, "agent");
  assert.match(busqueda.result.parts[0].text, /Cómo plantar tomates — https:\/\/ejemplo\.test\/articulos\/tomates/);
  assert.equal(busqueda.result.parts[1].data.resultados.length, 1);
  const lectura = await a2a("lee https://ejemplo.test/articulos/tomates");
  assert.match(lectura.result.parts[0].text, /# Cómo plantar tomates/);
  assert.equal((await a2a("x", "tasks/get")).error.code, -32001);
  assert.equal((await a2a("x", "otra/cosa")).error.code, -32601);
});

test("registro anónimo: emite una credencial que /mcp acepta y rechaza si se manipula", async () => {
  const conRegistro = withGeo(sitio, { ...opciones, registro: {} });
  const env = { GEO_FIRMA: "secreto-de-prueba" };
  const llamar = (ruta: string, init?: RequestInit, e: unknown = env) => conRegistro.fetch(new Request(`https://ejemplo.test${ruta}`, init), e, undefined);
  const alta = await llamar("/agent/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "anonymous", name: "Probador" }) });
  assert.equal(alta.status, 201);
  const { token, agent_id } = (await alta.json()) as { token: string; agent_id: string };
  const quien = await llamar("/agent/auth", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(((await quien.json()) as { agent_id: string }).agent_id, agent_id);

  const cuerpo = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  const mcp = (cabeceras: Record<string, string>) => llamar("/mcp", { method: "POST", headers: { "content-type": "application/json", ...cabeceras }, body: cuerpo });
  assert.equal((await mcp({ authorization: `Bearer ${token}` })).status, 200);
  assert.equal((await mcp({})).status, 200);
  assert.equal((await mcp({ authorization: `Bearer ${token.slice(0, -2)}xx` })).status, 401);

  assert.equal((await llamar("/agent/auth", { method: "POST", body: "{}" }, {})).status, 503);
  assert.equal((await llamar("/agent/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "service_auth" }) })).status, 400);
  // Sin la opción, la ruta no existe para el plugin.
  assert.equal((await pedir("/agent/auth")).status, 404);
});
