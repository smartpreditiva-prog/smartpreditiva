export interface Leitura {
  id?: number;
  created_at?: string;
  placa_id: string;
  tipo_placa: string;
  condominio: string;
  equipamento: string;
  timestamp: number;
  corrente?: number;
  temperatura?: number;
  pressao?: number;
}

export type EquipmentType = 'bomba_recalque' | 'bomba_piscina' | 'exaustor' | 'pressao';

export interface EquipmentStatus {
  name: string;
  type: EquipmentType;
  lastReading?: Leitura;
  isOnline: boolean;
  isOn: boolean;
}
