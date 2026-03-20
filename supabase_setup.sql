-- Tabela de Equipamentos
CREATE TABLE IF NOT EXISTS equipamentos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE, -- ID da Placa (ex: CT-0001)
    tipo TEXT NOT NULL, -- bomba_recalque, bomba_piscina, exaustor, pressao
    condominio TEXT NOT NULL,
    localizacao TEXT NOT NULL,
    fabricante TEXT,
    modelo TEXT,
    corrente_nominal FLOAT, -- Valor de fábrica para comparação
    pressao_nominal FLOAT, -- Valor de fábrica para comparação
    data_instalacao DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de Leituras (já criada anteriormente, mas garantindo consistência)
CREATE TABLE IF NOT EXISTS leituras (
    id BIGSERIAL PRIMARY KEY,
    equipamento TEXT NOT NULL REFERENCES equipamentos(nome),
    corrente FLOAT,
    temperatura FLOAT,
    pressao FLOAT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE equipamentos;
ALTER PUBLICATION supabase_realtime ADD TABLE leituras;

-- Políticas de Segurança (RLS)
ALTER TABLE equipamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE leituras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura pública de equipamentos" ON equipamentos FOR SELECT USING (true);
CREATE POLICY "Permitir inserção pública de equipamentos" ON equipamentos FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir atualização pública de equipamentos" ON equipamentos FOR UPDATE USING (true);

CREATE POLICY "Permitir leitura pública de leituras" ON leituras FOR SELECT USING (true);
CREATE POLICY "Permitir inserção pública de leituras" ON leituras FOR INSERT WITH CHECK (true);
