// Guarda borradores de formularios largos en el propio navegador (localStorage), para que si
// se corta la sesion, se pierde la conexion, o se cierra la pestana antes de poder guardar,
// lo que ya se habia escrito no se pierda.

const PREFIX = 'wellops_draft_';

export function saveDraft(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (e) {
    // localStorage lleno o deshabilitado (ej: modo privado) - no rompemos la app por esto
  }
}

export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearDraft(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (e) {
    // nada que hacer
  }
}
