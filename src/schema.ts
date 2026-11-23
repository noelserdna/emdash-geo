// Datos estructurados (schema.org) que EmDash no genera: quién firma el sitio,
// la revisión experta de cada página, las migas y las preguntas frecuentes.
// EmDash ya emite el BlogPosting / WebSite básico; estos nodos lo completan y
// se enlazan con él por la URL canónica.
//
// Son constructores puros para usar en las plantillas del sitio. Declarar solo
// datos que consten en la web.
import { origenDe, type OpcionesGeo } from "./core/config.ts";

export type Nodo = Record<string, unknown>;

export const idAutor = (origen: string) => `${origen}/#autor`;
// Mismo @id que el WebSite que emite EmDash (desde 1.5.0), para que los dos
// nodos se fundan en uno en vez de publicar dos sitios web distintos.
export const idSitio = (origen: string) => `${origen}/#website`;

function iso(valor: Date | string | null | undefined): string | undefined {
  if (!valor) return undefined;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const absoluta = (origen: string, ruta: string) => (/^https?:\/\//.test(ruta) ? ruta : `${origen}${ruta}`);

/** Nodos comunes a todas las páginas: quien firma (si se configuró) y el sitio. */
export function nodosSitio(opciones: OpcionesGeo): Nodo[] {
  const origen = origenDe(opciones);
  const a = opciones.autor;
  const idioma = opciones.sitio.idioma ?? "es";
  const nodos: Nodo[] = [];
  if (a) {
    const nombre = a.tratamiento && a.nombre.startsWith(a.tratamiento) ? a.nombre.slice(a.tratamiento.length).trim() : a.nombre;
    nodos.push({
      "@type": "Person",
      "@id": idAutor(origen),
      name: nombre,
      honorificPrefix: a.tratamiento,
      jobTitle: a.cargo,
      hasOccupation: a.cargo ? { "@type": "Occupation", name: a.cargo, occupationalCategory: a.categoria } : undefined,
      identifier: a.credencial ? { "@type": "PropertyValue", propertyID: a.credencial.nombre, value: a.credencial.valor } : undefined,
      knowsAbout: a.sabeDe,
      sameAs: a.perfiles,
      url: a.ruta ? absoluta(origen, a.ruta) : undefined,
      image: a.imagen ? absoluta(origen, a.imagen) : undefined,
    });
  }
  nodos.push({
    "@type": "WebSite",
    "@id": idSitio(origen),
    name: opciones.sitio.nombre,
    description: opciones.sitio.descripcion,
    url: `${origen}/`,
    inLanguage: idioma,
    publisher: a ? { "@id": idAutor(origen) } : undefined,
    potentialAction: opciones.sitio.busqueda
      ? {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${origen}${opciones.sitio.busqueda}{search_term_string}` },
          "query-input": "required name=search_term_string",
        }
      : undefined,
  });
  return nodos;
}

export interface PaginaRevisada {
  url: string;
  titulo: string;
  /** Tipo schema.org de la página (por defecto `WebPage`; p. ej. `MedicalWebPage`). */
  tipo?: string;
  descripcion?: string | null;
  imagen?: string | null;
  publicado?: Date | string | null;
  modificado?: Date | string | null;
  /** Fecha de la revisión experta: añade `lastReviewed` y `reviewedBy`. */
  revisado?: Date | string | null;
  /** Fuentes citadas. */
  citas?: { texto: string; url?: string | undefined }[];
  /** Nodo `about` (de qué trata) y cualquier otra propiedad propia del tipo. */
  extra?: Nodo;
}

/** Página de contenido con autoría, revisión y fuentes. */
export function paginaRevisada(opciones: OpcionesGeo, p: PaginaRevisada): Nodo {
  const origen = origenDe(opciones);
  const autor = opciones.autor ? { "@id": idAutor(origen) } : undefined;
  const citas = (p.citas ?? []).map((c) => ({ "@type": "CreativeWork", name: c.texto, ...(c.url ? { url: c.url } : {}) }));
  return {
    "@type": p.tipo ?? "WebPage",
    "@id": p.url,
    url: p.url,
    name: p.titulo,
    description: p.descripcion || undefined,
    inLanguage: opciones.sitio.idioma ?? "es",
    isPartOf: { "@id": idSitio(origen) },
    primaryImageOfPage: p.imagen ? { "@type": "ImageObject", url: p.imagen } : undefined,
    datePublished: iso(p.publicado),
    dateModified: iso(p.modificado),
    lastReviewed: iso(p.revisado),
    author: autor,
    reviewedBy: p.revisado ? autor : undefined,
    publisher: autor,
    citation: citas.length > 0 ? citas : undefined,
    ...p.extra,
  };
}

export function migas(opciones: OpcionesGeo, pasos: { nombre: string; ruta: string }[], inicio = "Inicio"): Nodo {
  const origen = origenDe(opciones);
  return {
    "@type": "BreadcrumbList",
    itemListElement: [{ nombre: inicio, ruta: "/" }, ...pasos].map((paso, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: paso.nombre,
      item: `${origen}${paso.ruta}`,
    })),
  };
}

/** Preguntas frecuentes visibles en la página. */
export function preguntasFrecuentes(url: string, preguntas: { pregunta: string; respuesta: string }[]): Nodo | null {
  const validas = preguntas.filter((p) => p.pregunta && p.respuesta);
  if (validas.length === 0) return null;
  return {
    "@type": "FAQPage",
    "@id": `${url}#preguntas`,
    mainEntity: validas.map((p) => ({
      "@type": "Question",
      name: p.pregunta,
      acceptedAnswer: { "@type": "Answer", text: p.respuesta },
    })),
  };
}

/** Página de perfil de quien firma el sitio. */
export function perfilAutor(opciones: OpcionesGeo, url: string): Nodo {
  const origen = origenDe(opciones);
  return {
    "@type": "ProfilePage",
    "@id": url,
    url,
    inLanguage: opciones.sitio.idioma ?? "es",
    isPartOf: { "@id": idSitio(origen) },
    mainEntity: { "@id": idAutor(origen) },
  };
}

function limpiar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limpiar);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, limpiar(v)]),
    );
  }
  return valor;
}

/** Grafo JSON-LD listo para un <script type="application/ld+json">. No deja pasar «<». */
export function serializar(nodos: (Nodo | null | undefined)[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": limpiar(nodos.filter(Boolean)) }).replace(/</g, "\\u003c");
}
