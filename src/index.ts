// API pública: el descriptor para `emdash({ plugins: [geo({...})] })` y el
// envoltorio del Worker. Ambos reciben las mismas opciones.
import type { PluginDescriptor } from "emdash";
import { ID_PLUGIN, VERSION, type OpcionesGeo } from "./core/config.ts";
import { esquemaAjustes, permisos } from "./plugin.ts";

export type { AutorGeo, ColeccionGeo, OpcionesGeo, PaginaGeo, SenalesGeo } from "./core/config.ts";
export { withGeo, type ManejadorEnvuelto, type ManejadorFetch, type OpcionesWorkerGeo } from "./worker/index.ts";
export { ID_PLUGIN, VERSION };

export function geo(opciones: OpcionesGeo): PluginDescriptor<OpcionesGeo> {
  return {
    id: ID_PLUGIN,
    version: VERSION,
    entrypoint: "emdash-geo/plugin",
    format: "native",
    options: opciones,
    ...permisos(opciones),
    settingsSchema: esquemaAjustes(opciones),
  };
}
