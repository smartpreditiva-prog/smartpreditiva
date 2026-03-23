import React, { useState } from 'react';
import { 
  Wifi, 
  Save, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Info,
  Globe,
  Cpu,
  ShieldCheck,
  Building2,
  Settings2,
  KeyRound,
  ArrowLeft,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfigData {
  placa_id: string;
  tipo_placa: string;
  condominio: string;
  equipamento: string;
  ssid: string;
  password: string;
  ip?: string;
}

interface ESP32ConfigProps {
  onBack?: () => void;
}

export default function ESP32Config({ onBack }: ESP32ConfigProps) {
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState<ConfigData>({
    placa_id: '',
    tipo_placa: '',
    condominio: '',
    equipamento: '',
    ssid: '',
    password: ''
  });

  const validateIp = (ipStr: string) => {
    const regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return regex.test(ipStr);
  };

  const handleRead = async () => {
    if (!ip) {
      setStatus('error');
      setMessage('Por favor, insira o endereço IP da placa.');
      return;
    }

    setLoading(true);
    setStatus('idle');
    try {
      const response = await fetch(`http://${ip}/config`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) throw new Error('Falha ao ler configuração. Verifique o IP e a rede.');

      const data = await response.json();
      setConfig(data);
      setStatus('success');
      setMessage('Configuração lida com sucesso!');
    } catch (error: any) {
      console.error(error);
      setStatus('error');
      setMessage(error.message || 'Erro ao conectar com a placa.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!ip) {
      setStatus('error');
      setMessage('Por favor, insira o endereço IP da placa.');
      return;
    }

    if (!config.placa_id || !config.condominio || !config.equipamento) {
      setStatus('error');
      setMessage('Os campos ID da Placa, Condomínio e Equipamento são obrigatórios.');
      return;
    }

    setLoading(true);
    setStatus('idle');
    try {
      const response = await fetch(`http://${ip}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) throw new Error('Falha ao salvar configuração.');

      setStatus('success');
      setMessage('Configuração salva com sucesso! A placa pode reiniciar.');
    } catch (error: any) {
      console.error(error);
      setStatus('error');
      setMessage(error.message || 'Erro ao salvar dados na placa.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center gap-4">
          {onBack && (
            <button 
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
          )}
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Cpu className="text-emerald-500 w-6 h-6" /> Configuração ESP32
          </h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 mt-6 space-y-6">
        {/* Connection Status Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Status da Conexão</h2>
            <div className={`w-2 h-2 rounded-full ${ip ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          </div>
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${ip ? 'bg-emerald-50' : 'bg-slate-50'}`}>
              <Wifi className={`w-6 h-6 ${ip ? 'text-emerald-600' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">
                {ip ? `Conectando ao IP: ${ip}` : 'Aguardando IP'}
              </p>
              <p className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">
                Rede Local (Wi-Fi)
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-700 leading-relaxed">
              Certifique-se de que seu celular e a placa ESP32 estejam conectados na <strong>mesma rede Wi-Fi</strong>.
            </p>
          </div>
          <div className="mt-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <p className="text-[9px] text-blue-700 leading-relaxed italic">
              Nota: A placa ESP32 deve permitir requisições CORS (*). Se o app estiver em HTTPS, use um navegador que permita conteúdo misto para IPs locais.
            </p>
          </div>
        </div>

        {/* IP Input Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Endereço IP da Placa</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
            <input 
              type="text" 
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="Ex: 192.168.1.50"
              className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>
          <div className="flex gap-3 mt-4">
            <button 
              onClick={handleRead}
              disabled={loading}
              className="flex-1 bg-emerald-500 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20"
            >
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
              Ler Configuração
            </button>
            <button 
              onClick={() => {
                setIp('');
                setConfig({
                  placa_id: '',
                  tipo_placa: '',
                  condominio: '',
                  equipamento: '',
                  ssid: '',
                  password: ''
                });
                setStatus('idle');
              }}
              className="px-4 bg-slate-100 text-slate-400 rounded-2xl hover:bg-slate-200 transition-colors"
              title="Limpar campos"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Configuration Form */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-6">
          <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Parâmetros da Placa</h2>
          
          <div className="space-y-4">
            {/* Placa ID */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> ID da Placa
              </label>
              <input 
                type="text" 
                value={config.placa_id}
                onChange={(e) => setConfig({...config, placa_id: e.target.value})}
                className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium"
                placeholder="Ex: CT-0001"
              />
            </div>

            {/* Tipo Placa */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                <Settings2 className="w-3 h-3" /> Tipo de Placa
              </label>
              <input 
                type="text" 
                value={config.tipo_placa}
                onChange={(e) => setConfig({...config, tipo_placa: e.target.value})}
                className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium"
                placeholder="Ex: corrente_temperatura"
              />
            </div>

            {/* Condominio */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                <Building2 className="w-3 h-3" /> Condomínio
              </label>
              <input 
                type="text" 
                value={config.condominio}
                onChange={(e) => setConfig({...config, condominio: e.target.value})}
                className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium"
                placeholder="Ex: Bonavita"
              />
            </div>

            {/* Equipamento */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                <Cpu className="w-3 h-3" /> Equipamento
              </label>
              <input 
                type="text" 
                value={config.equipamento}
                onChange={(e) => setConfig({...config, equipamento: e.target.value})}
                className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium"
                placeholder="Ex: bomba_recalque_1"
              />
            </div>

            <div className="pt-4 border-t border-slate-50">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Credenciais Wi-Fi</h3>
              
              <div className="space-y-4">
                {/* SSID */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                    <Wifi className="w-3 h-3" /> SSID (Nome da Rede)
                  </label>
                  <input 
                    type="text" 
                    value={config.ssid}
                    onChange={(e) => setConfig({...config, ssid: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium"
                  />
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                    <KeyRound className="w-3 h-3" /> Senha Wi-Fi
                  </label>
                  <input 
                    type="password" 
                    value={config.password}
                    onChange={(e) => setConfig({...config, password: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-xl p-3 text-sm font-medium"
                  />
                </div>
              </div>
            </div>
          </div>

          <button 
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-slate-800 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-900 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Salvar Configuração
          </button>
        </div>
      </main>

      {/* Status Toasts */}
      <AnimatePresence>
        {status !== 'idle' && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-4 right-4 z-50"
          >
            <div className={`p-4 rounded-2xl shadow-xl flex items-center gap-3 border ${
              status === 'success' ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-rose-500 border-rose-400 text-white'
            }`}>
              {status === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
              <p className="text-sm font-bold">{message}</p>
              <button 
                onClick={() => setStatus('idle')}
                className="ml-auto p-1 hover:bg-white/20 rounded-lg"
              >
                <RefreshCw className="w-4 h-4 rotate-45" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
