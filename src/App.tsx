/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { Leitura, Equipment } from './types';
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
  ArrowLeft
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
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
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

  const [selectedEquipments, setSelectedEquipments] = useState<string[]>([]);

  const fetchData = async () => {
    try {
      const [leiturasRes, equipRes] = await Promise.all([
        supabase.from('leituras').select('*').order('timestamp', { ascending: false }).limit(200),
        supabase.from('equipamentos').select('*')
      ]);

      if (leiturasRes.data) setLeituras(leiturasRes.data);
      if (equipRes.data) {
        setEquipments(equipRes.data);
        // Initialize selection if empty
        if (selectedEquipments.length === 0 && equipRes.data.length > 0) {
          setSelectedEquipments(equipRes.data.map(e => e.nome));
        }
      }
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
    } finally {
      setLoading(false);
    }
  };

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
  }, []);

  const equipmentStats = useMemo(() => {
    const stats: Record<string, { last?: Leitura, config?: Equipment }> = {};
    
    // Initialize with registered equipments
    equipments.forEach(e => {
      stats[e.nome] = { config: e };
    });

    // Add last readings
    leituras.forEach((l) => {
      if (!stats[l.equipamento]) stats[l.equipamento] = {};
      if (!stats[l.equipamento].last || l.timestamp > (stats[l.equipamento].last?.timestamp || 0)) {
        stats[l.equipamento].last = l;
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

  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const handleAddEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.from('equipamentos').insert([newEquip]);
      if (error) throw error;
      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Erro ao adicionar equipamento:', err);
      alert('Erro ao salvar equipamento. Verifique se o ID da Placa já existe.');
    }
  };

  const chartData = useMemo(() => {
    const dataMap: Record<number, any> = {};
    
    // Sort readings by timestamp
    const sortedLeituras = [...leituras].sort((a, b) => a.timestamp - b.timestamp);
    
    sortedLeituras.forEach(l => {
      const time = l.timestamp;
      if (!dataMap[time]) {
        dataMap[time] = { 
          timestamp: time,
          displayTime: format(new Date(time * 1000), 'HH:mm')
        };
      }
      // Use equipment name/location as the key for the value
      const equipName = equipmentStats[l.equipamento]?.config?.localizacao || l.equipamento;
      if (l.corrente !== undefined) dataMap[time][`corrente_${equipName}`] = l.corrente;
      if (l.pressao !== undefined) dataMap[time][`pressao_${equipName}`] = l.pressao;
    });

    return Object.values(dataMap);
  }, [leituras, equipmentStats]);

  const equipmentColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const renderDashboard = () => (
    <div className="space-y-8 pb-20 lg:pb-0">
      {/* Header with Quick Action */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-800">Visão Geral</h1>
          <p className="text-sm text-slate-500 font-medium">Status atual de todos os ativos monitorados</p>
        </div>
        <button 
          onClick={() => setView('equipment')}
          className="bg-emerald-500 text-white px-5 py-2.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
        >
          <Plus className="w-4 h-4" /> Gerenciar Equipamentos
        </button>
      </div>

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
        {filteredStats.map(([name, data]: [string, any]) => {
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
        })}
      </section>

      {/* Charts Section */}
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Activity className="text-emerald-500 w-5 h-5" /> Monitoramento de Ativos
            </h2>
            <div className="flex flex-wrap gap-2">
              {equipments.map((e, idx) => (
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Corrente (A)</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="displayTime" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                    {equipments.filter(e => selectedEquipments.includes(e.nome)).map((e, idx) => (
                      <Area 
                        key={e.id} 
                        type="monotone" 
                        dataKey={`corrente_${e.localizacao || e.nome}`} 
                        name={e.localizacao || e.nome}
                        stroke={equipmentColors[idx % equipmentColors.length]} 
                        fill={`${equipmentColors[idx % equipmentColors.length]}22`} 
                        strokeWidth={2} 
                        connectNulls
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Pressão (kgf/cm²)</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="displayTime" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                    {equipments.filter(e => e.tipo === 'pressao' && selectedEquipments.includes(e.nome)).map((e, idx) => (
                      <Area 
                        key={e.id} 
                        type="monotone" 
                        dataKey={`pressao_${e.localizacao || e.nome}`} 
                        name={e.localizacao || e.nome}
                        stroke={equipmentColors[(idx + 2) % equipmentColors.length]} 
                        fill={`${equipmentColors[(idx + 2) % equipmentColors.length]}22`} 
                        strokeWidth={2} 
                        connectNulls
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
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
              {leituras.slice(0, 50).map((l, i) => (
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
                    {format(new Date(l.timestamp * 1000), 'dd/MM HH:mm:ss')}
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
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

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
              <h3 className="text-lg font-bold">Cadastrar Novo Ativo</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <AlertCircle className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={handleAddEquipment} className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
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
              <button className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 transition-colors">
                <Settings className="w-5 h-5" />
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
      .filter(l => l.equipamento === selectedEquip.nome)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    const lastReading = equipmentStats[selectedEquip.nome]?.last;
    const isOnline = lastReading ? (Math.floor(Date.now() / 1000) - lastReading.timestamp < 300) : false;
    const isOn = lastReading?.corrente ? lastReading.corrente > 0.5 : false;

    const detailChartData = equipLeituras.map(l => ({
      timestamp: l.timestamp,
      displayTime: format(new Date(l.timestamp * 1000), 'HH:mm'),
      corrente: l.corrente,
      temperatura: l.temperatura,
      pressao: l.pressao
    }));

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
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-6">Gráficos de Desempenho</h3>
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
                  {equipLeituras.slice().reverse().map((l, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-medium text-slate-500">
                        {format(new Date(l.timestamp * 1000), 'dd/MM HH:mm:ss')}
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
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
        <button className="bg-[#1A1A1A] text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-black transition-colors">
          <Calendar className="w-4 h-4" /> Gerar Relatório
        </button>
        <button className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-600 transition-colors ml-auto">
          <Download className="w-4 h-4" /> Exportar PDF
        </button>
      </div>

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
            <LayoutDashboard className="w-5 h-5" /> Dashboard
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
