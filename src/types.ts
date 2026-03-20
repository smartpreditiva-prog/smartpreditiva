export interface Equipment {
  id: string;
  nome: string; // Chave usada pelo ESP32 (ex: bomba_recalque_1)
  tipo: string;
  condominio: string;
  localizacao: string;
  fabricante: string;
  modelo: string;
  corrente_nominal: number;
  pressao_nominal: number;
  temperatura_maxima: number;
  data_instalacao: string;
}

export interface Leitura {
  id?: number;
  created_at?: string;
  placa_id: string;
  tipo_placa: string;
  condominio: string;
  equipamento: string; // Deve bater com Equipment.nome
  timestamp: number;
  corrente?: number;
  temperatura?: number;
  pressao?: number;
}

export type EquipmentType = 'bomba_recalque' | 'bomba_piscina' | 'exaustor' | 'pressao';
