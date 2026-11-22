// Registro anónimo y opcional de agentes. Un agente puede pedir una credencial
// para identificarse en /mcp y /a2a. No da más permisos (el contenido es
// público): sirve para que el sitio sepa quién lo consulta y para que el agente
// tenga una identidad estable. Credencial sin estado, firmada con HMAC-SHA256.
const PREFIJO = "geo1";
const codificar = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const descodificar = (texto: string) => Uint8Array.from(atob(texto.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export interface IdentidadAgente {
  /** Identificador estable del agente. */
  id: string;
  /** Nombre que declaró el agente (no verificado). */
  nombre: string;
  /** Contacto que declaró (no verificado), o cadena vacía. */
  contacto: string;
  /** Emisión y caducidad, en segundos Unix. */
  iat: number;
  exp: number;
}

async function firmar(secreto: string, datos: string): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(datos)));
}

const limpio = (valor: unknown, max: number) => (typeof valor === "string" ? valor.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export async function emitirCredencial(
  secreto: string,
  datos: { nombre?: unknown; contacto?: unknown },
  ahoraMs: number,
  dias = 90,
): Promise<{ token: string; identidad: IdentidadAgente }> {
  const iat = Math.floor(ahoraMs / 1000);
  const identidad: IdentidadAgente = {
    id: `agente_${crypto.randomUUID().replace(/-/g, "")}`,
    nombre: limpio(datos.nombre, 80) || "agente anónimo",
    contacto: limpio(datos.contacto, 160),
    iat,
    exp: iat + dias * 86400,
  };
  const cuerpo = codificar(new TextEncoder().encode(JSON.stringify(identidad)));
  const firma = codificar(await firmar(secreto, `${PREFIJO}.${cuerpo}`));
  return { token: `${PREFIJO}.${cuerpo}.${firma}`, identidad };
}

/** Devuelve la identidad si la credencial es válida y no ha caducado; si no, null. */
export async function verificarCredencial(secreto: string, token: string, ahoraMs: number): Promise<IdentidadAgente | null> {
  const [prefijo, cuerpo, firma, ...resto] = token.split(".");
  if (prefijo !== PREFIJO || !cuerpo || !firma || resto.length > 0) return null;
  try {
    const esperada = await firmar(secreto, `${PREFIJO}.${cuerpo}`);
    const recibida = descodificar(firma);
    if (recibida.length !== esperada.length) return null;
    let diferencia = 0;
    for (let i = 0; i < esperada.length; i++) diferencia |= esperada[i]! ^ recibida[i]!;
    if (diferencia !== 0) return null;
    const identidad = JSON.parse(new TextDecoder().decode(descodificar(cuerpo))) as IdentidadAgente;
    return typeof identidad.exp === "number" && identidad.exp * 1000 > ahoraMs ? identidad : null;
  } catch {
    return null;
  }
}

/** Token de portador de la petición, si lo trae. */
export function portador(request: Request): string | null {
  const cabecera = request.headers.get("authorization") ?? "";
  return /^bearer\s+/i.test(cabecera) ? cabecera.replace(/^bearer\s+/i, "").trim() : null;
}
