# Growa · Mapa económico DENUE de Mazatlán

Aplicación web estática para consultar la estructura económica de Mazatlán por AGEB, zona analítica, código postal, sector SCIAN, tamaño del establecimiento y año.

## Contenido del repositorio

- `index.html`: interfaz de la aplicación.
- `styles.css`: diseño adaptable para computadora, tableta y celular.
- `app.js`: filtros, cálculos, mapa, indicadores, gráfica y descarga de CSV.
- `data/manifest.json`: catálogo de años, sectores, tamaños y zonas.
- `data/ageb_catalog.json`: información territorial complementaria por AGEB.
- `data/years/`: archivos anuales agregados de 2010 a 2026.
- `.github/workflows/static.yml`: publicación automática en GitHub Pages.
- `METODOLOGIA.md`: alcance y criterios de cálculo.
- `FUENTES.md`: fuentes de información.

## Publicar en un repositorio nuevo

1. Crea un repositorio público vacío en GitHub, por ejemplo `growa-mapa-denue`.
2. Descomprime el ZIP.
3. Sube **el contenido de la carpeta**, no la carpeta ZIP sin descomprimir.
4. Confirma que `index.html` quede en la raíz del repositorio.
5. Guarda los archivos en la rama `main`.
6. En GitHub abre `Settings` → `Pages`.
7. En `Build and deployment`, selecciona `GitHub Actions`.
8. Abre la pestaña `Actions` y espera a que termine el flujo `Deploy static content to Pages`.

La dirección tendrá esta forma:

```text
https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/
```

## Probar localmente

No abras `index.html` directamente con doble clic, porque el navegador puede bloquear la lectura de los archivos JSON. Ejecuta:

```bash
python serve_local.py
```

Después abre:

```text
http://localhost:8000
```

## Integración con Hostinger

Una vez publicado, puede incrustarse con:

```html
<div style="width:100%;height:calc(100dvh - 80px);min-height:720px;overflow:hidden;">
  <iframe
    src="https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/"
    title="Growa · Inteligencia económica territorial"
    style="display:block;width:100%;height:100%;border:0;"
    loading="eager"
    allowfullscreen>
  </iframe>
</div>
```

## Nota de interpretación

Los conteos representan establecimientos registrados en el DENUE. Los cambios entre ediciones pueden incluir altas, bajas, reclasificaciones, depuración y mejoras de cobertura; no equivalen automáticamente a creación o cierre neto de empresas.
