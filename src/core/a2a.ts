// Agente A2A (Agent2Agent) de solo lectura, sin modelo detrás: recibe un
// mensaje de texto y responde buscando en el sitio o, si el mensaje nombra una
// página, devolviéndola en Markdown. JSON-RPC 2.0 sobre HTTP, sin tareas ni
// streaming: cada mensaje recibe su respuesta en la misma petición.
import { origenDe, VERSION, type OpcionesGeo } from "./config.ts";
import { CORS, type FuentesMcp } from "./mcp.ts";

export const RUTA_A2A = "/a2a";
const PROTOCOLO = "0.3.0";

export function a2aActivo(o: OpcionesGeo): boolean {
  return o.a2a !== false;
}

export function tarjetaA2a(o: OpcionesGeo) {
  const origen = origenDe(o);
  const secciones = Object.values(o.colecciones).map((c) => c.titulo.toLowerCase()).join(", ");
  const ejemplo = Object.values(o.colecciones)[0]?.ruta.replace(":slug", "<slug>") ?? "/pagina";
  const url = `${origen}${RUTA_A2A}`;
  return {
    protocolVersion: PROTOCOLO,
    name: o.sitio.nombre,
    description: `${o.sitio.descripcion} Agente de solo lectura: busca en el contenido publicado y devuelve páginas en Markdown. No genera texto propio.`,
    version: VERSION,
    url,
    preferredTransport: "JSONRPC",
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: PROTOCOLO }],
    additionalInterfaces: [{ url, transport: "JSONRPC" }],
    provider: { organization: o.sitio.nombre, url: origen },
    documentationUrl: `${origen}/llms.txt`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "text/markdown"],
    skills: [
      {
        id: "buscar",
        name: "Buscar en el contenido",
        description: `Envía unas palabras y devuelve las páginas publicadas que mejor coinciden (${secciones}), con título, URL y fragmento.`,
        tags: ["búsqueda", "contenido"],
        examples: [o.sitio.nombre],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
      {
        id: "leer",
        name: "Leer una página",
        description: `Envía la ruta o la URL de una página de la web (por ejemplo ${ejemplo}) y devuelve su texto completo en Markdown.`,
        tags: ["lectura", "markdown"],
        examples: [`${origen}${ejemplo}`],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
    ],
  };
}

type Id = string | number | null;
const fallo = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function textoDe(mensaje: unknown): string {
  const partes = (mensaje as { parts?: unknown } | undefined)?.parts;
  if (!Array.isArray(partes)) return "";
  return partes
    .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join(" ")
    .trim();
}

/** Si el texto nombra una página del sitio (URL o ruta), su ruta. */
function rutaNombrada(texto: string, origen: string): string | null {
  const candidato = texto.split(/\s+/).find((t) => t.startsWith(origen) || /^\/[a-z0-9]/i.test(t));
  if (!candidato) return null;
  try {
    const url = new URL(candidato.replace(/[.,;)]+$/, ""), origen);
    return url.origin === origen ? url.pathname.replace(/\.md$/, "").replace(/(.)\/$/, "$1") : null;
  } catch {
    return null;
  }
}

async function responder(o: OpcionesGeo, fuentes: FuentesMcp, mensaje: unknown) {
  const origen = origenDe(o);
  const texto = textoDe(mensaje);
  const contextId = (mensaje as { contextId?: unknown } | undefined)?.contextId;
  const respuesta = (partes: object[]) => ({
    kind: "message",
    role: "agent",
    messageId: crypto.randomUUID(),
    ...(typeof contextId === "string" ? { contextId } : {}),
    parts: partes,
  });
  if (!texto) return respuesta([{ kind: "text", text: "Envía unas palabras para buscar o la ruta de una página para leerla." }]);

  const ruta = rutaNombrada(texto, origen);
  if (ruta) {
    const pagina = await fuentes.leer(ruta);
    if (pagina) return respuesta([{ kind: "text", text: pagina, metadata: { mediaType: "text/markdown" } }]);
  }
  const resultados = await fuentes.buscar(texto.slice(0, 200), 5);
  if (resultados.length === 0) {
    return respuesta([{ kind: "text", text: `No hay resultados para «${texto.slice(0, 200)}». Índice del sitio: ${origen}/llms.txt` }]);
  }
  const lista = resultados.map((r, i) => `${i + 1}. ${r.titulo} — ${r.url}${r.fragmento ? `\n   ${r.fragmento}` : ""}`).join("\n");
  return respuesta([
    { kind: "text", text: `${lista}\n\nPara leer una de ellas, envía su URL.${o.aviso ? ` ${o.aviso}` : ""}` },
    { kind: "data", data: { resultados } },
  ]);
}

/** Atiende una petición HTTP al punto /a2a. */
export async function atenderA2a(request: Request, o: OpcionesGeo, fuentes: FuentesMcp): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    return Response.json(
      { agente: o.sitio.nombre, uso: "Agente A2A (JSON-RPC 2.0). Envía message/send con POST a esta URL.", tarjeta: `${origenDe(o)}/.well-known/agent-card.json` },
      { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
    );
  }
  let cuerpo: { jsonrpc?: unknown; id?: Id; method?: unknown; params?: { message?: unknown } };
  try {
    cuerpo = (await request.json()) as typeof cuerpo;
  } catch {
    return Response.json(fallo(null, -32700, "JSON no válido"), { status: 400, headers: CORS });
  }
  const id = cuerpo?.id ?? null;
  if (cuerpo?.jsonrpc !== "2.0" || typeof cuerpo.method !== "string") {
    return Response.json(fallo(id, -32600, "Petición JSON-RPC no válida"), { status: 400, headers: CORS });
  }
  switch (cuerpo.method) {
    case "message/send":
    case "SendMessage":
      try {
        return Response.json({ jsonrpc: "2.0", id, result: await responder(o, fuentes, cuerpo.params?.message) }, { headers: CORS });
      } catch {
        return Response.json(fallo(id, -32603, "No se ha podido completar la consulta"), { headers: CORS });
      }
    case "tasks/get":
    case "tasks/cancel":
    case "GetTask":
    case "CancelTask":
      // Este agente no crea tareas: responde siempre con un mensaje directo.
      return Response.json(fallo(id, -32001, "Tarea no encontrada: este agente responde sin crear tareas"), { headers: CORS });
    case "message/stream":
    case "SendStreamingMessage":
      return Response.json(fallo(id, -32004, "Este agente no admite streaming"), { headers: CORS });
    default:
      return Response.json(fallo(id, -32601, `Método no disponible: ${cuerpo.method}`), { headers: CORS });
  }
}
