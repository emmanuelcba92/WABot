import { CONFIG } from '../config';

export type ScheduleMode = 'auto' | 'always_open' | 'always_closed';

export interface ScheduleCheckResult {
  isWithinHours: boolean;
  dayOfWeek: string;
  hour: number;
  minute: number;
  timeZoneString: string;
  mode: ScheduleMode;
}

export class ScheduleService {
  private static currentMode: ScheduleMode = 'auto';

  public static getMode(): ScheduleMode {
    return this.currentMode;
  }

  public static setMode(mode: ScheduleMode): void {
    if (['auto', 'always_open', 'always_closed'].includes(mode)) {
      this.currentMode = mode;
    }
  }

  /**
   * Obtiene la fecha y hora desglosada en la Zona Horaria de Argentina (America/Argentina/Buenos_Aires).
   * Soporta simulatedTime ISO string para pruebas.
   */
  public static getArgentinaDateTime(simulatedIsoTime?: string): {
    dayOfWeekIndex: number; // 0 = Domingo, 1 = Lunes, ..., 5 = Viernes, 6 = Sábado
    dayName: string;
    hour: number;
    minute: number;
    formatted: string;
  } {
    const date = simulatedIsoTime ? new Date(simulatedIsoTime) : new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIG.TIMEZONE,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }

    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
    };

    const dayNameStr = partMap.weekday || 'Mon';
    const dayOfWeekIndex = dayMap[dayNameStr] ?? 1;

    let hour = parseInt(partMap.hour || '0', 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(partMap.minute || '0', 10);

    const formatted = `${partMap.year}-${partMap.month}-${partMap.day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${CONFIG.TIMEZONE})`;

    return {
      dayOfWeekIndex,
      dayName: dayNameStr,
      hour,
      minute,
      formatted
    };
  }

  /**
   * Verifica si el momento actual (o simulado) se encuentra dentro del horario de atención:
   * Lunes a Viernes de 08:00 a 20:00 hs (America/Argentina/Buenos_Aires), o según el modo manual configurado.
   */
  public static isWithinBusinessHours(simulatedIsoTime?: string, overrideMode: ScheduleMode = 'auto'): ScheduleCheckResult {
    const argTime = this.getArgentinaDateTime(simulatedIsoTime);

    if (overrideMode === 'always_open') {
      return {
        isWithinHours: true,
        dayOfWeek: argTime.dayName,
        hour: argTime.hour,
        minute: argTime.minute,
        timeZoneString: `${argTime.formatted} [MODO MANUAL: SIEMPRE ABIERTO]`,
        mode: 'always_open'
      };
    }

    if (overrideMode === 'always_closed') {
      return {
        isWithinHours: false,
        dayOfWeek: argTime.dayName,
        hour: argTime.hour,
        minute: argTime.minute,
        timeZoneString: `${argTime.formatted} [MODO MANUAL: SIEMPRE CERRADO]`,
        mode: 'always_closed'
      };
    }

    const isWorkDay = CONFIG.BUSINESS_HOURS.WORK_DAYS.includes(argTime.dayOfWeekIndex);
    const isWithinTimeRange = argTime.hour >= CONFIG.BUSINESS_HOURS.START_HOUR && argTime.hour < CONFIG.BUSINESS_HOURS.END_HOUR;
    const isWithinHours = isWorkDay && isWithinTimeRange;

    return {
      isWithinHours,
      dayOfWeek: argTime.dayName,
      hour: argTime.hour,
      minute: argTime.minute,
      timeZoneString: `${argTime.formatted} [AUTOMÁTICO]`,
      mode: 'auto'
    };
  }
}
