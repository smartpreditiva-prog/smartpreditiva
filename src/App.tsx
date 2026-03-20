/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { Leitura, EquipmentStatus } from './types';
import { 
  Activity, 
  Thermometer, 
  Gauge, 
  Droplets, 
  Wind, 
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function App() {
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      const { data, error } = await supabase
        .from('leituras')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) throw error;
      if (data) {
        setLeituras(data);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    
    // Real-time subscription
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leituras' },
        (payload) => {
          setLeituras((prev) => [payload.new as Leitura, ...prev].slice(0, 100));
          setLastUpdate(new Date());
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const equipmentStats = useMemo(() => {
    const stats: Record<string, Leitura> = {};
    leituras.forEach((l) => {
      if (!stats[l.equipamento] || l.timestamp > stats[l.equipamento].timestamp) {
        stats[l.equipamento] = l;
      }
    });
    return stats;
  }, [leituras]);

  const getStatusColor = (reading?: Leitura) => {
    if (!reading) return 'text-slate-400';
    const now = Math.floor(Date.now() / 1000);
    const isOnline = now - reading.timestamp < 300; // 5 minutes
    return isOnline ? 'text-emerald-500' : 'text-rose-500';
  };

  const isDeviceOn = (reading?: Leitura) => {
    if (!reading || reading.corrente === undefined) return false;
    return reading.corrente > 0.5; // Threshold for "On"
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 p-2 rounded-lg">
            <Activity className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Smart Condomínio</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Monitoramento de Ativos</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Última Atualização</p>
            <p className="text-sm font-mono">{format(lastUpdate, 'HH:mm:ss')}</p>
          </div>
          <button 
            onClick={() => { setLoading(true); fetchData(); }}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-8">
        {/* Status Overview */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(equipmentStats).map(([name, reading]: [string, Leitura]) => (
            <div key={name} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl ${isDeviceOn(reading) ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                  {name.includes('bomba') ? <Droplets className={isDeviceOn(reading) ? 'text-emerald-600' : 'text-slate-400'} /> : 
                   name.includes('exaustor') ? <Wind className={isDeviceOn(reading) ? 'text-emerald-600' : 'text-slate-400'} /> :
                   <Gauge className={isDeviceOn(reading) ? 'text-emerald-600' : 'text-slate-400'} />}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full animate-pulse ${getStatusColor(reading).replace('text', 'bg')}`} />
                  <span className={`text-[10px] font-bold uppercase tracking-tighter ${getStatusColor(reading)}`}>
                    {Math.floor(Date.now() / 1000) - reading.timestamp < 300 ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
              
              <h3 className="text-sm font-bold text-slate-800 capitalize mb-1">
                {name.replace(/_/g, ' ')}
              </h3>
              
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tighter">
                  {reading.corrente !== undefined ? `${reading.corrente.toFixed(1)}A` : 
                   reading.pressao !== undefined ? `${reading.pressao.toFixed(2)}kgf` : '--'}
                </span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isDeviceOn(reading) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {isDeviceOn(reading) ? 'EM OPERAÇÃO' : 'DESLIGADO'}
                </span>
              </div>

              {reading.temperatura !== undefined && (
                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center gap-2 text-slate-500">
                  <Thermometer className="w-4 h-4" />
                  <span className="text-xs font-medium">{reading.temperatura.toFixed(1)}°C</span>
                </div>
              )}
            </div>
          ))}
        </section>

        {/* Charts Section */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Corrente Chart */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Activity className="text-emerald-500 w-5 h-5" />
                Consumo Elétrico (A)
              </h2>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[...leituras].reverse().filter(l => l.corrente !== undefined)}>
                  <defs>
                    <linearGradient id="colorCorrente" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(unix) => format(new Date(unix * 1000), 'HH:mm')}
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    labelFormatter={(unix) => format(new Date(Number(unix) * 1000), 'HH:mm:ss')}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="corrente" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorCorrente)" 
                    name="Corrente (A)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Pressão Chart */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Gauge className="text-blue-500 w-5 h-5" />
                Pressão da Rede (kgf/cm²)
              </h2>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[...leituras].reverse().filter(l => l.pressao !== undefined)}>
                  <defs>
                    <linearGradient id="colorPressao" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(unix) => format(new Date(unix * 1000), 'HH:mm')}
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    labelFormatter={(unix) => format(new Date(Number(unix) * 1000), 'HH:mm:ss')}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="pressao" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorPressao)" 
                    name="Pressão (kgf)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Recent Logs */}
        <section className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-50 flex justify-between items-center">
            <h2 className="font-bold text-slate-800">Registros Recentes</h2>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Últimas 100 leituras</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Horário</th>
                  <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Equipamento</th>
                  <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Corrente</th>
                  <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Temp</th>
                  <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Pressão</th>
                  <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {leituras.map((l, i) => (
                  <tr key={l.id || i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono text-slate-600">
                      {format(new Date(l.timestamp * 1000), 'dd/MM HH:mm:ss')}
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-800 capitalize">
                      {l.equipamento.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-600">
                      {l.corrente !== undefined ? `${l.corrente.toFixed(2)} A` : '-'}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-600">
                      {l.temperatura !== undefined ? `${l.temperatura.toFixed(1)} °C` : '-'}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-600">
                      {l.pressao !== undefined ? `${l.pressao.toFixed(3)} kgf` : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDeviceOn(l) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {isDeviceOn(l) ? 'ON' : 'OFF'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="p-8 text-center text-slate-400 text-xs font-medium border-t border-slate-100 mt-12">
        <p>© 2026 Smart Predial - Sistema de Monitoramento Industrial</p>
      </footer>
    </div>
  );
}
