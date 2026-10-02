# Vantage UY — cola de publicaciones

Este repo lo actualiza Claude todos los días. n8n lee `cola.json` (vía GitHub Pages) y publica en Instagram y Facebook.

- Para frenar una publicación: editá `cola.json` y cambiá `"estado": "aprobado"` por `"estado": "pausado"`.
- Las imágenes de cada día están en `posts/AAAA-MM-DD/`.
