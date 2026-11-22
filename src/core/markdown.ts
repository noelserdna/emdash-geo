// Versión Markdown de una página pública a partir del mismo HTML que ve una
// persona: se toma el contenido de <main>, se descarta lo que solo es interfaz
// y se antepone una cabecera con título, descripción, URL y autoría.
import { NodeHtmlMarkdown } from "node-html-markdown";
import { firmaAutor, origenDe, type OpcionesGeo } from "./config.ts";

const conversor = new NodeHtmlMarkdown({
  bulletMarker: "-",
  ignore: ["script", "style", "svg", "nav", "form", "button", "noscript", "template", "iframe", "dialog"],
  keepDataImages: false,
  maxConsecutiveNewlines: 2,
});

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

function texto(html: string | undefined): string {
  return (html ?? "").replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTIDADES[m] ?? m).trim();
}

function meta(html: string, atributo: "name" | "property", clave: string): string {
  return texto(html.match(new RegExp(`<meta ${atributo}="${clave}" content="([^"]*)"`, "i"))?.[1]);
}

export interface PaginaMarkdown {
  markdown: string;
  /** Estimación de tokens (≈ 4 caracteres por token). */
  tokens: number;
}

export function htmlAMarkdown(html: string, opciones: OpcionesGeo, ruta: string): PaginaMarkdown {
  const origen = origenDe(opciones);
  const finCabeza = html.indexOf("</head>");
  const cabeza = finCabeza >= 0 ? html.slice(0, finCabeza) : "";
  const titulo = texto(cabeza.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const descripcion = meta(cabeza, "name", "description");
  const canonica = texto(cabeza.match(/<link rel="canonical" href="([^"]*)"/i)?.[1]) || `${origen}${ruta === "/" ? "/" : ruta}`;
  const publicado = meta(cabeza, "property", "article:published_time");
  const modificado = meta(cabeza, "property", "article:modified_time");
  const firma = firmaAutor(opciones.autor);

  const inicio = html.indexOf("<main");
  const fin = html.lastIndexOf("</main>");
  const principal = inicio >= 0 && fin > inicio ? html.slice(html.indexOf(">", inicio) + 1, fin) : html;

  const cuerpo = conversor
    .translate(principal)
    // Enlaces e imágenes relativos → absolutos, para que sirvan fuera de la web.
    .replace(/\]\(\/(?!\/)/g, `](${origen}/`)
    // Negrita pegada a la palabra siguiente (dos bloques contiguos).
    .replace(/(\*\*[^*\n]+\*\*)(?=[\p{L}\d])/gu, "$1 ")
    .trim();

  const cabecera = [
    "---",
    `title: ${JSON.stringify(titulo)}`,
    descripcion ? `description: ${JSON.stringify(descripcion)}` : "",
    `url: ${canonica}`,
    firma ? `author: ${JSON.stringify(firma)}` : "",
    publicado ? `published: ${publicado}` : "",
    modificado ? `modified: ${modificado}` : "",
    `lang: ${opciones.sitio.idioma ?? "es"}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const markdown = `${cabecera}\n\n${cuerpo}\n`;
  return { markdown, tokens: Math.ceil(markdown.length / 4) };
}

const EXTENSION = /\.[a-z0-9]{2,5}$/i;

/** Páginas públicas de la web (no el panel, ni la API, ni ficheros). */
export function esPagina(ruta: string, prefijoApi = "/api"): boolean {
  if (ruta.startsWith("/_") || ruta.startsWith("/.well-known/") || ruta === "/mcp" || ruta === "/a2a" || ruta.startsWith("/agent/")) return false;
  if (ruta === prefijoApi || ruta.startsWith(`${prefijoApi}/`)) return false;
  return !EXTENSION.test(ruta);
}
