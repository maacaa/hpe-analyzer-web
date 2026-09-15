# Requerimientos — HPE Analyzer Web

**Versión:** 1.1 · **Fecha:** 2026-09-14 · **Estado:** Aprobado para implementación
**Origen:** Auditoría del proyecto Electron `C:\Users\USUARIO\Documents\HPE Analyzer` (v1.2.0).
Superficie funcional verificada contra el código del renderer (App.tsx, tabs, summary.ts).

---

## 1. Objetivo

Migrar el analizador de logs HPE AHS (Active Health System) de aplicación Electron
de escritorio a una **aplicación web standalone**, optimizada para **parsear archivos
AHS de hasta 4 GB** sin bloquear la UI ni agotar la memoria del navegador.

### Fuera de alcance
- Modificar el proyecto original `Documents\HPE Analyzer` (queda intacto, solo lectura).
- Portar Electron, el CLI (`src/cli/`) y el lock por password (`LockGate`, `adapters/security/`): se eliminan en la web.

---

## 2. Requerimientos funcionales

### 2.1 Carga y análisis
| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| RF-1 | Cargar `.ahs` mediante drag & drop (DropZone) y file picker con `accept=".ahs"`; atajo de teclado **Ctrl/Cmd+O** | Alta |
| RF-2 | Parseo íntegro en un Web Worker: la UI nunca se bloquea durante el análisis | Alta |
| RF-3 | Progreso: % de bytes, record actual como fase, bytes procesados/total y **ETA estimada** (equivalente a ProgressBar.tsx); botón **Cancelar** que termina el worker | Alta |
| RF-4 | Pantalla de error recuperable ("Analysis failed" + mensaje + "Try again") | Alta |
| RF-5 | Al terminar: si hay RCA críticos, auto-seleccionar la pestaña RCA; header con meta del servidor (Product, SN, nombre de archivo) | Alta |
| RF-6 | Botón "Analyze another file" que resetea el estado completo (worker incluido) | Media |
| RF-7 | Panel "Recent files" (máx. 5). **En web, reabrir desde recientes debe recargar el análisis desde el cache local (RF-12), no solo mostrar el nombre** (limitación actual de api.ts:72) | Media |
| RF-8 | Enlace externo "Create HPE case" → https://support.hpe.com/connect/s/createcase?client=home | Baja |

### 2.2 Visualización (paridad 1:1 con las 6 pestañas actuales)
| ID | Pestaña | Contenido requerido |
|----|---------|---------------------|
| RF-9 | **Firmware** | Tabla agrupada por categoría: Component (con descripción), Version (badge "hex" cuando aplique), Build date. Contador de entradas |
| RF-10 | **Hardware** | Grid "Server information" (Product, Serial, Product ID, Order, UUID, Asset tag) + tarjetas agrupadas por tipo (Processor, DIMM, Storage controller, Hard drive, Network adapter, Video, Fan, Power supply, System board) con los ~31 campos de FIELD_ORDER y estado de salud OK/Warning/Failed |
| RF-11a | **IML Logs** | Tabla virtualizada (Date 160px, Severity, Code 0xCCCC/0xEEEE, Message) + filtro por severidad (All/Critical/Warning/Information) + búsqueda con debounce 200 ms + contadores "N total · M shown" |
| RF-11b | **Event Logs** | Igual que RF-11a sin columna Code (iel events) |
| RF-11c | **RCA** | Tarjetas: severidad, categoría, título, "Repeated N times · most recent date", componentes afectados, Cause (HPE), Resolution (HPE), link a documentación oficial, y bloques de "Known firmware issue" con estado affected/ok por versión |
| RF-11d | **Tips** | Advisories de firmware por versión/plataforma: severidad, título, descripción, resultados affected/ok con fix |
| RF-11e | Badges en tabs | RCA (nº críticos, estilo alerta), IML (imlCount), Events (eventCount), Tips (nº advisories, estilo alerta) |

### 2.3 Exportación y persistencia
| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| RF-12 | **Cache local IndexedDB** con fingerprint del archivo (name + size + lastModified + hash barato de primeros/últimos 64 KB): reabrir el mismo archivo es instantáneo y habilita RF-7 | Media |
| RF-13 | Exportar reporte `.txt` con la estructura exacta de summary.ts (header meta, Stats, Firmware, Hardware con health, RCA, Advisories) vía File System Access API con fallback a descarga | Media |

### 2.4 Fase posterior (Fase 3 — backend, definida, no implementada ahora)
| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| RF-14 | Servidor interno propio (Node + Fastify + SQLite, sin auth) que persista los análisis subidos por el worker, para abrirlos desde cualquier conexión | Futura |
| RF-15 | Endpoints: `GET /analyses`, `GET /analyses/:id`, `GET /analyses/:id/entries?tab&filter&sort&page` | Futura |
| RF-16 | IndexedDB como cache de segundo nivel (apertura offline) | Futura |

---

## 3. Requerimientos no funcionales (críticos para 4 GB)

| ID | Requerimiento | Justificación (hallazgo de auditoría) |
|----|---------------|----------------------------------------|
| RNF-1 | **Streaming end-to-end**: lectura del File por records (`file.slice`) y gunzip vía `DecompressionStream("gzip")` consumido por chunks (~8 MB). Memoria **O(chunk), no O(record)** | ahs-browser.js:76-95 materializa records de hasta 128 MiB + copia duplicada → picos de ~1 GB |
| RNF-2 | **Cero dependencias de Node en el bundle web**: prohibidos `Buffer`, `node:*`, `pako`. Usar `Uint8Array`, `DataView`, `TextDecoder("windows-1252"/"latin1")` | `Buffer` en ahs-browser.js:51,153 y en todo zbb.js/subformats.js → ReferenceError en navegador real |
| RNF-3 | Escáner zbb **incremental** con solape ≥64 bytes entre chunks (registros que cruzan fronteras) | extractLogEntries escanea buffer completo |
| RNF-4 | **Model residente en el worker** (query-response): el renderer recibe solo el resumen (stats, meta, firmware, hardware, rca, advisories, customerInfo — todo pequeño) y consulta IML/Events por páginas de ~500 filas vía RPC postMessage `{id, type:"query", tab, filter:{severity,text}, sort, page}` → `{id, rows, total}` | postMessage(model) duplica memoria y congela segundos con ~700k entradas |
| RNF-5 | Filtro/búsqueda/orden de IML/Events **ejecutados en el worker** (índice construido perezosamente en la primera query por criterio) | Filtrar 2M filas en el renderer anula el beneficio de RNF-4 |
| RNF-6 | Límites anti zip-bomb: MAX_RECORD_SIZE 1 GiB, MAX_DECOMPRESSED 128 MiB/record, MAX_TOTAL_DECOMPRESSED ≥ 8 GiB (configurable) | Cap actual de 4 GiB roza el caso de uso real |
| RNF-7 | Validación de memoria web equivalente al umbral de 500 MB de test:mem, medida con performance.measureUserAgentSpecificMemory o heap de DevTools | No existe medición web hoy |
| RNF-8 | Code-split diferido de la KB estática (iml-events.js, 825 KB) | Mayor peso del bundle |
| RNF-9 | Navegadores: Chrome/Edge ≥ 80, Firefox ≥ 105, Safari ≥ 16.4 (DecompressionStream) | — |
| RNF-10 | Stack: Vite + React 19 + TypeScript, ESM, `base:"./"`, build en `dist/web`; VirtualList propio (windowing + ResizeObserver + clamp) mantenido | Continuidad |
| RNF-11 | Cancelación: worker.terminate() libera toda la memoria del análisis en curso | — |

---

## 4. Arquitectura objetivo

```
Navegador
┌─────────────────────────────────────────────────┐
│ React UI: App + 6 tabs + DropZone/ProgressBar   │
│ + VirtualList (sin LockGate, sin Electron)      │
│      ▲ RPC postMessage: analyze/query/cancel    │
│ ┌────┴──────────────────────────────────┐       │
│ │ Web Worker: Model residente + índice  │       │
│ │ File API streaming + DecompressionStream      │
│ └────┬──────────────────────────────────┘       │
│ IndexedDB: cache por fingerprint (RF-12)        │
└─────────────────────────────────────────────────┘
      (Fase 3: HTTP → Node+Fastify+SQLite interno)
```

### Estructura del proyecto (carpeta nueva, sin tocar el original)
```
hpe-analyzer-web/
├── package.json                 # Sin Electron, sin pako
├── vite.config.ts / vitest / eslint / tsconfig
├── index.html
├── REQUIREMENTS.md              # Este documento
├── src/
│   ├── domain/                  # Copia sin cambios (entities, ports, usecases, services)
│   ├── adapters/
│   │   ├── parsers/             # Reescrito browser-only (RNF-2): ahs-browser, zbb, subformats, classify, record-dispatch
│   │   ├── kb/                  # Copia tal cual (carga diferida, RNF-8)
│   │   └── delivery/analyzer-web.js
│   ├── worker/analyze.worker.ts # Model residente + índice + RPC query-response (RNF-4/5)
│   ├── api/worker-client.ts     # Cliente RPC tipado: analyze/query/cancel
│   ├── cache/                   # IndexedDB fingerprint → Model (RF-12)
│   ├── components/              # Copia adaptada: tabs, DropZone, ProgressBar, VirtualList
│   ├── summary.ts               # Reporte .txt (estructura idéntica)
│   └── test/                    # Equivalencia + fixtures chunk-boundary + cache
```

---

## 5. Fases de implementación

| Fase | Contenido | Criterio de aceptación |
|------|-----------|------------------------|
| 0 | Scaffold + copia del core + higienización Buffer→DataView/TextDecoder | Build y tests en verde; sin `Buffer|pako|node:` en src/ |
| 1 | Streaming real: gunzip por chunks + escáner incremental (RNF-1/3) | Fixture sintético con record > chunk parsea idéntico al original |
| 2 | Query-response: worker residente, RPC paginado, tabs migradas con filtros en worker (RNF-4/5) | Sample 0.7 GB: ningún mensaje worker→UI >500 filas; filtros fluidos |
| 3 | UX 4 GB: cancelar, progreso+ETA, badges, auto-RCA, Ctrl+O, recientes desde cache | Cancelar libera el worker; paridad visual con la app actual |
| 4 | Cache IndexedDB (RF-12/13) | Reapertura del mismo archivo < 1 s; export idéntico |
| 5 | Validación: equivalence tests + benchmark memoria + lint/typecheck/test (RNF-7) | Todo en verde; memoria plana con archivo grande |

---

## 6. Riesgos y mitigaciones

1. **Regresión al reescribir parsers sin Buffer** → replicar `equivalence.test.js` del proyecto original (mismos fixtures) + fixture sintético que fuerce records mayores que el chunk.
2. **Índice de 2M filas en worker** → construirlo perezosamente en la primera query por criterio, no al terminar el parseo.
3. **DecompressionStream** → probar con los AHS reales de `AHS files/` (hasta 0.7 GB); ajustar caps (RNF-6) sin debilitar la guardia anti zip-bomb.
4. **TextDecoder y latin1** → usar `windows-1252` (súper-conjunto de latin1; el original usa Buffer.toString("latin1")); verificar equivalencia en tests.
5. **Fingerprint de cache** → barato (primeros/últimos 64 KB), nunca hash del archivo completo de 4 GB.
