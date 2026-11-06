# MILLIONAIRE CITY

MVP multijugador 3D para navegador. Incluye ciudad 3D procedural con Three.js, cámara en tercera persona, movimiento WASD, correr, avatares remotos, chat global, trabajos con recompensas, tragaperras con resultado calculado en servidor, economía compartida y persistencia PostgreSQL.

## Requisitos
- Node.js 20+
- PostgreSQL 14+ (opcional para probar en memoria; obligatorio para cuentas persistentes y despliegue real)

## Ejecutar localmente
```bash
npm install
cp .env.example .env
# Configura DATABASE_URL y SESSION_SECRET en .env
npm start
```
Abre http://localhost:3000. Para desarrollo, `npm run dev`.

Sin `DATABASE_URL` se activa un modo temporal en memoria: sirve para probar la experiencia, pero no conserva cuentas ni saldo al reiniciar. El login persistente requiere PostgreSQL.

## Despliegue en Render
1. Sube este proyecto a un repositorio Git.
2. En Render crea un Blueprint desde el repositorio y acepta `render.yaml`.
3. Render crea el servicio web y PostgreSQL y configura `DATABASE_URL`.
4. Espera a que `/health` responda `{"ok":true,...}`.

## Controles
- WASD: caminar
- Shift: correr
- Ratón: cámara (clic en el mundo para capturar; ESC libera)
- Panel lateral: trabajos, tragaperras y chat

## Seguridad y límites de esta versión
- Las recompensas de trabajos y los resultados de tragaperras se calculan en el servidor; el cliente no envía el saldo ni el resultado.
- El saldo es global para toda la instancia del servidor.
- El movimiento se valida con un límite básico de desplazamiento por paquete. Para producción debe sustituirse por simulación autoritativa con ticks, velocidades, colisiones y rate limits.
- Las sesiones actuales viven en memoria. Para producción, migrar a sesiones persistentes (Redis o tabla de sesiones), cookies seguras, CSRF y límites de intentos.
- En esta entrega solo está implementada la tragaperras como minijuego de casino. Blackjack, ruleta, carreras, vehículos conducibles, inventario/armas, robos, policía, garajes, minimapa y victoria cinematográfica son fases posteriores, no se presentan como funcionalidad terminada.
- El mundo usa geometría procedural sencilla y no contiene assets artísticos de producción.
- Las apuestas son moneda virtual de juego, sin dinero real.

## Arquitectura
- `public/`: cliente Three.js, HUD y estilos.
- `server/index.js`: Express, Socket.IO, reglas de economía y acciones autoritativas.
- `server/schema.sql`: jugadores, estado colectivo, historial y progreso.
- `render.yaml`: servicio web y PostgreSQL para Render.

## Siguientes hitos recomendados
1. Persistir sesiones y añadir reconexión segura.
2. Sustituir el movimiento cliente por simulación autoritativa y añadir colisiones.
3. Implementar vehículos con física arcade y garajes.
4. Construir casino interior y mesas con estados sincronizados.
5. Añadir blackjack/ruleta con motor de reglas y pruebas.
6. Sistema de misiones, policía arcade e inventario.
7. Optimización: instancing, LOD, chunks, límites de entidades y métricas.
