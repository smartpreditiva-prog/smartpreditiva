/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { Leitura, Equipment } from './types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  Activity, 
  Thermometer, 
  Gauge, 
  Droplets, 
  Wind, 
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Settings,
  FileText,
  LayoutDashboard,
  Plus,
  ChevronRight,
  Download,
  Calendar,
  ArrowLeft,
  Loader2
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { format, subDays, subWeeks, subMonths, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const REFRESH_INTERVAL = 30000;

type View = 'dashboard' | 'equipment' | 'reports' | 'equipment-detail';

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [selectedEquip, setSelectedEquip] = useState<Equipment | null>(null);
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('day');
  
  // Dashboard filters
  const [dashFilters, setDashFilters] = useState({
    condominio: 'Todos',
    tipo: 'Todos',
    search: ''
  });

  // Report filters
  const [reportRange, setReportRange] = useState({
    start: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  const [reportData, setReportData] = useState<Leitura[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const formatTimestamp = (ts: number, pattern: string = 'dd/MM HH:mm:ss') => {
    const time = ts > 1000000000000 ? Math.floor(ts / 1000) : ts;
    return format(new Date(time * 1000), pattern);
  };

  const allAvailableEquipments = useMemo(() => {
    const registered = equipments.map(e => e.nome);
    const fromLeituras = new Set<string>();
    leituras.forEach(l => {
      const id = l.equipamento || l.placa_id;
      if (id) {
        const config = equipments.find(e => e.nome === id || e.id === id);
        fromLeituras.add(config ? config.nome : id);
      }
    });
    
    const all = [...equipments];
    fromLeituras.forEach(id => {
      if (!registered.includes(id)) {
        all.push({
          id: id,
          nome: id,
          localizacao: `Dispositivo ${id}`,
          tipo: 'desconhecido',
          condominio: 'Não Cadastrado',
          fabricante: '',
          modelo: '',
          corrente_nominal: 0,
          pressao_nominal: 0,
          temperatura_maxima: 0,
          data_instalacao: ''
        });
      }
    });
    return all;
  }, [equipments, leituras]);

  const [selectedEquipments, setSelectedEquipments] = useState<string[]>([]);

  const fetchData = React.useCallback(async () => {
    try {
      let query = supabase.from('leituras').select('*').order('timestamp', { ascending: false });
      
      const now = Math.floor(Date.now() / 1000);
      let startTime = 0;
      
      if (timeRange === 'day') {
        startTime = now - (24 * 60 * 60);
        query = query.limit(500); // Limit for performance but enough for a day
      } else if (timeRange === 'week') {
        startTime = now - (7 * 24 * 60 * 60);
        query = query.limit(2000);
      } else if (timeRange === 'month') {
        startTime = now - (30 * 24 * 60 * 60);
        query = query.limit(5000);
      }
      
      if (startTime > 0) {
        query = query.gte('timestamp', startTime);
      }

      const [leiturasRes, equipRes] = await Promise.all([
        query,
        supabase.from('equipamentos').select('*')
      ]);

      if (leiturasRes.data) setLeituras(leiturasRes.data);
      if (equipRes.data) {
        setEquipments(equipRes.data);
      }
      
      // Initialize selection if empty, including unregistered devices found in readings
      setSelectedEquipments(prev => {
        if (prev.length === 0) {
          const registered = (equipRes.data || []).map(e => e.nome);
          const fromLeituras = new Set<string>();
          (leiturasRes.data || []).forEach(l => {
            const id = l.equipamento || l.placa_id;
            if (id) {
              const config = (equipRes.data || []).find(e => e.nome === id || e.id === id);
              fromLeituras.add(config ? config.nome : id);
            }
          });
          const all = Array.from(new Set([...registered, ...fromLeituras]));
          return all;
        }
        return prev;
      });
      
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leituras' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipamentos' }, () => fetchData())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchData, timeRange]);

  const equipmentStats = useMemo(() => {
    const stats: Record<string, { last?: Leitura, config?: Equipment }> = {};
    
    // Initialize with registered equipments
    equipments.forEach(e => {
      stats[e.nome] = { config: e };
    });

    // Add last readings
    leituras.forEach((l) => {
      const id = l.equipamento || l.placa_id;
      if (!id) return;
      
      // Find the equipment config to get its 'nome' (ID Placa)
      const config = equipments.find(e => e.nome === id || e.id === id);
      const name = config ? config.nome : id;
      
      if (!stats[name]) stats[name] = {};
      if (!stats[name].last || l.timestamp > (stats[name].last?.timestamp || 0)) {
        stats[name].last = l;
      }
      
      // Also store under the raw ID if it's different from the name
      if (config && config.id !== name) {
        stats[config.id] = stats[name];
      }
    });
    
    return stats;
  }, [leituras, equipments]);

  const condominios = useMemo(() => {
    const set = new Set(equipments.map(e => e.condominio).filter(Boolean));
    return ['Todos', ...Array.from(set)];
  }, [equipments]);

  const filteredStats = useMemo(() => {
    return Object.entries(equipmentStats).filter(([name, data]) => {
      const { config } = data as { last?: Leitura, config?: Equipment };
      const matchesCondo = dashFilters.condominio === 'Todos' || config?.condominio === dashFilters.condominio;
      const matchesTipo = dashFilters.tipo === 'Todos' || config?.tipo === dashFilters.tipo;
      const matchesSearch = !dashFilters.search || 
        (config?.localizacao || '').toLowerCase().includes(dashFilters.search.toLowerCase()) ||
        name.toLowerCase().includes(dashFilters.search.toLowerCase());
      
      return matchesCondo && matchesTipo && matchesSearch;
    });
  }, [equipmentStats, dashFilters]);

  const getStatusColor = (reading?: Leitura) => {
    if (!reading) return 'text-slate-400';
    const now = Math.floor(Date.now() / 1000);
    const isOnline = now - reading.timestamp < 300; // 5 minutes
    return isOnline ? 'text-emerald-500' : 'text-rose-500';
  };

  const isDeviceOn = (reading?: Leitura) => {
    if (!reading || reading.corrente == null) return false;
    return reading.corrente > 0.5; // Threshold for "On"
  };

  const [newEquip, setNewEquip] = useState<Partial<Equipment>>({
    nome: '',
    tipo: 'bomba_recalque',
    condominio: '',
    localizacao: '',
    fabricante: '',
    modelo: '',
    corrente_nominal: 0,
    pressao_nominal: 0,
    temperatura_maxima: 0
  });

  const handleSaveEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const { error } = await supabase
          .from('equipamentos')
          .update(newEquip)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('equipamentos').insert([newEquip]);
        if (error) throw error;
      }
      setIsModalOpen(false);
      setEditingId(null);
      setNewEquip({
        nome: '',
        tipo: 'bomba_recalque',
        condominio: '',
        localizacao: '',
        fabricante: '',
        modelo: '',
        corrente_nominal: 0,
        pressao_nominal: 0,
        temperatura_maxima: 0
      });
      fetchData();
    } catch (err: any) {
      console.error('Erro ao salvar equipamento:', err);
      if (err.code === '23505') {
        alert('Erro: O ID da Placa já está cadastrado para outro equipamento.');
      } else {
        alert('Erro ao salvar equipamento. Verifique os dados e tente novamente.');
      }
    }
  };

  const handleEditEquipment = (equip: Equipment) => {
    setNewEquip(equip);
    setEditingId(equip.id);
    setIsModalOpen(true);
  };

  const handleDeleteEquipment = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este equipamento?')) return;
    try {
      const { error } = await supabase.from('equipamentos').delete().eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Erro ao excluir equipamento:', err);
      alert('Erro ao excluir equipamento.');
    }
  };

  const chartData = useMemo(() => {
    const dataMap: Record<number, any> = {};
    
    // Sort readings by timestamp
    const sortedLeituras = [...leituras].sort((a, b) => a.timestamp - b.timestamp);
    
    sortedLeituras.forEach(l => {
      // Handle both seconds and milliseconds timestamps
      const rawTime = l.timestamp;
      const time = rawTime > 1000000000000 ? Math.floor(rawTime / 1000) : rawTime;
      
      if (!dataMap[time]) {
        let displayTime = format(new Date(time * 1000), 'HH:mm');
        if (timeRange !== 'day') {
          displayTime = format(new Date(time * 1000), 'dd/MM HH:mm');
        }
        
        dataMap[time] = { 
          timestamp: time,
          displayTime
        };
      }
      
      // Use equipment ID (nome) or placa_id as the key
      const id = l.equipamento || l.placa_id;
      if (!id) return;

      // Find the equipment config to get its 'nome' (ID Placa)
      const config = equipments.find(e => e.nome === id || e.id === id);
      const keyId = config ? config.nome : id;

      const parseVal = (v: any) => {
        if (v == null) return null;
        const n = Number(String(v).replace(',', '.'));
        return isNaN(n) ? null : n;
      };

      if (l.corrente != null) dataMap[time][`corrente_${keyId}`] = parseVal(l.corrente);
      if (l.pressao != null) dataMap[time][`pressao_${keyId}`] = parseVal(l.pressao);
      if (l.temperatura != null) dataMap[time][`temperatura_${keyId}`] = parseVal(l.temperatura);
    });

    const result = Object.values(dataMap).sort((a: any, b: any) => a.timestamp - b.timestamp);
    console.log('Chart Data points:', result.length);
    return result;
  }, [leituras]);

  const equipmentColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const renderDashboard = () => {
    const totalEquips = equipments.length;
    const onlineEquips = (Object.values(equipmentStats) as { last?: Leitura, config?: Equipment }[]).filter(s => 
      s.last && (Math.floor(Date.now() / 1000) - s.last.timestamp < 300)
    ).length;
    const offlineEquips = totalEquips - onlineEquips;
    const alertsCount = (Object.values(equipmentStats) as { last?: Leitura, config?: Equipment }[]).filter(s => {
      const reading = s.last;
      const config = s.config;
      const isOverNominal = reading?.corrente && config?.corrente_nominal ? reading.corrente > config.corrente_nominal * 1.1 : false;
      const isOverTemp = reading?.temperatura && config?.temperatura_maxima ? reading.temperatura > config.temperatura_maxima : false;
      return isOverNominal || isOverTemp;
    }).length;

    return (
      <div className="space-y-8 pb-20 lg:pb-0">
        {/* Header with Quick Action */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-800">Monitoramento em Tempo Real</h1>
            <p className="text-sm text-slate-500 font-medium">Status atual de todos os ativos monitorados</p>
            {lastUpdate && (
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Última atualização: {format(lastUpdate, 'HH:mm:ss')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => fetchData()}
              className="p-2.5 bg-white border border-slate-100 rounded-2xl text-slate-400 hover:text-emerald-500 transition-colors shadow-sm"
              title="Atualizar dados"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={() => setView('equipment')}
              className="bg-emerald-500 text-white px-5 py-2.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" /> Gerenciar Equipamentos
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total de Ativos</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter">{totalEquips}</span>
              <span className="text-xs text-slate-400 font-bold">UNIDADES</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Online agora</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter text-emerald-500">{onlineEquips}</span>
              <span className="text-xs text-emerald-400 font-bold">ATIVOS</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Offline</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter text-rose-500">{offlineEquips}</span>
              <span className="text-xs text-rose-400 font-bold">ATIVOS</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-1">Alertas Ativos</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter text-orange-500">{alertsCount}</span>
              <span className="text-xs text-orange-400 font-bold">OCORRÊNCIAS</span>
            </div>
          </div>
        </section>

        {/* Filters Bar */}
      <section className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] relative">
          <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Buscar equipamento..."
            value={dashFilters.search}
            onChange={(e) => setDashFilters(prev => ({ ...prev, search: e.target.value }))}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Condomínio:</span>
          <select 
            value={dashFilters.condominio}
            onChange={(e) => setDashFilters(prev => ({ ...prev, condominio: e.target.value }))}
            className="bg-slate-50 border-none rounded-xl text-xs font-bold py-2 px-3 focus:ring-0"
          >
            {condominios.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo:</span>
          <select 
            value={dashFilters.tipo}
            onChange={(e) => setDashFilters(prev => ({ ...prev, tipo: e.target.value }))}
            className="bg-slate-50 border-none rounded-xl text-xs font-bold py-2 px-3 focus:ring-0"
          >
            <option value="Todos">Todos os Tipos</option>
            <option value="bomba_recalque">Bomba Recalque</option>
            <option value="bomba_piscina">Bomba Piscina</option>
            <option value="exaustor">Exaustor</option>
            <option value="pressao">Pressão</option>
          </select>
        </div>
      </section>

      {/* Status Overview */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredStats.length === 0 ? (
          <div className="col-span-full bg-white p-12 rounded-3xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
            <div className="bg-slate-50 p-4 rounded-full mb-4">
              <Activity className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Nenhum Ativo Monitorado</h3>
            <p className="text-sm text-slate-500 max-w-xs">Cadastre seus equipamentos para começar a receber dados de monitoramento em tempo real.</p>
            <button 
              onClick={() => setView('equipment')}
              className="mt-6 text-emerald-600 font-bold text-sm flex items-center gap-2 hover:underline"
            >
              <Plus className="w-4 h-4" /> Cadastrar Primeiro Equipamento
            </button>
          </div>
        ) : (
          filteredStats.map(([name, data]: [string, any]) => {
            const reading = data.last as Leitura | undefined;
            const config = data.config as Equipment | undefined;
            const isOnline = reading ? (Math.floor(Date.now() / 1000) - reading.timestamp < 300) : false;
            const isOn = reading?.corrente ? reading.corrente > 0.5 : false;
            const isOverNominal = reading?.corrente && config?.corrente_nominal ? reading.corrente > config.corrente_nominal * 1.1 : false;
            const isOverTemp = reading?.temperatura && config?.temperatura_maxima ? reading.temperatura > config.temperatura_maxima : false;

            return (
              <div 
                key={name} 
                className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  if (config) {
                    setSelectedEquip(config);
                    setView('equipment-detail');
                  } else {
                    setNewEquip({
                      nome: name,
                      tipo: 'bomba_recalque',
                      condominio: '',
                      localizacao: '',
                      fabricante: '',
                      modelo: '',
                      corrente_nominal: 0,
                      pressao_nominal: 0,
                      temperatura_maxima: 0
                    });
                    setEditingId(null);
                    setView('equipment');
                    setIsModalOpen(true);
                  }
                }}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl ${isOn ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                    {name.toLowerCase().includes('bomba') ? <Droplets className={isOn ? 'text-emerald-600' : 'text-slate-400'} /> : 
                     name.toLowerCase().includes('exaustor') ? <Wind className={isOn ? 'text-emerald-600' : 'text-slate-400'} /> :
                     <Gauge className={isOn ? 'text-emerald-600' : 'text-slate-400'} />}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {!config && (
                      <span className="bg-amber-100 text-amber-700 text-[8px] font-black px-2 py-0.5 rounded-full mb-1">
                        NÃO CADASTRADO
                      </span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                      <span className={`text-[10px] font-bold uppercase tracking-tighter ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    {(isOverNominal || isOverTemp) && (
                      <span className="text-[9px] font-black bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                        <AlertCircle className="w-2 h-2" /> {isOverNominal ? 'SOBRECARGA' : 'ALTA TEMP.'}
                      </span>
                    )}
                  </div>
                </div>
                
                <h3 className="text-sm font-bold text-slate-800 capitalize mb-1">
                  {config?.localizacao || name.replace(/_/g, ' ')}
                </h3>
                <p className="text-[10px] text-slate-400 font-medium uppercase mb-3">{config?.condominio || 'Não Cadastrado'}</p>
                
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black tracking-tighter">
                    {reading?.corrente != null ? `${reading.corrente.toFixed(1)}A` : 
                     reading?.pressao != null ? `${reading.pressao.toFixed(2)}kgf` : '--'}
                  </span>
                  {config?.corrente_nominal && reading?.corrente != null && (
                    <span className="text-[10px] text-slate-400 font-mono">/ {config.corrente_nominal}A nom.</span>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Thermometer className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{reading?.temperatura != null ? `${reading.temperatura.toFixed(1)}°C` : '--°C'}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {isOn ? 'EM OPERAÇÃO' : 'DESLIGADO'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Charts Section */}
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Activity className="text-emerald-500 w-5 h-5" /> Monitoramento de Ativos
            </h2>
            <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
              {(['day', 'week', 'month'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                    timeRange === range 
                      ? 'bg-white text-emerald-600 shadow-sm' 
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {range === 'day' ? '24h' : range === 'week' ? '7 Dias' : '30 Dias'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {allAvailableEquipments.map((e, idx) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setSelectedEquipments(prev => 
                      prev.includes(e.nome) 
                        ? prev.filter(id => id !== e.nome)
                        : [...prev, e.nome]
                    );
                  }}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${
                    selectedEquipments.includes(e.nome)
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-200'
                  }`}
                >
                  {e.localizacao}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Corrente (A)</h3>
              <div className="h-[300px] relative">
                {chartData.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Sem dados de corrente</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} syncId="dashboard-charts">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="displayTime" fontSize={10} tick={{ fill: '#94a3b8' }} />
                      <YAxis fontSize={10} tick={{ fill: '#94a3b8' }} domain={[0, 'auto']} allowDecimals={true} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '10px' }} />
                      {allAvailableEquipments.filter(e => selectedEquipments.includes(e.nome)).map((e, idx) => (
                        <Area 
                          key={e.nome} 
                          type="monotone" 
                          dataKey={`corrente_${e.nome}`} 
                          name={e.localizacao || e.nome}
                          stroke={equipmentColors[idx % equipmentColors.length]} 
                          fill={`${equipmentColors[idx % equipmentColors.length]}22`} 
                          strokeWidth={2.5} 
                          connectNulls
                          animationDuration={500}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Temperatura (°C)</h3>
              <div className="h-[300px] relative">
                {chartData.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Sem dados de temperatura</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} syncId="dashboard-charts">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="displayTime" fontSize={10} tick={{ fill: '#94a3b8' }} />
                      <YAxis fontSize={10} tick={{ fill: '#94a3b8' }} domain={['auto', 'auto']} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '10px' }} />
                      {allAvailableEquipments.filter(e => selectedEquipments.includes(e.nome)).map((e, idx) => (
                        <Area 
                          key={e.nome} 
                          type="monotone" 
                          dataKey={`temperatura_${e.nome}`} 
                          name={e.localizacao || e.nome}
                          stroke={equipmentColors[(idx + 1) % equipmentColors.length]} 
                          fill={`${equipmentColors[(idx + 1) % equipmentColors.length]}22`} 
                          strokeWidth={2.5} 
                          connectNulls
                          animationDuration={500}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Pressão (kgf/cm²)</h3>
              <div className="h-[300px] relative">
                {chartData.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Sem dados de pressão</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} syncId="dashboard-charts">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="displayTime" fontSize={10} tick={{ fill: '#94a3b8' }} />
                      <YAxis fontSize={10} tick={{ fill: '#94a3b8' }} domain={[0, 'auto']} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '10px' }} />
                      {allAvailableEquipments.filter(e => (e.tipo === 'pressao' || e.tipo === 'desconhecido') && selectedEquipments.includes(e.nome)).map((e, idx) => (
                        <Area 
                          key={e.nome} 
                          type="monotone" 
                          dataKey={`pressao_${e.nome}`} 
                          name={e.localizacao || e.nome}
                          stroke={equipmentColors[(idx + 2) % equipmentColors.length]} 
                          fill={`${equipmentColors[(idx + 2) % equipmentColors.length]}22`} 
                          strokeWidth={2.5} 
                          connectNulls
                          animationDuration={500}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Logs Table */}
      <section className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex justify-between items-center">
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Clock className="text-slate-400 w-5 h-5" /> Histórico Recente
          </h2>
          <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-full">ÚLTIMAS 50 LEITURAS</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipamento</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Horário</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Corrente</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Temp.</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Pressão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {leituras.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Clock className="w-8 h-8 text-slate-200" />
                      <p className="text-sm font-medium text-slate-400">Aguardando primeiras leituras...</p>
                    </div>
                  </td>
                </tr>
              ) : (
                leituras.slice(0, 50).map((l, i) => (
                  <tr 
                    key={i} 
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    onClick={() => {
                      const config = equipmentStats[l.equipamento]?.config;
                      if (config) {
                        setSelectedEquip(config);
                        setView('equipment-detail');
                      }
                    }}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-700">{equipmentStats[l.equipamento]?.config?.localizacao || l.equipamento}</span>
                        <span className="text-[10px] font-mono text-slate-300">{l.equipamento}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-500">
                      {formatTimestamp(l.timestamp)}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-right text-emerald-600">
                      {l.corrente != null ? `${l.corrente.toFixed(2)}A` : '--'}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-right text-orange-500">
                      {l.temperatura != null ? `${l.temperatura.toFixed(1)}°C` : '--'}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-right text-blue-600">
                      {l.pressao != null ? `${l.pressao.toFixed(2)}kgf` : '--'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    );
  };

  const renderEquipment = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Cadastro de Equipamentos</h2>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-emerald-500 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo Equipamento
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-bold">{editingId ? 'Editar Ativo' : 'Cadastrar Novo Ativo'}</h3>
              <button onClick={() => { 
                setIsModalOpen(false); 
                setEditingId(null); 
                setNewEquip({
                  nome: '',
                  tipo: 'bomba_recalque',
                  condominio: '',
                  localizacao: '',
                  fabricante: '',
                  modelo: '',
                  corrente_nominal: 0,
                  pressao_nominal: 0,
                  temperatura_maxima: 0
                });
              }} className="text-slate-400 hover:text-slate-600">
                <AlertCircle className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={handleSaveEquipment} className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID da Placa (CT-XXXX)</label>
                <input required value={newEquip.nome} onChange={e => setNewEquip({...newEquip, nome: e.target.value})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium" placeholder="Ex: CT-0001" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de Equipamento</label>
                <select value={newEquip.tipo} onChange={e => setNewEquip({...newEquip, tipo: e.target.value as any})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium">
                  <option value="bomba_recalque">Bomba de Recalque</option>
                  <option value="bomba_piscina">Bomba de Piscina</option>
                  <option value="exaustor">Exaustor</option>
                  <option value="pressao">Sensor de Pressão</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Condomínio</label>
                <input required value={newEquip.condominio} onChange={e => setNewEquip({...newEquip, condominio: e.target.value})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium" placeholder="Ex: Bonavita" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Localização/Nome</label>
                <input required value={newEquip.localizacao} onChange={e => setNewEquip({...newEquip, localizacao: e.target.value})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium" placeholder="Ex: Bomba 01 Subsolo" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fabricante</label>
                <input value={newEquip.fabricante} onChange={e => setNewEquip({...newEquip, fabricante: e.target.value})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium" placeholder="Ex: Schneider" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Corrente Nominal (A)</label>
                <input type="number" step="0.1" value={newEquip.corrente_nominal} onChange={e => setNewEquip({...newEquip, corrente_nominal: parseFloat(e.target.value)})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Temperatura Máxima (°C)</label>
                <input type="number" step="0.1" value={newEquip.temperatura_maxima} onChange={e => setNewEquip({...newEquip, temperatura_maxima: parseFloat(e.target.value)})} className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium" placeholder="Ex: 60" />
              </div>
              <div className="md:col-span-2 flex gap-4 mt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-50 transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-600 transition-colors">Salvar Equipamento</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {equipments.map(e => (
          <div key={e.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row justify-between gap-6">
            <div className="flex gap-4">
              <div className="bg-slate-50 p-4 rounded-2xl h-fit">
                {e.tipo.includes('bomba') ? <Droplets className="text-slate-400" /> : <Wind className="text-slate-400" />}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">{e.localizacao}</h3>
                <p className="text-sm text-slate-500 font-medium">{e.condominio} • {e.fabricante} {e.modelo}</p>
                <div className="mt-4 flex gap-6">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Corrente Nominal</p>
                    <p className="text-sm font-bold">{e.corrente_nominal} A</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Temp. Máxima</p>
                    <p className="text-sm font-bold">{e.temperatura_maxima} °C</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pressão Nominal</p>
                    <p className="text-sm font-bold">{e.pressao_nominal} kgf</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID Placa</p>
                    <p className="text-sm font-mono text-emerald-600">{e.nome}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleEditEquipment(e)}
                className="p-2 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors"
                title="Editar"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button 
                onClick={() => handleDeleteEquipment(e.id)}
                className="p-2 hover:bg-rose-50 rounded-lg text-rose-600 transition-colors"
                title="Excluir"
              >
                <AlertCircle className="w-5 h-5" />
              </button>
              <ChevronRight className="text-slate-300" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderEquipmentDetail = () => {
    if (!selectedEquip) return null;
    
    const equipLeituras = leituras
      .filter(l => l.equipamento === selectedEquip.nome || l.placa_id === selectedEquip.nome || l.equipamento === selectedEquip.id)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    const lastReading = equipmentStats[selectedEquip.nome]?.last;
    const isOnline = lastReading ? (Math.floor(Date.now() / 1000) - lastReading.timestamp < 300) : false;
    const isOn = lastReading?.corrente ? lastReading.corrente > 0.5 : false;

    const detailChartData = equipLeituras.map(l => {
      const rawTime = l.timestamp;
      const time = rawTime > 1000000000000 ? Math.floor(rawTime / 1000) : rawTime;
      
      const parseVal = (v: any) => {
        if (v == null) return null;
        const n = Number(String(v).replace(',', '.'));
        return isNaN(n) ? null : n;
      };

      let displayTime = format(new Date(time * 1000), 'HH:mm');
      if (timeRange !== 'day') {
        displayTime = format(new Date(time * 1000), 'dd/MM HH:mm');
      }

      return {
        timestamp: time,
        displayTime,
        corrente: parseVal(l.corrente),
        temperatura: parseVal(l.temperatura),
        pressao: parseVal(l.pressao)
      };
    });

    return (
      <div className="space-y-8 pb-20 lg:pb-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setView('dashboard')}
            className="p-2 hover:bg-white rounded-xl transition-colors text-slate-400"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-800">{selectedEquip.localizacao}</h1>
            <p className="text-sm text-slate-500 font-medium">{selectedEquip.condominio} • {selectedEquip.nome}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </div>
            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isOn ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
              {isOn ? 'Em Operação' : 'Desligado'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Corrente Atual</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter">{lastReading?.corrente?.toFixed(2) || '0.00'}A</span>
              <span className="text-xs text-slate-400 font-mono">/ {selectedEquip.corrente_nominal}A nom.</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Temperatura</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter">{lastReading?.temperatura?.toFixed(1) || '0.0'}°C</span>
              <span className="text-xs text-slate-400 font-mono">/ {selectedEquip.temperatura_maxima}°C máx.</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Pressão</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tighter">{lastReading?.pressao?.toFixed(2) || '0.00'}kgf</span>
              <span className="text-xs text-slate-400 font-mono">/ {selectedEquip.pressao_nominal}kgf nom.</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Gráficos de Desempenho</h3>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                {(['day', 'week', 'month'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                      timeRange === range 
                        ? 'bg-white text-emerald-600 shadow-sm' 
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {range === 'day' ? '24h' : range === 'week' ? '7 Dias' : '30 Dias'}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={detailChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="displayTime" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  <Area type="monotone" dataKey="corrente" name="Corrente (A)" stroke="#10b981" fill="#10b98122" strokeWidth={3} connectNulls />
                  <Area type="monotone" dataKey="temperatura" name="Temperatura (°C)" stroke="#f59e0b" fill="#f59e0b22" strokeWidth={3} connectNulls />
                  {selectedEquip.tipo === 'pressao' && (
                    <Area type="monotone" dataKey="pressao" name="Pressão (kgf)" stroke="#3b82f6" fill="#3b82f622" strokeWidth={3} connectNulls />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Linha do Tempo de Leituras</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Horário</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Corrente</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Temp.</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Pressão</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {equipLeituras.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Clock className="w-8 h-8 text-slate-200" />
                          <p className="text-sm font-medium text-slate-400">Nenhum dado histórico encontrado para este ativo.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    equipLeituras.slice().reverse().map((l, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-xs font-medium text-slate-500">
                          {formatTimestamp(l.timestamp)}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-right text-emerald-600">
                          {l.corrente != null ? `${l.corrente.toFixed(2)}A` : '--'}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-right text-orange-500">
                          {l.temperatura != null ? `${l.temperatura.toFixed(1)}°C` : '--'}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-right text-blue-600">
                          {l.pressao != null ? `${l.pressao.toFixed(2)}kgf` : '--'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${l.corrente && l.corrente > 0.5 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {l.corrente && l.corrente > 0.5 ? 'LIGADO' : 'DESLIGADO'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const generateReport = async () => {
    setIsGenerating(true);
    try {
      const startTimestamp = Math.floor(new Date(reportRange.start).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(reportRange.end + 'T23:59:59').getTime() / 1000);

      const { data, error } = await supabase
        .from('leituras')
        .select('*')
        .gte('timestamp', startTimestamp)
        .lte('timestamp', endTimestamp)
        .order('timestamp', { ascending: false });

      if (error) throw error;
      setReportData(data || []);
    } catch (err) {
      console.error('Erro ao gerar relatório:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const exportPDF = () => {
    if (reportData.length === 0) return;

    const doc = new jsPDF();
    const tableData = reportData.map(l => {
      const config = equipmentStats[l.equipamento || l.placa_id]?.config;
      return [
        formatTimestamp(l.timestamp, 'dd/MM/yyyy HH:mm'),
        config?.localizacao || l.equipamento || l.placa_id,
        l.corrente != null ? `${l.corrente.toFixed(2)}A` : '-',
        l.temperatura != null ? `${l.temperatura.toFixed(1)}°C` : '-',
        l.pressao != null ? `${l.pressao.toFixed(2)}kgf` : '-'
      ];
    });

    doc.setFontSize(18);
    doc.text('Relatório de Monitoramento - Smart Predial', 14, 22);
    doc.setFontSize(11);
    doc.text(`Período: ${format(new Date(reportRange.start), 'dd/MM/yyyy')} a ${format(new Date(reportRange.end), 'dd/MM/yyyy')}`, 14, 30);

    autoTable(doc, {
      head: [['Data/Hora', 'Equipamento', 'Corrente', 'Temperatura', 'Pressão']],
      body: tableData,
      startY: 40,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8 }
    });

    doc.save(`relatorio_smart_predial_${reportRange.start}_${reportRange.end}.pdf`);
  };

  const renderReports = () => (
    <div className="space-y-8">
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-wrap gap-6 items-end">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data Inicial</label>
          <input 
            type="date" 
            value={reportRange.start}
            onChange={(e) => setReportRange(prev => ({ ...prev, start: e.target.value }))}
            className="block w-full bg-slate-50 border-none rounded-xl text-sm font-medium p-3"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data Final</label>
          <input 
            type="date" 
            value={reportRange.end}
            onChange={(e) => setReportRange(prev => ({ ...prev, end: e.target.value }))}
            className="block w-full bg-slate-50 border-none rounded-xl text-sm font-medium p-3"
          />
        </div>
        <button 
          onClick={generateReport}
          disabled={isGenerating}
          className="bg-[#1A1A1A] text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-black transition-colors disabled:opacity-50"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />} 
          {isGenerating ? 'Gerando...' : 'Gerar Relatório'}
        </button>
        <button 
          onClick={exportPDF}
          disabled={reportData.length === 0}
          className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-600 transition-colors ml-auto disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> Exportar PDF
        </button>
      </div>

      {reportData.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50">
            <h3 className="font-bold text-slate-800">Dados do Relatório ({reportData.length} registros)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Data/Hora</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipamento</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Corrente</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Temperatura</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Pressão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {reportData.slice(0, 100).map((l, i) => {
                  const config = equipmentStats[l.equipamento || l.placa_id]?.config;
                  return (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-medium text-slate-500">
                        {formatTimestamp(l.timestamp)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-700">{config?.localizacao || l.equipamento || l.placa_id}</span>
                          <span className="text-[10px] font-mono text-slate-300">{l.equipamento || l.placa_id}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-right text-emerald-600">
                        {l.corrente != null ? `${l.corrente.toFixed(1)}A` : '-'}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-right text-slate-600">
                        {l.temperatura != null ? `${l.temperatura.toFixed(1)}°C` : '-'}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-right text-slate-600">
                        {l.pressao != null ? `${l.pressao.toFixed(2)}kgf` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {reportData.length > 100 && (
              <div className="p-4 text-center bg-slate-50">
                <p className="text-xs text-slate-400 font-medium italic">Exibindo os primeiros 100 registros. Exporte o PDF para ver o relatório completo.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm lg:col-span-2">
          <h3 className="font-bold text-slate-800 mb-6">Uptime por Equipamento (%)</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={equipments.map(e => ({ name: e.localizacao, uptime: 98.5 + Math.random() * 1.5 }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={10} domain={[90, 100]} />
                <Tooltip />
                <Bar dataKey="uptime" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-6">Alertas de Diagnóstico</h3>
          <div className="space-y-4">
            {[
              { equip: 'Bomba Recalque 01', msg: 'Corrente 15% acima da nominal', type: 'warning' },
              { equip: 'Exaustor Bloco A', msg: 'Temperatura elevada detectada', type: 'danger' },
              { equip: 'Pressão Geral', msg: 'Oscilação fora do padrão', type: 'info' }
            ].map((alert, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-2xl bg-slate-50">
                <div className={`p-2 rounded-lg h-fit ${alert.type === 'danger' ? 'bg-rose-100 text-rose-600' : alert.type === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800">{alert.equip}</p>
                  <p className="text-[10px] text-slate-500 font-medium">{alert.msg}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen hidden lg:flex">
        <div className="p-6 flex items-center gap-3 border-b border-slate-50">
          <div className="bg-emerald-500 p-2 rounded-lg">
            <Activity className="text-white w-5 h-5" />
          </div>
          <h1 className="font-black tracking-tighter text-lg">SMART PREDIAL</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setView('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${view === 'dashboard' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            <LayoutDashboard className="w-5 h-5" /> Monitoramento
          </button>
          <button 
            onClick={() => setView('equipment')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${view === 'equipment' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            <Settings className="w-5 h-5" /> Equipamentos
          </button>
          <button 
            onClick={() => setView('reports')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${view === 'reports' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            <FileText className="w-5 h-5" /> Relatórios
          </button>
        </nav>

        <div className="p-6 border-t border-slate-50">
          <div className="bg-slate-50 p-4 rounded-2xl">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Sistema Online</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-slate-700">Servidor Ativo</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-around items-center z-50">
        <button 
          onClick={() => setView('dashboard')}
          className={`flex flex-col items-center gap-1 ${view === 'dashboard' ? 'text-emerald-600' : 'text-slate-400'}`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase">Dash</span>
        </button>
        <button 
          onClick={() => setView('equipment')}
          className={`flex flex-col items-center gap-1 ${view === 'equipment' ? 'text-emerald-600' : 'text-slate-400'}`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase">Ativos</span>
        </button>
        <button 
          onClick={() => setView('reports')}
          className={`flex flex-col items-center gap-1 ${view === 'reports' ? 'text-emerald-600' : 'text-slate-400'}`}
        >
          <FileText className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase">Relat.</span>
        </button>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">
            {view === 'dashboard' ? 'Monitoramento em Tempo Real' : 
             view === 'equipment' ? 'Gestão de Ativos' : 'Análise de Gestão'}
          </h2>
          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Sincronizado</p>
              <p className="text-xs font-mono font-bold">{format(lastUpdate, 'HH:mm:ss')}</p>
            </div>
            <button 
              onClick={() => { setLoading(true); fetchData(); }}
              className="p-2.5 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        <main className="p-8 max-w-7xl mx-auto w-full">
          {view === 'dashboard' && renderDashboard()}
          {view === 'equipment' && renderEquipment()}
          {view === 'reports' && renderReports()}
          {view === 'equipment-detail' && renderEquipmentDetail()}
        </main>
      </div>
    </div>
  );
}
