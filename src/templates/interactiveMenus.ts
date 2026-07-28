import {
  InteractiveMessage,
  InteractiveButtonMessage,
  InteractiveListMessage
} from '../types';

// ─────────────────────────────────────────────────────────────────
// Menú Principal: Lista (5 opciones → ideal para WhatsApp listas)
// ─────────────────────────────────────────────────────────────────
export const MENU_PRINCIPAL: InteractiveListMessage = {
  type: 'list',
  bodyText: '🏥 *¡Bienvenido/a a la Clínica Médica!*\nPor favor seleccioná la opción que necesitás:',
  buttonLabel: '📋 Ver Opciones',
  sections: [
    {
      title: '🗂️ ¿Qué necesitás?',
      rows: [
        { id: 'A', title: '📅 Solicitar Turno', description: 'Consultas, Estudios o Cirugías' },
        { id: 'B', title: '📋 Autorización de Estudios', description: 'Órdenes y pedidos médicos' },
        { id: 'C', title: '💬 Consultas Generales', description: 'Ayuda e información general' },
        { id: 'D', title: '🩺 Afiliados PAMI', description: 'Trámites y turnos PAMI' },
        { id: 'E', title: '🔄 Reprogramar Turno', description: 'Cancelación o cambio de fecha' },
      ]
    }
  ]
};

// ─────────────────────────────────────────────────────────────────
// Submenú Opción A: Botones (3 opciones → ideal para WA buttons)
// ─────────────────────────────────────────────────────────────────
export const SUBMENU_TURNOS: InteractiveButtonMessage = {
  type: 'button',
  bodyText: '📅 *SOLICITUD DE TURNOS*\nSeleccioná el tipo de consulta:',
  buttons: [
    { id: '1', title: 'Médico ORL', emoji: '👂' },
    { id: '2', title: 'Estudios Médicos', emoji: '🔬' },
    { id: '3', title: 'Cirugías', emoji: '🏥' },
  ]
};

// ─────────────────────────────────────────────────────────────────
// Helpers para texto plano (fallback SMS/sin soporte interactivo)
// ─────────────────────────────────────────────────────────────────
export function interactiveToPlainText(msg: InteractiveMessage): string {
  if (msg.type === 'button') {
    const opciones = msg.buttons.map(b => `${b.emoji || ''} *${b.id})* ${b.title}`).join('\n');
    return `${msg.bodyText}\n\n${opciones}`;
  }
  // list
  const rows = msg.sections.flatMap(s =>
    s.rows.map(r => `*${r.id})* ${r.title}${r.description ? `\n   _${r.description}_` : ''}`)
  );
  return `${msg.bodyText}\n\n${rows.join('\n')}`;
}
