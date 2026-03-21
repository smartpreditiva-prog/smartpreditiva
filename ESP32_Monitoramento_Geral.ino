/*
  ESP32 SCRIPT UNIFICADO PARA MONITORAMENTO PREDIAL
  Integração com Supabase e suporte Offline (LittleFS)
  Monitora: Corrente (A), Temperatura (°C) e Pressão (kgf/cm²)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// --- CONFIGURAÇÕES DO HARDWARE ---
const int pinCorrente = 35;    // GPIO35 (SCT-013 ou similar)
const int pinTemperatura = 18; // GPIO18 (DS18B20)
const int pinPressao = 36;     // GPIO36 (Sensor de Pressão 0-5V)

// Configuração do Sensor de Temperatura DS18B20
OneWire oneWire(pinTemperatura);
DallasTemperature sensors(&oneWire);

// --- CONFIGURAÇÕES DE IDENTIFICAÇÃO (Mude para cada equipamento) ---
String PLACA_ID = "ESP32-001";
String TIPO_PLACA = "bomba_recalque"; // ex: bomba_recalque, exaustor, pressao
String CONDOMINIO = "Bonavita";
String EQUIPAMENTO = "bomba_recalque_1"; // Deve bater com o nome no banco de dados

// --- CONFIGURAÇÕES DE REDE ---
const char* ssid = "SUA_REDE_WIFI";
const char* password = "SUA_SENHA_WIFI";

// --- CONFIGURAÇÕES SUPABASE ---
const char* supabaseUrl = "https://veacmwwveluurkuxfyeq.supabase.co/rest/v1/leituras";
const char* supabaseKey = "sb_publishable_4JxXVxtid5vcXC7zafOhrA_oqtAuycJ";

// --- CONFIGURAÇÕES DE TEMPO ---
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = -10800; // GMT-3 (Brasília)
const int daylightOffset_sec = 0;

// --- CONFIGURAÇÕES DE FILA OFFLINE ---
const char* ARQUIVO_FILA = "/fila_leituras.txt";
unsigned long ultimoTempoLeitura = 0;
unsigned long ultimoTempoFila = 0;
unsigned long ultimoTempoTentativaConexao = 0;
int tentativasConexao = 0;
const unsigned long intervaloLeitura = 30000; // 30 segundos
const unsigned long intervaloFila = 60000;    // 1 minuto
const unsigned long intervaloReconexaoFalha = 600000; // 10 minutos (600.000 ms)

// --- FUNÇÕES DE TEMPO ---
void sincronizarHorario() {
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  struct tm timeinfo;
  int tentativas = 0;
  Serial.print("Sincronizando horário...");
  while (!getLocalTime(&timeinfo) && tentativas < 10) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }
  Serial.println(" OK!");
}

long obterTimestamp() {
  time_t agora;
  time(&agora);
  return (long)agora;
}

// --- FUNÇÕES DE REDE ---
bool conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    tentativasConexao = 0;
    return true;
  }

  // Se já falhou 5 vezes, verifica se já passou 10 minutos
  if (tentativasConexao >= 5) {
    if (millis() - ultimoTempoTentativaConexao < intervaloReconexaoFalha) {
      static unsigned long ultimaMensagemEspera = 0;
      if (millis() - ultimaMensagemEspera > 60000) { // Log a cada minuto
        Serial.println("WiFi Offline: Aguardando intervalo de 10 min para nova tentativa...");
        ultimaMensagemEspera = millis();
      }
      return false;
    } else {
      tentativasConexao = 0; // Reset para tentar novamente após os 10 min
    }
  }
  
  Serial.printf("Tentativa de conexão WiFi %d/5...\n", tentativasConexao + 1);
  WiFi.begin(ssid, password);
  
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 10000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" Conectado!");
    tentativasConexao = 0;
    sincronizarHorario();
    return true;
  } else {
    tentativasConexao++;
    Serial.println(" Falha na conexão.");
    
    if (tentativasConexao >= 5) {
      ultimoTempoTentativaConexao = millis();
      Serial.println("Limite de tentativas atingido. Entrando em modo de espera (10 min).");
    }
    return false;
  }
}

bool enviarParaSupabase(String json) {
  if (WiFi.status() != WL_CONNECTED) return false;
  
  HTTPClient http;
  http.begin(supabaseUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", supabaseKey);
  http.addHeader("Authorization", String("Bearer ") + supabaseKey);
  
  int httpResponseCode = http.POST(json);
  http.end();
  
  if (httpResponseCode == 200 || httpResponseCode == 201) {
    Serial.println("Dados enviados com sucesso!");
    return true;
  } else {
    Serial.print("Erro no envio: ");
    Serial.println(httpResponseCode);
    return false;
  }
}

// --- FUNÇÕES DE FILA OFFLINE ---
void salvarNaFila(String json) {
  File arquivo = LittleFS.open(ARQUIVO_FILA, "a");
  if (arquivo) {
    arquivo.println(json);
    arquivo.close();
    Serial.println("Dados salvos na fila offline.");
  }
}

void processarFila() {
  if (WiFi.status() != WL_CONNECTED || !LittleFS.exists(ARQUIVO_FILA)) return;
  
  File arquivo = LittleFS.open(ARQUIVO_FILA, "r");
  if (!arquivo) return;
  
  String restantes = "";
  Serial.println("Processando fila offline...");
  
  while (arquivo.available()) {
    String linha = arquivo.readStringUntil('\n');
    linha.trim();
    if (linha.length() == 0) continue;
    
    if (!enviarParaSupabase(linha)) {
      restantes += linha + "\n";
    }
    delay(200);
  }
  arquivo.close();
  
  File novo = LittleFS.open(ARQUIVO_FILA, "w");
  if (novo) {
    novo.print(restantes);
    novo.close();
  }
}

// --- LEITURA DE SENSORES (Real) ---

float medirCorrenteRMS(int pino) {
  float voltagem;
  float corrente;
  float somaCorrente = 0;
  long tempoInicio = millis();
  int contador = 0;

  // Amostragem por 200ms (aprox. 12 ciclos de 60Hz)
  while (millis() - tempoInicio < 200) {
    // Lê o valor analógico (0-4095)
    int leitura = analogRead(pino);
    
    // Converte para voltagem (considerando divisor de tensão ou offset de 1.65V para ESP32)
    // Ajuste o offset conforme seu circuito (geralmente leitura - 2048 para offset de 1.65V)
    voltagem = (leitura - 2048) * (3.3 / 4095.0);
    
    // Corrente = Voltagem * Fator de Calibração (Ex: 30A/1V para SCT-013-030)
    // Ajuste o fator 30.0 para o seu sensor específico
    corrente = voltagem * 30.0; 
    
    somaCorrente += (corrente * corrente);
    contador++;
  }

  float rms = sqrt(somaCorrente / contador);
  
  // Filtro de ruído (se for muito baixo, considera 0)
  if (rms < 0.15) rms = 0;
  
  return rms;
}

float lerCorrente() {
  return medirCorrenteRMS(pinCorrente);
}

float lerTemperatura() {
  sensors.requestTemperatures();
  float temp = sensors.getTempCByIndex(0);
  
  // Se o sensor falhar (retorna -127), retorna 0 ou valor anterior
  if (temp == -127.00) return 0.0;
  return temp;
}

float lerPressao() {
  // Exemplo para sensor 0-5V (0-10 bar)
  // float voltagem = (analogRead(pinPressao) * 3.3) / 4095.0;
  // return (voltagem - 0.5) * (10.0 / 4.0);
  return 3.5 + (random(-2, 2) / 10.0); // Simulação: 3.5 kgf estável
}

// --- SETUP E LOOP ---
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  
  // Inicia sensores de temperatura
  sensors.begin();
  
  if (!LittleFS.begin(true)) {
    Serial.println("Erro ao iniciar LittleFS");
  }
  
  conectarWifi();
}

void loop() {
  unsigned long agora = millis();

  // Ciclo de Leitura e Envio
  if (agora - ultimoTempoLeitura >= intervaloLeitura) {
    ultimoTempoLeitura = agora;
    
    StaticJsonDocument<512> doc;
    doc["placa_id"] = PLACA_ID;
    doc["tipo_placa"] = TIPO_PLACA;
    doc["condominio"] = CONDOMINIO;
    doc["equipamento"] = EQUIPAMENTO;
    doc["timestamp"] = obterTimestamp();
    
    // Adiciona leituras conforme o tipo de equipamento
    if (TIPO_PLACA == "pressao") {
      doc["pressao"] = lerPressao();
    } else {
      doc["corrente"] = lerCorrente();
      doc["temperatura"] = lerTemperatura();
    }

    String body;
    serializeJson(doc, body);
    Serial.println("Leitura: " + body);
    
    if (!enviarParaSupabase(body)) {
      salvarNaFila(body);
    }
  }

  // Ciclo de Processamento da Fila
  if (WiFi.status() == WL_CONNECTED && agora - ultimoTempoFila >= intervaloFila) {
    ultimoTempoFila = agora;
    processarFila();
  }
  
  // Reconexão WiFi Automática
  if (WiFi.status() != WL_CONNECTED) {
    conectarWifi();
  }
  
  delay(1000);
}
