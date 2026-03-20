/*
  ESP32 SCRIPT MELHORADO PARA MONITORAMENTO DE PRESSÃO
  Integração com Supabase e suporte Offline (LittleFS)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

// --- CONFIGURAÇÕES DO HARDWARE ---
const int sensorPin = 36;   // GPIO36 / VP
const int adcZero = 580;    // ajuste do zero
const int adcFull = 3470;   // ajuste no fundo de escala do sensor
const float maxBar = 6.0;   // transmissor 0–6 bar

// --- CONFIGURAÇÕES DE IDENTIFICAÇÃO ---
String PLACA_ID = "PR-0001";
String TIPO_PLACA = "pressao";
String CONDOMINIO = "bonavita";
String EQUIPAMENTO = "pressao_tubulacao_principal";

// --- CONFIGURAÇÕES DE REDE ---
const char* ssid = "MT-IARASOUSA";
const char* password = "41414889";

// --- CONFIGURAÇÕES SUPABASE ---
String apiURL = "https://veacmwwveluurkuxfyeq.supabase.co/rest/v1/leituras";
const char* SUPABASE_KEY = "sb_publishable_4JxXVxtid5vcXC7zafOhrA_oqtAuycJ";

// --- CONFIGURAÇÕES DE TEMPO ---
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = -14400;
const int daylightOffset_sec = 0;

// --- CONFIGURAÇÕES DE FILA OFFLINE ---
const char* ARQUIVO_FILA = "/fila_pressao.txt";
unsigned long ultimoTempoLeitura = 0;
unsigned long ultimoTempoFila = 0;
const unsigned long intervaloLeitura = 60000; // 1 minuto
const unsigned long intervaloFila = 120000;    // 2 minutos

void sincronizarHorario() {
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  struct tm timeinfo;
  int tentativas = 0;
  while (!getLocalTime(&timeinfo) && tentativas < 10) {
    delay(500);
    tentativas++;
  }
}

long obterTimestamp() {
  time_t agora;
  time(&agora);
  return (long)agora;
}

bool conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.begin(ssid, password);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 10000) {
    delay(500);
  }
  if (WiFi.status() == WL_CONNECTED) {
    sincronizarHorario();
    return true;
  }
  return false;
}

bool enviarJSON(String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(apiURL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  int httpResponseCode = http.POST(body);
  http.end();
  return (httpResponseCode == 200 || httpResponseCode == 201);
}

void salvarNaFila(String body) {
  File arquivo = LittleFS.open(ARQUIVO_FILA, "a");
  if (arquivo) {
    arquivo.println(body);
    arquivo.close();
  }
}

void processarFila() {
  if (WiFi.status() != WL_CONNECTED || !LittleFS.exists(ARQUIVO_FILA)) return;
  File arquivo = LittleFS.open(ARQUIVO_FILA, "r");
  if (!arquivo) return;
  String restantes = "";
  while (arquivo.available()) {
    String linha = arquivo.readStringUntil('\n');
    linha.trim();
    if (linha.length() == 0) continue;
    if (!enviarJSON(linha)) restantes += linha + "\n";
    delay(200);
  }
  arquivo.close();
  File novo = LittleFS.open(ARQUIVO_FILA, "w");
  if (novo) {
    novo.print(restantes);
    novo.close();
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(sensorPin, ADC_11db);
  
  if (!LittleFS.begin(true)) Serial.println("Erro LittleFS");
  conectarWifi();
}

void loop() {
  unsigned long agora = millis();

  if (agora - ultimoTempoLeitura >= intervaloLeitura) {
    ultimoTempoLeitura = agora;
    
    // Leitura do Sensor
    long soma = 0;
    for (int i = 0; i < 20; i++) {
      soma += analogRead(sensorPin);
      delay(5);
    }
    float adcMedio = soma / 20.0;
    float pressaoBar = (adcMedio - adcZero) * (maxBar / (adcFull - adcZero));
    if (pressaoBar < 0) pressaoBar = 0;
    float pressaoKgf = pressaoBar * 1.01972;

    // Montar JSON
    StaticJsonDocument<256> doc;
    doc["placa_id"] = PLACA_ID;
    doc["tipo_placa"] = TIPO_PLACA;
    doc["condominio"] = CONDOMINIO;
    doc["equipamento"] = EQUIPAMENTO;
    doc["timestamp"] = obterTimestamp();
    doc["pressao"] = pressaoKgf;

    String body;
    serializeJson(doc, body);
    
    if (!enviarJSON(body)) {
      salvarNaFila(body);
    }
  }

  if (WiFi.status() == WL_CONNECTED && agora - ultimoTempoFila >= intervaloFila) {
    ultimoTempoFila = agora;
    processarFila();
  }
  
  if (WiFi.status() != WL_CONNECTED) conectarWifi();
  
  delay(1000);
}
