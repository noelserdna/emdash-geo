// Opciones del plugin. El mismo objeto se pasa al descriptor (`geo()` en
// astro.config) y al envoltorio del Worker (`withGeo()`): conviene exportarlo
// desde un único fichero del sitio.

export interface AutorGeo {
  /** Nombre tal como se muestra, con tratamiento si lo lleva («Dra. Ana Pérez»). */
  nombre: string;
  /** Tratamiento que va delante del nombre («Dra.»). Se separa en los datos estructurados. */
  tratamiento?: string;
  /** Profesión o cargo («Ginecóloga»). */
  cargo?: string;
  /** Campo profesional («Ginecología y obstetricia»). */
  categoria?: string;
  /** Credencial verificable: número de colegiación, registro profesional… */
  credencial?: { nombre: string; valor: string };
  /** Ruta de la página «sobre mí» («/sobre-mi»). */
  ruta?: string;
  /** Ruta o URL de una fotografía. */
  imagen?: string;
  /** Temas que domina. */
  sabeDe?: string[];
  /** Perfiles públicos verificables (schema.org `sameAs`). */
  perfiles?: string[];
}

export interface ColeccionGeo {
  /** Patrón de URL pública con `:slug` («/articulos/:slug»). */
  ruta: string;
  /** Título de la sección en llms.txt y en los catálogos («Artículos»). */
  titulo: string;
  /** Qué contiene, en una frase. Se usa en la herramienta MCP y en OpenAPI. */
  descripcion?: string;
  /** Campo con el resumen de la entrada (por defecto `excerpt`). */
  campoResumen?: string;
  /** Campo con la fecha de revisión experta, si existe. */
  campoRevisado?: string;
  /** Orden del listado: por fecha de publicación (defecto) o por título. */
  orden?: "fecha" | "titulo";
}

export interface PaginaGeo {
  titulo: string;
  ruta: string;
  descripcion?: string;
  /** Va a la sección «Optional» de llms.txt (avisos legales y similares). */
  opcional?: boolean;
}

export interface SenalesGeo {
  /** Aparecer en buscadores. */
  search?: boolean;
  /** Que los asistentes de IA usen el contenido para responder (con cita). */
  aiInput?: boolean;
  /** Que se use para entrenar modelos. */
  aiTrain?: boolean;
}

export interface OpcionesGeo {
  sitio: {
    /** Origen público, sin barra final («https://ejemplo.com»). */
    url: string;
    nombre: string;
    /** Descripción del sitio para catálogos, llms.txt y metadatos. */
    descripcion: string;
    /** Código de idioma del contenido (por defecto `es`). */
    idioma?: string;
    /** Ruta de la página de búsqueda con el parámetro al final («/buscar?q=»). */
    busqueda?: string;
  };
  autor?: AutorGeo;
  /** Colecciones de EmDash que se publican, por su slug. */
  colecciones: Record<string, ColeccionGeo>;
  /** Páginas sueltas que merece la pena enseñar a un agente (sobre mí, avisos…). */
  paginas?: PaginaGeo[];
  /** Rutas de portada y listados para el sitemap de secciones (por defecto, «/»). */
  secciones?: string[];
  /** Preferencias de uso del contenido (contentsignals.org). Por defecto, todo permitido. */
  senales?: SenalesGeo;
  /** Aviso que acompaña al contenido cuando lo usa un agente («no sustituye a…»). */
  aviso?: string;
  /** Reglas extra de robots.txt. Las rutas de EmDash ya se gestionan solas. */
  robots?: { bloquear?: string[]; permitir?: string[]; sitemaps?: string[] };
  /** Servidor MCP público de solo lectura en /mcp. `false` lo desactiva. */
  mcp?: false | { nombre?: string; version?: string };
  /**
   * Describe en auth.md el acceso editorial de EmDash (OAuth) y publica el
   * alias raíz de sus metadatos. Por defecto, sí.
   */
  editorial?: boolean;
  /** Agente A2A de solo lectura en /a2a y su tarjeta. `false` lo desactiva. */
  a2a?: false;
  /**
   * Registro anónimo y opcional de agentes (auth.md): `POST /agent/auth` emite
   * una credencial firmada para identificarse en /mcp y /a2a. No da permisos
   * extra. Necesita un secreto del Worker (por defecto `GEO_FIRMA`).
   */
  registro?: { secretEnv?: string; dias?: number };
  /** Prefijo de los listados JSON y del OpenAPI (por defecto «/api»). */
  prefijoApi?: string;
}

export const ID_PLUGIN = "geo";
export const VERSION = "0.1.0";
/** Ruta pública del plugin con el índice de contenido que consume el envoltorio. */
export const RUTA_INDICE = `/_emdash/api/plugins/${ID_PLUGIN}/indice`;

export interface Senales {
  search: boolean;
  aiInput: boolean;
  aiTrain: boolean;
}

export function senalesDe(opciones: OpcionesGeo, ajustes: Partial<Senales> = {}): Senales {
  return {
    search: ajustes.search ?? opciones.senales?.search ?? true,
    aiInput: ajustes.aiInput ?? opciones.senales?.aiInput ?? true,
    aiTrain: ajustes.aiTrain ?? opciones.senales?.aiTrain ?? true,
  };
}

const siNo = (v: boolean) => (v ? "yes" : "no");

/** Valor de la directiva Content-Signal. */
export function contentSignal(s: Senales): string {
  return `search=${siNo(s.search)}, ai-input=${siNo(s.aiInput)}, ai-train=${siNo(s.aiTrain)}`;
}

export function origenDe(opciones: OpcionesGeo): string {
  return opciones.sitio.url.replace(/\/+$/, "");
}

export function prefijoApi(opciones: OpcionesGeo): string {
  return (opciones.prefijoApi ?? "/api").replace(/\/+$/, "");
}

/** Nombre público de una colección: el primer segmento de su ruta («articulos»). */
export function nombrePublico(clave: string, coleccion: ColeccionGeo): string {
  const segmento = coleccion.ruta.split("/").find((s) => s && !s.startsWith(":"));
  return (segmento ?? clave).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function urlDeEntrada(origen: string, coleccion: ColeccionGeo, slug: string): string {
  return `${origen}${coleccion.ruta.replace(":slug", slug)}`;
}

/** Firma del autor en una línea: «Dra. Ana Pérez, ginecóloga (n.º de colegiada 123)». */
export function firmaAutor(autor: AutorGeo | undefined): string | null {
  if (!autor) return null;
  const cargo = autor.cargo ? `, ${autor.cargo.toLowerCase()}` : "";
  const credencial = autor.credencial ? ` (${autor.credencial.nombre.toLowerCase()} ${autor.credencial.valor})` : "";
  return `${autor.nombre}${cargo}${credencial}`;
}

/** Una entrada publicada, tal como la devuelve la ruta `indice` del plugin. */
export interface Ficha {
  slug: string;
  titulo: string;
  resumen: string;
  url: string;
  markdown: string;
  publicado: string | null;
  actualizado: string | null;
  revisado: string | null;
}

export interface Indice {
  senales: Senales;
  colecciones: Record<string, Ficha[]>;
}
