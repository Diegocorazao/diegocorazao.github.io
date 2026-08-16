// ============================================================
// Configuración de la capa de IA.
//
// PROXY_URL: si está definida, TODOS los visitantes juegan con los agentes
// de IA activos — la API key vive en el proxy, nunca en el navegador.
// Déjala vacía ('') para que la IA quede desactivada por defecto y solo
// se pueda activar pegando una key propia.
//
// Se despliega con el Worker de /worker/worker.js (ver README).
// ============================================================
export const PROXY_URL = '';   // ej: 'https://mesa-btp.TUUSUARIO.workers.dev'
