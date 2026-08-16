// ============================================================
// Configuración de la capa de IA.
//
// PROXY_URL: si está definida, TODOS los visitantes juegan con los agentes
// de IA activos — la API key vive en el proxy (Cloudflare Worker), nunca
// en el navegador ni en el repositorio.
// Déjala vacía ('') para desactivar la IA por defecto.
// ============================================================
export const PROXY_URL = 'https://mesa-btp.diegocorazaobejar.workers.dev';
