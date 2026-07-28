import { FirestoreService } from './firestoreService';

const NOMBRES = [
  'Juan Carlos Pérez', 'María Florencia Gómez', 'Lucas Emanuel Fernández', 'Agustina Benítez',
  'Gonzalo Rodríguez', 'Valentina Rossi', 'Santiago Martínez', 'Camila Alejandra López',
  'Mateo Nicolás Silva', 'Sofía Beatriz Castro', 'Joaquín Romero', 'Lucía Torres',
  'Esteban Peralta', 'Mariana Sosa', 'Diego Armando Díaz', 'Paula Vanesa Morales',
  'Facundo Gabriel Suárez', 'Rocío Belén Navarro', 'Martín Ezequiel Giménez', 'Daniela Ruiz',
  'Claudio Javier Acosta', 'Romina Soledad Carrizo', 'Maximiliano Godoy', 'Florencia Herrera',
  'Ignacio Medina', 'Valeria Ramos', 'Ramiro Benitez', 'Griselda Luna', 'Hernán Ferreyra', 'Gisela Arias'
];

const OBRAS_SOCIALES = [
  'OSDE 210', 'OSDE 310', 'Swiss Medical', 'Galeno 200', 'Medifé Plata',
  'PAMI Afiliado', 'IOMA', 'OMINT OXXO', 'Sancor Salud', 'Unión Personal'
];

const OPCIONES_TIPOS = [
  'A1_Turno_ORL_9Datos',
  'A2_Turno_Estudios_7Datos_Foto',
  'A3_Turno_Cirugias_6Datos_Foto',
  'B_Autorizacion_Estudios_Ordenes',
  'C_Consultas_Generales_Ayuda',
  'D_Afiliados_PAMI_3Datos',
  'E_Reprogramacion_Cancelacion'
];

// Generador de imagen SVG/dataURL de orden médica sintética
function generateSampleOrderSvgDataUrl(nombrePaciente: string, estudio: string, os: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">
    <rect width="400" height="280" fill="#f8fafc" rx="12" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="0" y="0" width="400" height="44" fill="#00a884" rx="12"/>
    <text x="20" y="28" font-family="sans-serif" font-size="16" font-weight="bold" fill="#ffffff">📋 PEDIDO MÉDICO - CLÍNICA</text>
    <text x="20" y="75" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">Paciente: ${nombrePaciente}</text>
    <text x="20" y="105" font-family="sans-serif" font-size="13" fill="#334155">Estudio: ${estudio}</text>
    <text x="20" y="135" font-family="sans-serif" font-size="13" fill="#334155">Obra Social / Prepaga: ${os}</text>
    <text x="20" y="165" font-family="sans-serif" font-size="13" fill="#334155">Diagnóstico Presuntivo: Control de Rutina / Valoración</text>
    <line x1="20" y1="210" x2="380" y2="210" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4"/>
    <text x="240" y="235" font-family="sans-serif" font-size="12" font-style="italic" fill="#00a884">Dr. M. Ramírez (M.P. 45123)</text>
    <text x="250" y="255" font-family="sans-serif" font-size="10" fill="#64748b">Firma y Sello Digitalizado</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export class SeedService {
  public static async generate70TestConsultas(env?: any): Promise<number> {
    const firestore = new FirestoreService(env);
    let count = 0;

    for (let i = 1; i <= 70; i++) {
      const nombre = NOMBRES[i % NOMBRES.length] + (i > 30 ? ` (${i})` : '');
      const dni = Math.floor(25000000 + Math.random() * 20000000).toString();
      const areaCode = ['11', '351', '261', '341', '381'][i % 5];
      const phoneNum = Math.floor(4000000 + Math.random() * 5999999).toString();
      const remitente = `+549${areaCode}${phoneNum}`;
      
      const os = OBRAS_SOCIALES[i % OBRAS_SOCIALES.length];
      const tipo = OPCIONES_TIPOS[i % OPCIONES_TIPOS.length];
      const estado = i <= 55 ? 'pendiente' : 'atendido';

      const tieneImagen = tipo.includes('Foto') || tipo.includes('Autorizacion');
      const simulatedDriveId = `demo_drive_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      const driveUrl = tieneImagen ? `https://drive.google.com/file/d/${simulatedDriveId}/view` : null;
      const sampleImgBase64 = tieneImagen ? generateSampleOrderSvgDataUrl(nombre, tipo.includes('ORL') ? 'Otorrinolaringología' : 'Ecografía / Radiografía', os) : null;

      const offsetMinutes = Math.floor(Math.random() * 300);
      const timestamp = new Date(Date.now() - offsetMinutes * 60000).toISOString();

      let contenidoMensaje = `1. Nombre: ${nombre}\n2. DNI: ${dni}\n3. Obra Social: ${os}\n4. Teléfono: ${remitente}`;

      if (tipo === 'A1_Turno_ORL_9Datos') {
        contenidoMensaje += `\n5. Nacimiento: 14/05/1990\n6. Email: paciente${i}@email.com\n7. Afiliado N°: 987654321\n8. Titular\n9. Dr. Otorrino preferido: Dr. Gómez`;
      } else if (tipo === 'A2_Turno_Estudios_7Datos_Foto') {
        contenidoMensaje += `\n5. Estudio: Ecografía Abdominal\n6. Disponibilidad: Mañana (9-12hs)\n📷 Foto del pedido médico adjunta`;
      } else if (tipo === 'D_Afiliados_PAMI_3Datos') {
        contenidoMensaje += `\n5. PAMI Afiliado N°: 15098765432100\n6. Solicitud: Medico de Cabecera`;
      }

      const datosEstructurados = {
        tipoSolicitud: tipo,
        contenidoMensaje,
        lineasParseadas: contenidoMensaje.split('\n'),
        imagenUrl: driveUrl,
        imagenBase64: sampleImgBase64,
        proveedorAlmacenamiento: tieneImagen ? 'google_drive' : null
      };

      await firestore.crearConsulta(remitente, tipo, datosEstructurados);
      
      if (estado === 'atendido') {
        const consultas = await firestore.getConsultas();
        const ultima = consultas[consultas.length - 1];
        if (ultima && ultima.id) {
          await firestore.actualizarEstadoConsulta(ultima.id, 'atendido');
        }
      }

      count++;
    }

    return count;
  }
}
