// Servidor MCP público de solo lectura (Streamable HTTP, sin estado ni sesión).
// No depende de EmDash: recibe funciones para buscar, listar y leer páginas.
import { herramientasMcp, infoServidor, instruccionesMcp } from "./documentos.ts";
import { nombrePublico, origenDe, type Ficha, type OpcionesGeo } from "./config.ts";

const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Authorization",
} as const;

export interface ResultadoBusqueda {
  coleccion: string;
  titulo: string;
  url: string;
  fragmento: string;
}

export interface FuentesMcp {
  buscar(consulta: string, limite: number): Promise<ResultadoBusqueda[]>;
  listar(clave: string): Promise<Ficha[]>;
  /** Markdown de una página pública, o null si no existe. */
  leer(ruta: string): Promise<string | null>;
}

type Id = string | number | null;
interface Mensaje {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: Record<string, unknown>;
}

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fallo = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const contenido = (texto: string, isError = false) => ({ content: [{ type: "text", text: texto }], isError });

async function llamar(o: OpcionesGeo, fuentes: FuentesMcp, nombre: string, args: Record<string, unknown>) {
  const origen = origenDe(o);
  if (nombre === "buscar") {
    const consulta = typeof args.consulta === "string" ? args.consulta.trim() : "";
    if (!consulta) return contenido("Falta el parámetro «consulta».", true);
    const limite = Math.min(Math.max(Number(args.limite) || 10, 1), 20);
    const resultados = await fuentes.buscar(consulta, limite);
    return contenido(JSON.stringify({ consulta, total: resultados.length, resultados }, null, 2));
  }
  if (nombre === "leer_pagina") {
    let ruta: string | null = null;
    if (typeof args.ruta === "string") {
      try {
        const url = new URL(args.ruta, origen);
        if (url.origin === origen) ruta = url.pathname.replace(/\.md$/, "").replace(/(.)\/$/, "$1");
      } catch {
        ruta = null;
      }
    }
    const texto = ruta ? await fuentes.leer(ruta) : null;
    return texto ? contenido(texto) : contenido(`No hay ninguna página pública en esa ruta. Consulta el índice: ${origen}/llms.txt`, true);
  }
  for (const [clave, c] of Object.entries(o.colecciones)) {
    if (nombre === `listar_${nombrePublico(clave, c)}`) {
      return contenido(JSON.stringify(await fuentes.listar(clave), null, 2));
    }
  }
  return null;
}

async function atender(o: OpcionesGeo, fuentes: FuentesMcp, m: Mensaje): Promise<object | null> {
  const id = m.id ?? null;
  const esNotificacion = m.id === undefined;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return esNotificacion ? null : fallo(id, -32600, "Petición JSON-RPC no válida");
  }
  if (esNotificacion) return null;
  switch (m.method) {
    case "initialize": {
      const pedida = String(m.params?.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: VERSIONES.includes(pedida) ? pedida : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: infoServidor(o),
        instructions: instruccionesMcp(o),
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: herramientasMcp(o) });
    case "tools/call": {
      const nombre = String(m.params?.name ?? "");
      const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const resultado = await llamar(o, fuentes, nombre, args);
        return resultado ? ok(id, resultado) : fallo(id, -32602, `Herramienta desconocida: ${nombre}`);
      } catch {
        return ok(id, contenido("No se ha podido completar la consulta. Inténtalo de nuevo.", true));
      }
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fallo(id, -32601, `Método no disponible: ${m.method}`);
  }
}

/** Atiende una petición HTTP al punto /mcp. */
export async function atenderMcp(request: Request, o: OpcionesGeo, fuentes: FuentesMcp): Promise<Response> {
  const origen = origenDe(o);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    // Sin flujo SSE iniciado por el servidor: a quien llegue con GET se le explica qué es esto.
    return Response.json(
      {
        servidor: infoServidor(o),
        descripcion: o.sitio.descripcion,
        uso: "Servidor MCP (Streamable HTTP). Envía mensajes JSON-RPC con POST a esta misma URL. No necesita credenciales.",
        tarjeta: `${origen}/.well-known/mcp/server-card.json`,
      },
      { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
    );
  }
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json(fallo(null, -32700, "JSON no válido"), { status: 400, headers: CORS });
  }
  const lote = Array.isArray(cuerpo);
  const mensajes = (lote ? cuerpo : [cuerpo]) as Mensaje[];
  if (mensajes.length === 0 || mensajes.length > 20) {
    return Response.json(fallo(null, -32600, "Lote vacío o demasiado grande"), { status: 400, headers: CORS });
  }
  const respuestas: object[] = [];
  for (const m of mensajes) {
    const r = await atender(o, fuentes, m ?? {});
    if (r) respuestas.push(r);
  }
  // Solo notificaciones: aceptado, sin cuerpo.
  if (respuestas.length === 0) return new Response(null, { status: 202, headers: CORS });
  return Response.json(lote ? respuestas : respuestas[0], { headers: CORS });
}
