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
        proveedorAlmacenamiento: tieneImagen ? 'google_drive' : null
      };

      await firestore.crearConsulta(remitente, tipo, datosEstructurados);
      
      // Si está atendido, actualizar estado
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
