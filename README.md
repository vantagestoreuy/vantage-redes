# Vantage UY — publicación automática

- Claude arma el contenido cada mañana y lo agrega a `cola.json` con sus imágenes en `posts/AAAA-MM-DD/`.
- GitHub Actions (`.github/workflows/publicar.yml`) corre cada 15 minutos y publica en Instagram y Facebook lo que ya llegó a su hora.
- `estado.json` registra qué se publicó y los errores.

**Frenar una publicación:** editá `cola.json` y cambiá `"estado": "aprobado"` por `"estado": "pausado"`.
**Ver qué pasó:** pestaña Actions del repo (verde = bien, rojo = hubo un error; tocá la corrida para ver el detalle).
**Token:** se guarda en Settings → Secrets and variables → Actions → `META_TOKEN`.
