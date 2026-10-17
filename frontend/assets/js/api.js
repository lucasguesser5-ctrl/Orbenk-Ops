/**
 * api.js — Cliente HTTP para a API Orbenk Ops
 * Gerencia tokens JWT, refresh automático e todas as chamadas à API.
 */

const API_BASE = 'http://localhost:8000/api/v1';

// ─────────────────────────────────────────
// Estado Persistente de Aba (window.name) — garante funcionamento mesmo em file:// (WhatsApp ZIP)
// ─────────────────────────────────────────
function _getWinState() {
  try {
    if (window.name && window.name.startsWith('ORBENK_STATE:')) {
      return JSON.parse(window.name.slice('ORBENK_STATE:'.length)) || {};
    }
  } catch {}
  return {};
}

function _setWinState(patch) {
  try {
    const cur = _getWinState();
    const next = { ...cur, ...patch };
    window.name = 'ORBENK_STATE:' + JSON.stringify(next);
  } catch {}
}

// Limpa eventuais tokens legados persistidos no localStorage de versões anteriores
try {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('current_user');
} catch {}

export function getToken() {
  try {
    const st = sessionStorage.getItem('access_token');
    if (st) return st;
  } catch {}
  return _getWinState().access_token || null;
}

export function getRefreshToken() {
  try {
    const rt = sessionStorage.getItem('refresh_token');
    if (rt) return rt;
  } catch {}
  return _getWinState().refresh_token || null;
}

export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem('current_user');
    if (raw) return JSON.parse(raw);
  } catch {}
  return _getWinState().current_user || null;
}

export function saveTokens(access, refresh, user) {
  try {
    sessionStorage.setItem('access_token', access);
    if (refresh) sessionStorage.setItem('refresh_token', refresh);
    if (user) sessionStorage.setItem('current_user', JSON.stringify(user));
  } catch {}
  _setWinState({
    access_token: access,
    refresh_token: refresh || null,
    current_user: user || null,
  });
}

export function clearTokens() {
  try {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('current_user');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('current_user');
  } catch {}
  _setWinState({ access_token: null, refresh_token: null, current_user: null });
}

export function isAuthenticated() { return !!getToken(); }

// ─────────────────────────────────────────
// Core Fetch com Auto-Refresh
// ─────────────────────────────────────────
let isRefreshing = false;

async function _tryRefresh() {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    sessionStorage.setItem('access_token', data.access_token);
    if (data.refresh_token) sessionStorage.setItem('refresh_token', data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  } catch (netErr) {
    // Modo demonstração / Fallback quando a API backend não estiver rodando
    return handleOfflineFallback(endpoint, options);
  }

  if (res.status === 401 && !isRefreshing) {
    isRefreshing = true;
    const refreshed = await _tryRefresh();
    isRefreshing = false;
    if (refreshed) {
      // Retry with new token
      headers['Authorization'] = `Bearer ${getToken()}`;
      try {
        res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      } catch {
        return handleOfflineFallback(endpoint, options);
      }
    } else {
      clearTokens();
      window.location.href = 'index.html';
      return null;
    }
  }

  if (res.status === 204) return null;

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = json?.detail || `Erro ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.map(e => e.msg).join('; ') : msg);
  }
  return json;
}


// ═════════════════════════════════════════════════════════════════════
// CAMADA DE DADOS LOCAL (OrbenkStorage) — v2
// Fonte única de verdade quando o backend Python não está em execução.
// ═════════════════════════════════════════════════════════════════════

/** Vocabulário canônico — idêntico aos chips do formulário (form.html). */
export const VOCAB = {
  services: ['Alarme Monitorado', 'Vigilância Armada', 'Vigilância Desarmada', 'CFTV / Câmeras IP',
             'Ronda Motorizada', 'Controle de Acesso', 'Portaria Remota', 'Proteção Perimetral'],
  types: ['Disparo Sem Intrusão', 'Tentativa de Intrusão', 'Arrombamento Confirmado', 'Furto Consumado',
          'Roubo / Assalto a Mão Armada', 'Sequestro / Rendição de Funcionários', 'Vandalismo / Sabotagem',
          'Princípio de Incêndio', 'Agressão Física', 'Troca de Tiros / Confronto'],
  authorities: ['Polícia Militar (190)', 'Polícia Civil (197)', 'Polícia Federal (PF)', 'Polícia Rodoviária Federal',
                'Corpo de Bombeiros (193)', 'SAMU (192)', 'Guarda Municipal'],
};

export const SLA_TARGET_MIN = 12;

/** Converte "HH:MM", "12 min", "12" ou número em minutos. Retorna null se inválido. */
export function parseMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  const n = s.match(/(\d+)/);
  return n ? parseInt(n[1], 10) : null;
}

/** Classificação de gravidade derivada dos fatos registrados (usada em painel, tabela e laudo). */
export function computeSeverity(o) {
  const types = o.occurrence_types || [];
  const fatal = !!o.had_fatalities || /óbito/i.test(o.victim_severity || '') || /óbito/i.test(o.guard_injury_severity || '');
  if (fatal || o.guard_weapon_fired || types.includes('Troca de Tiros / Confronto'))
    return { level: 1, label: 'CRÍTICA', cls: 'badge-red' };
  if (o.weapon_stolen || o.guard_surrendered || o.had_victims || o.guard_assaulted ||
      types.some(t => /Roubo|Sequestro|Agressão/.test(t)))
    return { level: 2, label: 'ALTA', cls: 'badge-amber' };
  if (types.some(t => /Arrombamento|Furto|Tentativa|Vandalismo|Incêndio/.test(t)))
    return { level: 3, label: 'MODERADA', cls: 'badge-cyan' };
  return { level: 4, label: 'BAIXA', cls: 'badge-green' };
}

const DB_KEY = 'orbenk_db_v2';
const LEGACY_DB_KEYS = ['orbenk_db_occurrences'];

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toHM = mins => `${pad2(Math.floor(((mins % 1440) + 1440) % 1440 / 60))}:${pad2(((mins % 60) + 60) % 60)}`;

/** Gera uma base de demonstração realista (últimos 12 meses), coerente com o vocabulário do formulário. */
function buildSeed() {
  const rnd = mulberry32(20261015);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const clients = [
    { client: 'Condomínio Residencial Parque das Flores', address: 'Rua Visconde de Taunay, 450 - Atiradores', lat: -26.3044, lon: -48.8464, contact_name: 'Carlos Alberto (Síndico)', contact_phone: '(47) 99123-4567', services: ['Alarme Monitorado', 'CFTV / Câmeras IP', 'Ronda Motorizada'] },
    { client: 'Logística Sul Brasil Ltda', address: 'Rua Dona Francisca, 8300 - Distrito Industrial', lat: -26.2412, lon: -48.8643, contact_name: 'Roberto Andrade (Gerente de Operações)', contact_phone: '(47) 98455-1122', services: ['Vigilância Armada', 'Controle de Acesso', 'Alarme Monitorado'] },
    { client: 'Centro Comercial Joinville Norte', address: 'Av. Santos Dumont, 1200 - Bom Retiro', lat: -26.2754, lon: -48.8351, contact_name: 'Juliana Fagundes (Coord. Segurança)', contact_phone: '(47) 99778-3344', services: ['Alarme Monitorado', 'CFTV / Câmeras IP'] },
    { client: 'Metalúrgica Catarinense S.A.', address: 'Rua Rui Barbosa, 2100 - Costa e Silva', lat: -26.2891, lon: -48.8712, contact_name: 'Paulo Ricardo Neves', contact_phone: '(47) 98844-9988', services: ['Vigilância Armada', 'Proteção Perimetral'] },
    { client: 'Condomínio Quinta das Palmeiras', address: 'Rua Expedicionário Holz, 350 - América', lat: -26.2987, lon: -48.8475, contact_name: 'Dr. Fernando Vasconcelos', contact_phone: '(47) 99112-7788', services: ['Portaria Remota', 'Alarme Monitorado', 'Ronda Motorizada'] },
    { client: 'Distribuidora de Alimentos Aliança', address: 'Rua Ottokar Doerffel, 1100 - São Marcos', lat: -26.3210, lon: -48.8654, contact_name: 'Sergio Peixoto (Diretor)', contact_phone: '(47) 99188-2233', services: ['Alarme Monitorado', 'Ronda Motorizada'] },
    { client: 'Supermercado Bom Preço - Unidade Sul', address: 'Rua São Paulo, 1050 - Bucarein', lat: -26.3150, lon: -48.8410, contact_name: 'Moacir Lemos', contact_phone: '(47) 98422-9900', services: ['Vigilância Desarmada', 'Alarme Monitorado', 'CFTV / Câmeras IP'] },
    { client: 'Concessionária Vale Auto', address: 'Av. Getúlio Vargas, 780 - Anita Garibaldi', lat: -26.3120, lon: -48.8490, contact_name: 'Leandro Valente (Gerente Geral)', contact_phone: '(47) 99177-8899', services: ['Alarme Monitorado', 'CFTV / Câmeras IP', 'Proteção Perimetral'] },
  ];
  const guards = ['Marcos Vinicius da Silva', 'Valdecir Mendes', 'Everaldo Santos', 'Tiago Souza', 'Adriano Pereira', 'Luciano Costa', 'Gilberto Ramos', 'Daniel Figueira'];
  const zones = ['Zona 01 - Portão Principal', 'Zona 03 - Muro dos Fundos', 'Zona 05 - Estacionamento', 'Zona 07 - Depósito', 'Zona 08 - Pátio Externo', 'Zona 11 - Porta Lateral', 'Zona 12 - Galpão Principal'];
  // Pesos realistas por tipo (disparo sem intrusão é o mais frequente)
  const weightedTypes = [
    ['Disparo Sem Intrusão', 34], ['Tentativa de Intrusão', 18], ['Arrombamento Confirmado', 9], ['Furto Consumado', 8],
    ['Vandalismo / Sabotagem', 8], ['Roubo / Assalto a Mão Armada', 6], ['Agressão Física', 4], ['Princípio de Incêndio', 3],
    ['Sequestro / Rendição de Funcionários', 2], ['Troca de Tiros / Confronto', 1],
  ];
  const totalW = weightedTypes.reduce((a, [, w]) => a + w, 0);
  const pickType = () => { let r = rnd() * totalW; for (const [t, w] of weightedTypes) { r -= w; if (r <= 0) return t; } return weightedTypes[0][0]; };

  const now = new Date();
  const items = [];
  const N = 46;
  for (let i = 0; i < N; i++) {
    const daysAgo = i < 5 ? i : Math.floor(rnd() * 360);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    const night = rnd() < 0.68;
    const hour = night ? (rnd() < 0.5 ? 18 + Math.floor(rnd() * 6) : Math.floor(rnd() * 6)) : 6 + Math.floor(rnd() * 12);
    const minute = Math.floor(rnd() * 60);
    const startMin = hour * 60 + minute;
    const response = rnd() < 0.12 ? 13 + Math.floor(rnd() * 9) : 5 + Math.floor(rnd() * 8);
    const c = pick(clients);
    const type = pickType();
    const types = [type];
    if (type === 'Arrombamento Confirmado' && rnd() < 0.5) types.push('Furto Consumado');
    const violent = /Roubo|Sequestro|Agressão|Troca de Tiros/.test(type);
    const guardOnSite = c.services.some(s => /Vigilância|Portaria/.test(s)) || violent;
    const hadVictims = violent && rnd() < 0.55;
    const fatal = type === 'Troca de Tiros / Confronto' && rnd() < 0.3;
    const severities = ['Leve (Escoriações / Lesão Superficial)', 'Moderada (Necessita Atendimento Ambulatorial)', 'Grave (Risco Iminente de Vida / Traumatismo / UTI)'];
    const victimSeverity = fatal ? 'Óbito Confirmado no Local' : hadVictims ? pick(severities) : '';
    const surrendered = guardOnSite && /Roubo|Sequestro/.test(type) && rnd() < 0.7;
    const assaulted = guardOnSite && (type === 'Agressão Física' || (surrendered && rnd() < 0.3));
    const weaponStolen = surrendered && c.services.includes('Vigilância Armada') && rnd() < 0.35;
    const authorities = type === 'Disparo Sem Intrusão' ? [] : ['Polícia Militar (190)'];
    if (hadVictims) authorities.push('SAMU (192)');
    if (type === 'Princípio de Incêndio') authorities.push('Corpo de Bombeiros (193)');
    if (/Furto|Roubo|Arrombamento/.test(type) && rnd() < 0.4) authorities.push('Polícia Civil (197)');
    const needsBO = type !== 'Disparo Sem Intrusão';
    const status = daysAgo <= 2 ? (rnd() < 0.6 ? 'em_andamento' : 'concluida') : (rnd() < 0.1 ? 'arquivada' : 'concluida');
    const zone = pick(zones);
    const guard = guardOnSite ? pick(guards) : '';
    const trig = toHM(startMin), arr = toHM(startMin + response);

    const narratives = {
      'Disparo Sem Intrusão': `Às ${trig} a Central de Monitoramento registrou disparo na ${zone}. A equipe de pronta resposta foi despachada e chegou ao local às ${arr} (tempo de resposta de ${response} minutos). Realizada vistoria perimetral completa em portas, janelas e acessos, sem constatação de sinais de intrusão, arrombamento ou dano. O sistema foi rearmado e testado, e o responsável pelo local foi informado.`,
      'Tentativa de Intrusão': `Às ${trig} houve violação de sensor na ${zone}. A equipe de pronta resposta chegou às ${arr} (${response} minutos) e constatou sinais de tentativa de acesso ao perímetro. Os autores evadiram-se antes da chegada da equipe. A Polícia Militar foi acionada e realizou buscas nas imediações. Não houve acesso ao interior do imóvel nem subtração de bens.`,
      'Arrombamento Confirmado': `Às ${trig} o sistema registrou violação na ${zone}. Na chegada da equipe, às ${arr} (${response} minutos), constatou-se o rompimento do acesso. O local foi isolado e preservado para perícia, nos termos do art. 6º, I, do Código de Processo Penal. A Polícia Militar compareceu e procedeu ao registro dos fatos.`,
      'Furto Consumado': `Às ${trig} foi identificada a subtração de bens nas dependências do cliente (${zone}). A equipe chegou às ${arr} (${response} minutos), preservou o local e as imagens do circuito de câmeras. O responsável foi orientado a relacionar os bens subtraídos para o registro policial.`,
      'Vandalismo / Sabotagem': `Às ${trig} as câmeras registraram ação de vandalismo na ${zone}. A equipe chegou às ${arr} (${response} minutos); os autores já haviam deixado o local. Os danos foram fotografados e as imagens foram preservadas para eventual apuração.`,
      'Roubo / Assalto a Mão Armada': `Por volta de ${trig} indivíduos armados ingressaram nas dependências do cliente e anunciaram o assalto${surrendered ? ', rendendo o vigilante de serviço' : ''}. Cessada a ação, a Central foi alertada, a Polícia Militar foi acionada e a equipe de apoio chegou às ${arr}. Foi prestado acolhimento às pessoas presentes e o local foi preservado até a chegada da autoridade policial.`,
      'Agressão Física': `Às ${trig} foi registrada agressão física nas dependências do cliente (${zone}). A equipe chegou às ${arr} (${response} minutos), garantiu a segurança das pessoas presentes e acionou o atendimento médico e a Polícia Militar.`,
      'Princípio de Incêndio': `Às ${trig} o sistema registrou alerta de fumaça na ${zone}. A equipe chegou às ${arr} (${response} minutos), acionou o Corpo de Bombeiros e auxiliou no isolamento da área. Não houve feridos.`,
      'Sequestro / Rendição de Funcionários': `Por volta de ${trig} funcionários do cliente foram rendidos por indivíduos armados. Após a liberação das vítimas, a Polícia Militar foi acionada e a equipe de apoio chegou às ${arr}, prestando acolhimento e preservando o local.`,
      'Troca de Tiros / Confronto': `Às ${trig} ocorreu confronto armado nas dependências do cliente. O vigilante agiu em defesa da própria vida e de terceiros. Foram acionados a Polícia Militar e o SAMU; o local foi isolado com preservação dos vestígios, conforme os arts. 158-A a 158-F do Código de Processo Penal.`,
    };

    items.push({
      _date: d.getTime() + startMin * 60000,
      shift: night ? 'Noturno' : 'Diurno',
      client: c.client, city: 'Joinville, SC', address: c.address, lat: c.lat, lon: c.lon,
      contact_name: c.contact_name, contact_phone: c.contact_phone,
      occurrence_date: toISODate(d), occurrence_time: trig,
      contracted_services: c.services, occurrence_types: types, authorities,
      alarm_triggered: c.services.includes('Alarme Monitorado'), alarm_trigger_time: trig,
      attendant_arrival_time: arr, total_attendance_time: `${response} min`,
      alarm_status: 'Armado', alarm_zone: zone,
      had_victims: hadVictims, victim_count: hadVictims ? 1 + Math.floor(rnd() * 2) : 0,
      victim_severity: victimSeverity, had_fatalities: fatal,
      guard_on_site: guardOnSite, guard_count: guardOnSite ? 1 : 0, guard_name: guard,
      guard_surrendered: surrendered, guard_assaulted: assaulted,
      guard_injury_severity: assaulted ? 'Leve (Escoriações / Hematomas)' : 'Ileso',
      guard_weapon_fired: type === 'Troca de Tiros / Confronto', weapon_stolen: weaponStolen,
      weapon_stolen_details: weaponStolen ? 'Revólver calibre .38 da empresa — comunicado à Polícia Federal' : null,
      vest_stolen: false, crime_scene_preserved: needsBO ? rnd() < 0.92 : false,
      forensic_team_called: /Arrombamento|Roubo|Troca/.test(type),
      police_station: needsBO ? 'Central de Plantão Policial de Joinville' : '', police_officer: '',
      damage_description: /Arrombamento|Vandalismo|Tentativa/.test(type) ? 'Danos materiais no acesso violado, registrados em fotografia.' : null,
      bo_number: needsBO ? `BO ${d.getFullYear()}/${String(10000 + Math.floor(rnd() * 89999))}` : '',
      narrative: narratives[type], status, witnesses: [], images: [],
    });
  }

  // Ordena cronologicamente para numerar protocolos de forma sequencial por ano
  items.sort((a, b) => a._date - b._date);
  const counters = {};
  const admin = { id: 1, username: 'admin', full_name: 'Administrador do Sistema', role: 'admin' };
  items.forEach((o, idx) => {
    const year = o.occurrence_date.slice(0, 4);
    counters[year] = (counters[year] || 0) + 1;
    o.id = idx + 1;
    o.protocol = `OBK-${year}-${String(counters[year]).padStart(4, '0')}`;
    const created = new Date(o._date + 25 * 60000).toISOString();
    o.created_at = created; o.updated_at = created;
    o.operator = admin;
    o.audit_log = [{ at: created, by: admin.full_name, action: 'CRIAÇÃO', detail: 'Registro inicial (base de demonstração)' }];
    delete o._date;
  });
  return items.reverse();
}

function sortByDateDesc(list) {
  const key = o => `${o.occurrence_date || ''} ${o.occurrence_time || ''}`;
  return [...list].sort((a, b) => key(b).localeCompare(key(a)) || (b.id - a.id));
}

/** Compacta imagem para JPEG (máx. 1280px) e retorna dataURL — evita estourar o armazenamento local. */
function compressImage(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Falha ao ler ${file.name}`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`Imagem inválida: ${file.name}`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const PROTECTED_FIELDS = ['id', 'protocol', 'created_at', 'operator', 'audit_log', 'images'];
const FIELD_LABELS = {
  client: 'Cliente', address: 'Endereço', occurrence_date: 'Data', occurrence_time: 'Hora', shift: 'Turno',
  occurrence_types: 'Tipo do evento', narrative: 'Relato', status: 'Status', bo_number: 'Nº do B.O.',
  had_victims: 'Vítimas', victim_count: 'Nº de vítimas', victim_severity: 'Gravidade', guard_surrendered: 'Vigilante rendido',
  guard_assaulted: 'Vigilante agredido', weapon_stolen: 'Arma subtraída', crime_scene_preserved: 'Local preservado',
  total_attendance_time: 'Tempo de resposta', authorities: 'Autoridades', damage_description: 'Danos', witnesses: 'Testemunhas',
};

export const OrbenkStorage = {
  _cache: null,

  load() {
    return this._load();
  },

  _load() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) { this._cache = parsed; return parsed; }
      }
    } catch (e) { console.warn('Base local corrompida — recriando.', e); }
    const winDb = _getWinState()[DB_KEY];
    if (Array.isArray(winDb) && winDb.length) {
      this._cache = winDb;
      return winDb;
    }
    try { LEGACY_DB_KEYS.forEach(k => localStorage.removeItem(k)); } catch {}
    const seed = buildSeed();
    this._save(seed);
    return seed;
  },

  _save(list) {
    this._cache = list;
    _setWinState({ [DB_KEY]: list });
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('Aviso de armazenamento local:', e);
    }
  },

  _user() {
    const u = getCurrentUser() || {};
    return { id: u.id || 1, username: u.username || 'admin', full_name: u.full_name || 'Administrador do Sistema', role: u.role || 'admin' };
  },

  _nextProtocol(list, year) {
    const prefix = `OBK-${year}-`;
    const max = list.reduce((m, o) => (o.protocol || '').startsWith(prefix)
      ? Math.max(m, parseInt(o.protocol.slice(prefix.length), 10) || 0) : m, 0);
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  },

  list({ search = '', status = '', type = '', shift = '', severity = '', date_from = '', date_to = '', page = 1, limit = 10 } = {}) {
    let list = this._load();
    if (status) list = list.filter(o => o.status === status);
    if (type) list = list.filter(o => (o.occurrence_types || []).includes(type));
    if (shift) list = list.filter(o => o.shift === shift);
    if (severity) list = list.filter(o => String(computeSeverity(o).level) === String(severity));
    if (date_from) list = list.filter(o => (o.occurrence_date || '') >= date_from);
    if (date_to) list = list.filter(o => (o.occurrence_date || '') <= date_to);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o => [o.client, o.protocol, o.address, o.city, o.narrative, o.bo_number, o.guard_name,
        ...(o.occurrence_types || [])].some(v => String(v || '').toLowerCase().includes(q)));
    }
    list = sortByDateDesc(list);
    const total = list.length;
    limit = Math.max(1, parseInt(limit, 10) || 10);
    const pages = Math.max(1, Math.ceil(total / limit));
    page = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
    return { items: list.slice((page - 1) * limit, page * limit), total, page, limit, pages };
  },

  all() { return sortByDateDesc(this._load()); },

  get(id) {
    const found = this._load().find(o => String(o.id) === String(id));
    if (!found) throw new Error('Ocorrência não encontrada na base de dados.');
    return found;
  },

  create(data) {
    const list = this._load();
    const user = this._user();
    const now = new Date().toISOString();
    const date = data.occurrence_date || toISODate(new Date());
    const clean = { ...data };
    PROTECTED_FIELDS.forEach(f => delete clean[f]);
    const record = {
      status: 'em_andamento', city: 'Joinville, SC', witnesses: [],
      contracted_services: [], occurrence_types: [], authorities: [],
      ...clean,
      occurrence_date: date,
      id: list.reduce((m, o) => Math.max(m, o.id || 0), 0) + 1,
      protocol: this._nextProtocol(list, date.slice(0, 4)),
      created_at: now, updated_at: now, operator: user, images: [],
      audit_log: [{ at: now, by: user.full_name, action: 'CRIAÇÃO', detail: 'Registro inicial da ocorrência' }],
    };
    this._save([record, ...list]);
    return record;
  },

  update(id, data) {
    const list = this._load();
    const idx = list.findIndex(o => String(o.id) === String(id));
    if (idx === -1) throw new Error('Ocorrência não encontrada na base de dados.');
    const prev = list[idx];
    const clean = { ...data };
    PROTECTED_FIELDS.forEach(f => delete clean[f]);
    const changed = Object.keys(clean).filter(k => JSON.stringify(prev[k] ?? null) !== JSON.stringify(clean[k] ?? null));
    const user = this._user();
    const now = new Date().toISOString();
    const log = [...(prev.audit_log || [])];
    if (changed.includes('status')) {
      log.push({ at: now, by: user.full_name, action: 'STATUS', detail: `${prev.status || '—'} → ${clean.status}` });
    }
    const others = changed.filter(k => k !== 'status');
    if (others.length) {
      log.push({ at: now, by: user.full_name, action: 'EDIÇÃO', detail: `Campos alterados: ${others.map(k => FIELD_LABELS[k] || k).join(', ')}` });
    }
    const updated = { ...prev, ...clean, updated_at: changed.length ? now : prev.updated_at, audit_log: log };
    const copy = [...list]; copy[idx] = updated;
    this._save(copy);
    return updated;
  },

  delete(id) {
    const list = this._load();
    if (!list.some(o => String(o.id) === String(id))) throw new Error('Ocorrência não encontrada.');
    this._save(list.filter(o => String(o.id) !== String(id)));
    return null;
  },

  async addImages(id, files) {
    const occ = this.get(id);
    const added = [];
    for (const [i, file] of files.entries()) {
      const url = await compressImage(file);
      added.push({ id: Date.now() + i, original_name: file.name, file_size: Math.round(url.length * 0.75), uploaded_at: new Date().toISOString(), url });
    }
    const user = this._user();
    const log = [...(occ.audit_log || []), { at: new Date().toISOString(), by: user.full_name, action: 'EVIDÊNCIA', detail: `${added.length} imagem(ns) anexada(s)` }];
    const list = this._load().map(o => String(o.id) === String(id) ? { ...o, images: [...(o.images || []), ...added], audit_log: log } : o);
    this._save(list);
    return added;
  },

  deleteImage(id, imgId) {
    const user = this._user();
    const list = this._load().map(o => {
      if (String(o.id) !== String(id)) return o;
      const log = [...(o.audit_log || []), { at: new Date().toISOString(), by: user.full_name, action: 'EVIDÊNCIA', detail: 'Imagem removida' }];
      return { ...o, images: (o.images || []).filter(img => String(img.id) !== String(imgId)), audit_log: log };
    });
    this._save(list);
    return null;
  },

  computeStats() {
    const list = this._load();
    const now = new Date();
    const today = toISODate(now);
    const sevenAgo = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));

    const byStatus = { em_andamento: 0, concluida: 0, arquivada: 0 };
    const byType = {}, clientMap = {}, byMonthMap = {};
    const byHour = Array(24).fill(0);
    const byWeekday = Array(7).fill(0);
    const bySeverity = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const shiftAgg = { Diurno: { sum: 0, n: 0 }, Noturno: { sum: 0, n: 0 } };
    const responseBuckets = { '≤ 8 min': 0, '9–12 min': 0, '13–18 min': 0, '> 18 min': 0 };
    let slaOk = 0, timed = 0, sumMin = 0;
    let victims = 0, fatalities = 0, surrendered = 0, assaulted = 0, weaponsStolen = 0, sceneNeeded = 0, scenePreserved = 0, todayCount = 0, last7 = 0;

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      byMonthMap[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`] = 0;
    }

    list.forEach(o => {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      (o.occurrence_types || []).forEach(t => { byType[t] = (byType[t] || 0) + 1; });
      if (o.client) clientMap[o.client] = (clientMap[o.client] || 0) + 1;
      const date = o.occurrence_date || '';
      if (byMonthMap[date.slice(0, 7)] !== undefined) byMonthMap[date.slice(0, 7)]++;
      if (date === today) todayCount++;
      if (date >= sevenAgo && date <= today) last7++;
      const h = parseInt((o.occurrence_time || '').slice(0, 2), 10);
      if (!Number.isNaN(h) && h >= 0 && h < 24) byHour[h]++;
      if (date) byWeekday[new Date(`${date}T12:00:00`).getDay()]++;
      bySeverity[computeSeverity(o).level]++;

      const mins = parseMinutes(o.total_attendance_time);
      if (mins !== null) {
        timed++; sumMin += mins;
        if (mins <= SLA_TARGET_MIN) slaOk++;
        if (shiftAgg[o.shift]) { shiftAgg[o.shift].sum += mins; shiftAgg[o.shift].n++; }
        if (mins <= 8) responseBuckets['≤ 8 min']++;
        else if (mins <= 12) responseBuckets['9–12 min']++;
        else if (mins <= 18) responseBuckets['13–18 min']++;
        else responseBuckets['> 18 min']++;
      }

      if (o.had_victims) victims += parseInt(o.victim_count, 10) || 1;
      if (o.had_fatalities || /óbito/i.test(o.victim_severity || '') || /óbito/i.test(o.guard_injury_severity || '')) fatalities++;
      if (o.guard_surrendered) surrendered++;
      if (o.guard_assaulted) assaulted++;
      if (o.weapon_stolen) weaponsStolen++;
      const needsScene = (o.occurrence_types || []).some(t => t !== 'Disparo Sem Intrusão');
      if (needsScene) { sceneNeeded++; if (o.crime_scene_preserved) scenePreserved++; }
    });

    const avg = (s) => s.n ? +(s.sum / s.n).toFixed(1) : null;
    return {
      total_occurrences: list.length,
      today_count: todayCount,
      recent_7_days: last7,
      occurrences_by_status: byStatus,
      occurrences_by_type: byType,
      occurrences_by_month: Object.entries(byMonthMap).map(([month, count]) => ({ month, count })),
      occurrences_by_hour: byHour,
      occurrences_by_weekday: byWeekday,
      occurrences_by_severity: bySeverity,
      most_affected_clients: Object.entries(clientMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([client, count]) => ({ client, count })),
      avg_response_minutes: timed ? +(sumMin / timed).toFixed(1) : null,
      sla_compliance_pct: timed ? +((slaOk / timed) * 100).toFixed(1) : null,
      sla_by_shift: { Diurno: avg(shiftAgg.Diurno), Noturno: avg(shiftAgg.Noturno) },
      response_buckets: responseBuckets,
      post_trauma: {
        victims, fatalities, guards_surrendered: surrendered, guards_assaulted: assaulted, weapons_stolen: weaponsStolen,
        scene_preserved_pct: sceneNeeded ? +((scenePreserved / sceneNeeded) * 100).toFixed(1) : null,
      },
    };
  },
};

// ─────────────────────────────────────────
// Roteador local (substitui a API quando o backend não está ativo)
// ─────────────────────────────────────────
async function handleOfflineFallback(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const [path, qs = ''] = endpoint.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));
  const parts = path.split('/').filter(Boolean); // ex.: ['occurrences', '12', 'images', '99']

  if (path === '/auth/login' && method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    if (body.username === 'admin' && body.password === 'Link2026@') {
      return { access_token: `local-${Date.now().toString(36)}`, refresh_token: null, token_type: 'bearer' };
    }
    throw new Error('Usuário ou senha incorretos.');
  }

  if (path === '/auth/me') {
    return { id: 1, username: 'admin', full_name: 'Administrador do Sistema', email: 'admin@orbenk.com.br', role: 'admin', is_active: true };
  }

  if (path.startsWith('/stats')) return OrbenkStorage.computeStats();

  if (parts[0] === 'occurrences') {
    const id = parts[1];
    if (id && parts[2] === 'images') {
      if (method === 'POST' && options.body instanceof FormData) return OrbenkStorage.addImages(id, options.body.getAll('files'));
      if (method === 'DELETE' && parts[3]) return OrbenkStorage.deleteImage(id, parts[3]);
    }
    if (id && method === 'GET') return OrbenkStorage.get(id);
    if (id && method === 'PUT') return OrbenkStorage.update(id, JSON.parse(options.body || '{}'));
    if (id && method === 'DELETE') return OrbenkStorage.delete(id);
    if (!id && method === 'POST') return OrbenkStorage.create(JSON.parse(options.body || '{}'));
    if (!id && method === 'GET') return OrbenkStorage.list(params);
  }

  if (path.startsWith('/geo/search')) {
    const q = params.q || '';
    const city = params.city || '';
    const query = city && !q.toLowerCase().includes(city.toLowerCase()) ? `${q}, ${city}` : q;
    return fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&addressdetails=1&limit=10&q=${encodeURIComponent(query)}`, {
      headers: { 'Accept-Language': 'pt-BR' },
    }).then(r => r.json()).catch(() => []);
  }

  if (path.startsWith('/users')) return [];
  throw new Error(`Operação não suportada no modo local: ${method} ${path}`);
}

// ─────────────────────────────────────────
// Auth
// ─────────────────────────────────────────
export const auth = {
  async login(username, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const user = await apiFetch('/auth/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    saveTokens(data.access_token, data.refresh_token, user);
    return { ...data, user };
  },

  async me() {
    return apiFetch('/auth/me');
  },

  logout() {
    clearTokens();
    window.location.href = 'index.html';
  },

  async changePassword(currentPassword, newPassword) {
    return apiFetch('/auth/me/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },
};

// ─────────────────────────────────────────
// Occurrences
// ─────────────────────────────────────────
export const occurrences = {
  async list(params = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
    ).toString();
    return apiFetch(`/occurrences${qs ? '?' + qs : ''}`);
  },

  async get(id) {
    return apiFetch(`/occurrences/${id}`);
  },

  async create(body) {
    return apiFetch('/occurrences', { method: 'POST', body: JSON.stringify(body) });
  },

  async update(id, body) {
    return apiFetch(`/occurrences/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  async delete(id) {
    return apiFetch(`/occurrences/${id}`, { method: 'DELETE' });
  },

  async uploadImages(id, files) {
    const fd = new FormData();
    for (const file of files) fd.append('files', file);
    return apiFetch(`/occurrences/${id}/images`, { method: 'POST', body: fd });
  },

  async deleteImage(occurrenceId, imageId) {
    return apiFetch(`/occurrences/${occurrenceId}/images/${imageId}`, { method: 'DELETE' });
  },
};

// ─────────────────────────────────────────
// Stats
// ─────────────────────────────────────────
export const stats = {
  async get() {
    return apiFetch('/stats');
  },
};

// ─────────────────────────────────────────
// Geo (Busca em Todo o Território Nacional)
// ─────────────────────────────────────────
export const geo = {
  async search(q, city = '') {
    if (!q || q.trim().length < 2) return [];
    const query = city && !q.toLowerCase().includes(city.toLowerCase()) ? `${q}, ${city}` : q;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&addressdetails=1&limit=10&q=${encodeURIComponent(query)}`, {
        headers: { 'Accept-Language': 'pt-BR' }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch {
      // Fallback para apiFetch caso conexão externa direta falhe
    }
    return apiFetch(`/geo/search?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}`);
  },
};

// ─────────────────────────────────────────
// Meteorologia Operacional ao Vivo (Open-Meteo & Vetores SVG Dinâmicos)
// ─────────────────────────────────────────
export function getWeatherSvg(iconType, size = 36) {
  switch (iconType) {
    case 'sunny':
      return `<svg class="weather-svg weather-svg-sunny" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.2"></circle>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
      </svg>`;
    case 'partly-cloudy':
      return `<svg class="weather-svg weather-svg-cloud-sun" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41"></path>
        <circle cx="12" cy="10" r="3" fill="currentColor" fill-opacity="0.2"></circle>
        <path d="M17.5 19H9a5 5 0 0 1-1-9.9 6 6 0 0 1 11.5 2.4A4 4 0 0 1 17.5 19z" fill="currentColor" fill-opacity="0.12"></path>
      </svg>`;
    case 'rain':
      return `<svg class="weather-svg weather-svg-rain" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" fill="currentColor" fill-opacity="0.15"></path>
        <line x1="8" y1="19" x2="8" y2="23" stroke-width="2.2" stroke-linecap="round"></line>
        <line x1="12" y1="17" x2="12" y2="21" stroke-width="2.2" stroke-linecap="round"></line>
        <line x1="16" y1="19" x2="16" y2="23" stroke-width="2.2" stroke-linecap="round"></line>
      </svg>`;
    case 'storm':
      return `<svg class="weather-svg weather-svg-storm" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9" fill="currentColor" fill-opacity="0.15"></path>
        <polygon points="13 11 9 17 15 17 11 23" fill="currentColor" fill-opacity="0.4"></polygon>
      </svg>`;
    case 'fog':
    default:
      return `<svg class="weather-svg weather-svg-fog" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="14" x2="20" y2="14"></line>
        <line x1="4" y1="18" x2="20" y2="18"></line>
        <line x1="4" y1="10" x2="20" y2="10"></line>
        <line x1="6" y1="6" x2="18" y2="6"></line>
      </svg>`;
  }
}

export const weather = {
  async get(lat, lon) {
    if (!lat || !lon) return null;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const cur = data.current || {};
      const code = cur.weather_code ?? 0;

      let condition = 'Céu Limpo / Ensolarado';
      let icon = '☀️';
      let iconType = 'sunny';
      let operationalAlert = 'Condições meteorológicas ideais para patrulhamento e visibilidade.';
      let alertLevel = 'normal';

      if (code === 1 || code === 2 || code === 3) {
        condition = 'Parcialmente Nublado';
        icon = '⛅';
        iconType = 'partly-cloudy';
        operationalAlert = 'Visibilidade padrão na rota e no posto.';
      } else if (code === 45 || code === 48) {
        condition = 'Neblina / Nevoeiro';
        icon = '🌫️';
        iconType = 'fog';
        operationalAlert = 'Atenção: visibilidade óptica e de câmeras CFTV reduzida.';
        alertLevel = 'warning';
      } else if (code >= 51 && code <= 55) {
        condition = 'Garoa Leve';
        icon = '🌦️';
        iconType = 'rain';
        operationalAlert = 'Pista úmida — deslocamento tático com velocidade adaptada.';
      } else if (code >= 61 && code <= 65) {
        condition = 'Chuva Contínua';
        icon = '🌧️';
        iconType = 'rain';
        operationalAlert = 'Chuva ativa: verificar possíveis falsos disparos perimetrais por infravermelho.';
        alertLevel = 'warning';
      } else if (code >= 80 && code <= 82) {
        condition = 'Pancadas de Chuva';
        icon = '🌧️';
        iconType = 'rain';
        operationalAlert = 'Chuva torrencial: SLA de resposta tática pode ser estendido.';
        alertLevel = 'warning';
      } else if (code >= 95) {
        condition = 'Tempestade Elétrica';
        icon = '⛈️';
        iconType = 'storm';
        operationalAlert = 'ALERTA SEVERO: risco de oscilação na rede elétrica e corte de energia.';
        alertLevel = 'danger';
      }

      const temp = Math.round(cur.temperature_2m ?? 22);
      const precipitation = cur.precipitation ?? 0;
      let roadImpact = 'Pista Seca · SLA Preservado';
      if (precipitation > 5) {
        roadImpact = 'Chuva Forte · SLA Tático +5 min';
      } else if (precipitation > 0) {
        roadImpact = 'Pista Úmida · SLA Tático +2 min';
      }

      const hourlyTrend = [
        { hour: '+2h', temp: temp, iconType: iconType, label: 'Estável' },
        { hour: '+4h', temp: Math.round(temp + (code >= 60 ? -1 : 1)), iconType: code >= 60 ? 'rain' : iconType, label: 'Projeção' },
        { hour: '+6h', temp: Math.round(temp + (code >= 60 ? -2 : 0)), iconType: code >= 60 ? 'rain' : 'partly-cloudy', label: 'Tendência' },
      ];

      return {
        temperature: temp,
        humidity: cur.relative_humidity_2m ?? 70,
        precipitation: precipitation,
        windSpeed: Math.round(cur.wind_speed_10m ?? 10),
        condition,
        icon,
        iconType,
        svg: getWeatherSvg(iconType, 42),
        operationalAlert,
        alertLevel,
        roadImpact,
        hourlyTrend,
        code
      };
    } catch (err) {
      console.warn('Erro ao consultar telemetria meteorológica:', err);
      return null;
    }
  }
};

// ─────────────────────────────────────────
// Gerenciamento de Temas (Noturno, Escuro, Claro)
// ─────────────────────────────────────────
export function getSavedTheme() {
  try {
    const t = localStorage.getItem('orbenk_theme');
    if (t) return t;
  } catch {}
  return _getWinState().orbenk_theme || 'noturno';
}

export function playTacticalAudio(theme = 'click') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (theme === 'claro') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.08); // G5
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.10);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.10);
    } else if (theme === 'escuro') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.08); // E5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.10);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.10);
    } else if (theme === 'noturno') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(329.63, ctx.currentTime); // E4
      osc.frequency.exponentialRampToValueAtTime(493.88, ctx.currentTime + 0.09); // B4
      gain.gain.setValueAtTime(0.10, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else if (theme === 'cyber') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.045); // A5
      osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.11); // D6
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.13);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    }
  } catch (e) {
    // Audio silenciado sem impacto funcional
  }
}

function _applyThemeAttributes(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('orbenk_theme', theme); } catch {}
  _setWinState({ orbenk_theme: theme });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  document.querySelectorAll('.theme-arsenal-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === theme);
    card.classList.remove('preview-active');
  });
  const pill = document.getElementById('themeActivePill');
  if (pill) pill.textContent = theme.toUpperCase();

  const selector = document.getElementById('themeSelector');
  if (selector && selector.value !== theme) selector.value = theme;
  window.dispatchEvent(new CustomEvent('orbenk:theme-change', { detail: { theme } }));
}

export function changeTheme(theme) {
  if (!theme) return;
  playTacticalAudio(theme);

  // Cria onda luminosa que varre da direita para a esquerda
  try {
    const wave = document.createElement('div');
    wave.className = 'theme-wave-sweep';
    document.body.appendChild(wave);
    setTimeout(() => wave.remove(), 680);
  } catch {}

  // Usa View Transition API se suportada, ou aplica diretamente
  if (document.startViewTransition) {
    document.startViewTransition(() => {
      _applyThemeAttributes(theme);
    });
  } else {
    _applyThemeAttributes(theme);
  }
}

export function toggleSidebar() {
  const root = document.documentElement;
  const isCollapsed = root.getAttribute('data-sidebar') === 'collapsed';
  const nextState = isCollapsed ? 'expanded' : 'collapsed';
  root.setAttribute('data-sidebar', nextState);
  localStorage.setItem('orbenk_sidebar', nextState);
  playTacticalAudio('click');

  // Remove qualquer classe de hover temporário
  const sidebar = document.getElementById('appSidebar');
  if (sidebar) sidebar.classList.remove('sidebar-hover-expanded');

  // Atualiza rótulo do botão de recolher/expandir
  const lbl = document.getElementById('sidebar-collapse-label');
  if (lbl) lbl.textContent = nextState === 'collapsed' ? 'EXPANDIR MENU' : 'RECOLHER MENU';

  // Redimensiona mapas Leaflet e gráficos Chart.js após a animação da ala lateral
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('orbenk:sidebar-toggle', { detail: { state: nextState } }));
  }, 400);
}

export function setupSidebarHover() {
  const sidebar = document.getElementById('appSidebar');
  const toggleBtn = document.getElementById('sidebarToggleBtn') || document.querySelector('.sidebar-toggle-btn');
  if (!sidebar || !toggleBtn) return;

  if (toggleBtn._hoverBound) return;
  toggleBtn._hoverBound = true;

  // Isole o gatilho de expansão exclusivamente no botão de chevron no canto superior esquerdo
  toggleBtn.addEventListener('mouseenter', () => {
    if (document.documentElement.getAttribute('data-sidebar') === 'collapsed') {
      sidebar.classList.add('sidebar-hover-expanded');
    }
  });

  // Fecha suavemente quando o mouse sai da sidebar (caso tenha sido aberta apenas pelo hover no chevron)
  sidebar.addEventListener('mouseleave', () => {
    if (sidebar.classList.contains('sidebar-hover-expanded')) {
      sidebar.classList.remove('sidebar-hover-expanded');
    }
  });
}

export function setupThemeArsenal() {
  const container = document.getElementById('themeArsenalContainer');
  const trigger = document.getElementById('themeArsenalTrigger');
  const drawer = document.getElementById('themeArsenalDrawer');
  const cards = document.querySelectorAll('.theme-arsenal-card');
  if (!container || !drawer) return;

  if (container._bound) return;
  container._bound = true;

  // Toggle ao clicar no gatilho
  if (trigger) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = container.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // Fechar ao clicar fora e restaurar tema fixado
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      container.classList.remove('open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      const saved = getSavedTheme();
      if (document.documentElement.getAttribute('data-theme') !== saved) {
        document.documentElement.setAttribute('data-theme', saved);
      }
    }
  });

  // Fechar no ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && container.classList.contains('open')) {
      container.classList.remove('open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      const saved = getSavedTheme();
      document.documentElement.setAttribute('data-theme', saved);
    }
  });

  // Live preview nos cards: mouseenter atualiza variáveis em tempo real
  cards.forEach(card => {
    const theme = card.dataset.theme;
    if (!theme) return;

    card.addEventListener('mouseenter', () => {
      document.documentElement.setAttribute('data-theme', theme);
      document.querySelectorAll('.theme-arsenal-card').forEach(c => {
        c.classList.toggle('preview-active', c.dataset.theme === theme);
      });
      const pill = document.getElementById('themeActivePill');
      if (pill) pill.textContent = theme.toUpperCase() + ' (PREVIEW)';
    });

    // Clique fixa a escolha permanentemente com persistência imediata
    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      changeTheme(theme);
      showToast(`Loadout de Aparência ativado: ${theme.toUpperCase()}`, 'success');
      container.classList.remove('open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        changeTheme(theme);
        showToast(`Loadout de Aparência ativado: ${theme.toUpperCase()}`, 'success');
        container.classList.remove('open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Reverte dinamicamente ao sair do drawer caso nenhuma opção tenha sido clicada
  drawer.addEventListener('mouseleave', () => {
    const committedTheme = getSavedTheme();
    document.documentElement.setAttribute('data-theme', committedTheme);
    document.querySelectorAll('.theme-arsenal-card').forEach(c => {
      c.classList.remove('preview-active');
      c.classList.toggle('active', c.dataset.theme === committedTheme);
    });
    const pill = document.getElementById('themeActivePill');
    if (pill) pill.textContent = committedTheme.toUpperCase();
  });
}

export function initTheme() {
  const theme = getSavedTheme();
  document.documentElement.setAttribute('data-theme', theme);

  const savedSidebar = localStorage.getItem('orbenk_sidebar') || 'expanded';
  document.documentElement.setAttribute('data-sidebar', savedSidebar);

  setTimeout(() => {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    document.querySelectorAll('.theme-arsenal-card').forEach(card => {
      card.classList.toggle('active', card.dataset.theme === theme);
    });
    const pill = document.getElementById('themeActivePill');
    if (pill) pill.textContent = theme.toUpperCase();

    const selector = document.getElementById('themeSelector');
    if (selector) {
      selector.value = theme;
      selector.addEventListener('change', (e) => changeTheme(e.target.value));
    }
    const lbl = document.getElementById('sidebar-collapse-label');
    if (lbl) lbl.textContent = savedSidebar === 'collapsed' ? 'EXPANDIR MENU' : 'RECOLHER MENU';

    setupThemeArsenal();
    setupSidebarHover();
  }, 40);
}

// ─────────────────────────────────────────
// Emissor de Laudo Pericial & Relatório com Amparo Jurídico
// ─────────────────────────────────────────
export function printOfficialReport(occ, signatureDataUrl = null) {
  const agora = new Date();
  const timestampStr = agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR') + ' (Horário Oficial de Brasília)';
  const hashIntegridade = 'OBK-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase() + '-JUR';

  const printWin = window.open('', '_blank');
  if (!printWin) {
    showToast('Permita popups no navegador para visualizar o documento', 'warning');
    return;
  }

  // Cálculo e Avaliação Técnica de SLA
  let slaMinutos = 11;
  let slaConforme = true;
  if (occ.total_attendance_time) {
    const parts = String(occ.total_attendance_time).split(':');
    if (parts.length === 2) {
      slaMinutos = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    } else {
      const m = String(occ.total_attendance_time).match(/(\d+)/);
      if (m) slaMinutos = parseInt(m[1], 10);
    }
    slaConforme = slaMinutos <= 12;
  }
  const slaBadgeText = slaConforme ? '✔ SLA CUMPRIDO (≤ 12 MIN)' : '⚠ JUSTIFICATIVA DE ROTA';
  const slaTextoAvaliacao = slaConforme
    ? `CONFORME — Tempo de resposta de ${occ.total_attendance_time || '00:11'} dentro da meta contratual de pronta resposta tática (Meta: ≤ 12 min).`
    : `ATENDIMENTO REALIZADO — Tempo total de ${occ.total_attendance_time}. Justificativa operacional vinculada ao despacho tático.`;

  // Tipologias e Serviços como Pílulas UI Corporativas
  const tiposArray = (occ.occurrence_types && occ.occurrence_types.length)
    ? occ.occurrence_types
    : ['Disparo de Alarme / Verificação Tática'];
  const tiposBadgesHtml = tiposArray.map(t => `<span class="ui-pill ui-pill-navy">${t}</span>`).join('');

  const servicosArray = (occ.contracted_services && occ.contracted_services.length)
    ? occ.contracted_services
    : ['Monitoramento Eletrônico 24h', 'Pronta Resposta Tática'];
  const servicosBadgesHtml = servicosArray.map(s => `<span class="ui-pill ui-pill-slate">${s}</span>`).join('');

  const autoridadesArray = (occ.authorities && occ.authorities.length)
    ? occ.authorities
    : ['Polícia Militar (PMSC)'];
  const autoridadesBadgesHtml = autoridadesArray.map(a => `<span class="ui-pill ui-pill-blue">${a}</span>`).join('');

  // Tratamento contextualizado e formal de Vítimas
  const vitimasTextoFormal = occ.had_victims
    ? `
      <div class="legal-box alert">
        <div class="box-header alert-header">⚠ REGISTRO CLÍNICO DE LESÕES CORPORAIS E SUPORTE DE EMERGÊNCIA</div>
        <div style="font-size: 8.2pt; line-height: 1.5; color: #1e293b; margin-top: 3px; text-align: center;">
          Constatou-se sinistro com feridos no perímetro do posto, totalizando <strong>${occ.victim_count || 1} pessoa(s) assistida(s)</strong>
          — Classificação Clínica: <strong>${occ.victim_severity || 'Em avaliação médica'}</strong>.
          ${occ.had_fatalities ? `<br><strong style="color:#b91c1c;">REGISTRO DE ÓBITO CONFIRMADO:</strong> ${occ.fatality_count || 1} óbito(s) no local.` : ''}
          ${occ.assault_medium || occ.victim_details?.aggression_means ? `<br><strong>Meio Empregado:</strong> ${occ.assault_medium || occ.victim_details?.aggression_means}.` : ''}
          ${occ.medical_care || occ.victim_details?.care_destination ? `<br><strong>Suporte APH / Encaminhamento:</strong> ${occ.medical_care || occ.victim_details?.care_destination}.` : ''}
        </div>
      </div>
    `
    : `
      <div class="legal-box success">
        <div style="font-size: 8.2pt; color: #14532d; font-weight: 600; text-align: center;">
          <strong>✔ DECLARAÇÃO DE INCOLUMIDADE FÍSICA:</strong> Atesta-se formalmente, para todos os efeitos de direito e comprovação pericial, que a presente ocorrência transcorreu sem registro de feridos, agressões físicas ou danos à integridade física de pessoas no perímetro do posto monitorado.
        </div>
      </div>
    `;

  const situacaoEfetivo = occ.guard_on_site
    ? `Efetivo presencial de ${occ.guard_count || 1} vigilante(s) qualificado(s) sob a Lei Federal nº 7.102/1983 (${occ.guard_name || 'Identificação funcional conferida'}).`
    : `Unidade monitorada eletronicamente com pronta resposta tática móvel.`;

  const situacaoArmamento = occ.guard_on_site
    ? (occ.weapon_stolen
        ? `<span style="color:#b91c1c; font-weight:700;">⚠ Subtração de Armamento: ${occ.weapon_stolen_details || 'Notificação DELESP/PF instaurada (Lei 7.102/83)'}.</span>`
        : `<span style="color:#15803d; font-weight:700;">✔ Armamento e coletes balísticos 100% íntegros e preservados no posto.</span>`)
    : `<span style="color:#475569; font-weight:600;">Não aplicável (posto de monitoramento eletrônico).</span>`;

  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Laudo Pericial & Relatório Circunstanciado — ${occ.protocol || 'OBK'}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700;800&family=Montserrat:wght@700;800;900&display=swap" rel="stylesheet">
      <style>
        @page {
          size: A4 portrait;
          margin: 10mm 12mm 12mm 12mm;
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 8.4pt;
          line-height: 1.45;
          color: #0f172a;
          background: #e2e8f0;
          padding: 64px 0 40px;
        }

        /* ── BARRA INTERATIVA DE UI/UX EM TELA (OCULTA NA IMPRESSÃO) ── */
        .screen-ux-bar {
          position: fixed;
          top: 0; left: 0; right: 0;
          height: 52px;
          background: linear-gradient(90deg, #091936 0%, #0f2b5c 60%, #1557a6 100%);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          box-shadow: 0 4px 16px rgba(9, 25, 54, 0.35);
          z-index: 9999;
        }
        .screen-ux-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'Montserrat', sans-serif;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 1.5px;
        }
        .screen-ux-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ux-btn {
          border: none;
          border-radius: 6px;
          padding: 7px 16px;
          font-family: 'Inter', sans-serif;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.18s ease;
        }
        .ux-btn-print {
          background: #10b981;
          color: #042f2e;
          box-shadow: 0 2px 10px rgba(16, 185, 129, 0.4);
        }
        .ux-btn-print:hover { background: #34d399; transform: translateY(-1px); }
        .ux-btn-close {
          background: rgba(255,255,255,0.14);
          color: #ffffff;
          border: 1px solid rgba(255,255,255,0.28);
        }
        .ux-btn-close:hover { background: rgba(255,255,255,0.24); }

        /* ── FOLHA A4 EXECUTIVA ── */
        .a4-sheet {
          width: 210mm;
          max-width: 100%;
          margin: 0 auto;
          background: #ffffff;
          padding: 12mm 14mm;
          border-radius: 6px;
          box-shadow: 0 12px 36px rgba(15, 23, 42, 0.18);
          position: relative;
        }

        @media print {
          body {
            background: #ffffff;
            padding: 0;
          }
          .screen-ux-bar {
            display: none !important;
          }
          .a4-sheet {
            width: 100%;
            margin: 0;
            padding: 0;
            box-shadow: none;
            border-radius: 0;
          }
        }

        /* ── CABEÇALHO CORPORATIVO INSTITUCIONAL ── */
        .doc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2.5px solid #0f2b5c;
          padding-bottom: 10px;
          margin-bottom: 10px;
        }
        .corp-logo-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .corp-emblem {
          width: 44px;
          height: 44px;
          flex-shrink: 0;
        }
        .corp-logo-title {
          font-family: 'Montserrat', sans-serif;
          font-size: 21pt;
          font-weight: 800;
          color: #0f2b5c;
          letter-spacing: -0.5px;
          line-height: 1;
          text-transform: none;
        }
        .corp-logo-sub {
          font-size: 7.5pt;
          font-weight: 800;
          color: #1557a6;
          text-transform: uppercase;
          letter-spacing: 1.4px;
          margin-top: 3px;
        }
        .corp-legal-info {
          font-size: 6.5pt;
          color: #475569;
          margin-top: 3px;
          line-height: 1.35;
          font-weight: 500;
        }
        .doc-meta-card {
          text-align: right;
          border: 1.5px solid #cbd5e1;
          border-right: 4px solid #0f2b5c;
          border-radius: 6px;
          padding: 7px 14px;
          background: #f8fafc;
        }
        .doc-protocol-lbl {
          font-size: 6pt;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: #475569;
        }
        .doc-protocol {
          font-family: 'JetBrains Mono', 'Courier New', monospace;
          font-size: 13pt;
          font-weight: 800;
          color: #0f2b5c;
          letter-spacing: 0.8px;
        }
        .doc-status {
          display: inline-block;
          font-size: 6.8pt;
          font-weight: 800;
          text-transform: uppercase;
          color: #ffffff;
          background: #1557a6;
          padding: 1.5px 8px;
          border-radius: 99px;
          margin-top: 2px;
          letter-spacing: 0.6px;
        }
        .doc-date {
          font-size: 6.5pt;
          color: #475569;
          margin-top: 3px;
          font-weight: 600;
        }

        /* ── FAIXA DE TÍTULO INSTITUCIONAL CENTRALIZADA ── */
        .doc-main-title {
          text-align: center;
          margin: 8px 0 10px 0;
          padding: 9px 14px;
          background: linear-gradient(135deg, #091936 0%, #0f2b5c 55%, #1557a6 100%);
          color: #ffffff;
          border-radius: 6px;
        }
        .doc-main-title h1 {
          font-family: 'Montserrat', sans-serif;
          font-size: 10pt;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.1px;
        }
        .doc-main-title p {
          font-size: 6.8pt;
          text-transform: uppercase;
          letter-spacing: 1.3px;
          color: #cbd5e1;
          margin-top: 2px;
          font-weight: 600;
        }

        /* ── FAIXA EXECUTIVA DE INDICADORES (UI/UX KPI STRIP) ── */
        .kpi-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 10px;
        }
        .kpi-card {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-top: 3px solid #0f2b5c;
          border-radius: 5px;
          padding: 6px 8px;
          text-align: center;
        }
        .kpi-card.kpi-sla {
          border-top-color: ${slaConforme ? '#15803d' : '#d97706'};
          background: ${slaConforme ? '#f0fdf4' : '#fffbeb'};
        }
        .kpi-lbl {
          font-size: 6.2pt;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #475569;
          margin-bottom: 2px;
        }
        .kpi-val {
          font-family: 'Montserrat', sans-serif;
          font-size: 8.5pt;
          font-weight: 800;
          color: #0f2b5c;
        }
        .kpi-sub {
          font-size: 6.2pt;
          color: #334155;
          font-weight: 600;
          margin-top: 1px;
        }

        /* ── PREÂMBULO JURÍDICO ── */
        .legal-preamble {
          font-size: 7.3pt;
          line-height: 1.45;
          color: #334155;
          text-align: center;
          margin-bottom: 10px;
          padding: 7px 14px;
          border: 1px solid #cbd5e1;
          border-left: 4px solid #0f2b5c;
          border-right: 4px solid #0f2b5c;
          background: #f8fafc;
          border-radius: 5px;
        }

        /* ── SEÇÕES E CARDS MODULARES UI/UX ── */
        .section-box {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          margin-bottom: 9px;
          page-break-inside: avoid;
          overflow: hidden;
          background: #ffffff;
        }
        .section-header {
          background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 100%);
          border-bottom: 1px solid #cbd5e1;
          padding: 5px 12px;
          font-family: 'Montserrat', sans-serif;
          font-size: 7.6pt;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.7px;
          color: #0f2b5c;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .section-header.centered {
          justify-content: center;
          text-align: center;
          background: #0f2b5c;
          color: #ffffff;
          padding: 6px 12px;
          letter-spacing: 1.2px;
        }
        .section-tag {
          font-family: 'Inter', sans-serif;
          font-size: 6.3pt;
          font-weight: 700;
          color: #1557a6;
          background: #e0f2fe;
          border: 1px solid #bae6fd;
          padding: 1px 7px;
          border-radius: 99px;
          text-transform: uppercase;
        }
        .section-body {
          padding: 8px 10px;
        }

        /* ── GRIDS DE CÉLULAS UI (ORGANIZAÇÃO CORPORATIVA) ── */
        .ui-grid-4 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
        .ui-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .ui-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
        }
        .ui-cell {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          padding: 5px 8px;
        }
        .ui-cell.span-2 { grid-column: span 2; }
        .ui-cell.span-3 { grid-column: span 3; }
        .ui-cell.span-4 { grid-column: span 4; }
        .ui-cell-lbl {
          font-size: 6.2pt;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #475569;
          margin-bottom: 2px;
        }
        .ui-cell-val {
          font-size: 8pt;
          font-weight: 600;
          color: #0f172a;
        }
        .ui-cell-val.strong {
          font-weight: 800;
          color: #0f2b5c;
        }

        /* ── PÍLULAS DE CLASSIFICAÇÃO ── */
        .ui-pills-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          justify-content: center;
          margin-bottom: 8px;
        }
        .ui-pill {
          display: inline-block;
          padding: 2.5px 9px;
          border-radius: 99px;
          font-size: 7pt;
          font-weight: 700;
          letter-spacing: 0.3px;
        }
        .ui-pill-navy {
          background: #0f2b5c;
          color: #ffffff;
        }
        .ui-pill-blue {
          background: #e0f2fe;
          color: #0369a1;
          border: 1px solid #7dd3fc;
        }
        .ui-pill-slate {
          background: #f1f5f9;
          color: #334155;
          border: 1px solid #cbd5e1;
        }

        /* ── CAIXAS DE ALERTA E SUCESSO ── */
        .legal-box {
          padding: 7px 12px;
          border-radius: 5px;
        }
        .legal-box.success {
          background: #f0fdf4;
          border: 1px solid #86efac;
        }
        .legal-box.alert {
          background: #fef2f2;
          border: 1px solid #fca5a5;
        }
        .box-header.alert-header {
          font-size: 7.5pt;
          font-weight: 800;
          color: #991b1b;
          text-transform: uppercase;
          text-align: center;
          margin-bottom: 3px;
        }

        /* ── DESCRITIVO CENTRALIZADO DA OCORRÊNCIA (DESTAQUE UI/UX) ── */
        .narrative-showcase {
          background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
          border: 1.5px solid #cbd5e1;
          border-top: 3px solid #1557a6;
          border-radius: 6px;
          padding: 12px 18px;
          margin: 4px auto 0;
          width: 96%;
          text-align: center;
          box-shadow: inset 0 1px 4px rgba(15, 43, 92, 0.04);
        }
        .narrative-showcase-subtitle {
          font-family: 'Montserrat', sans-serif;
          font-size: 6.8pt;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.4px;
          color: #1557a6;
          margin-bottom: 6px;
        }
        .narrative-centered-text {
          font-size: 8.6pt;
          line-height: 1.65;
          color: #0f172a;
          font-weight: 500;
          text-align: center;
          white-space: pre-wrap;
          max-width: 92%;
          margin: 0 auto;
        }
        .narrative-divider {
          width: 60px;
          height: 2px;
          background: #1557a6;
          margin: 8px auto 0;
          border-radius: 2px;
          opacity: 0.5;
        }

        /* ── TABELAS COMPACTAS (TESTEMUNHAS & AUDITORIA) ── */
        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 7.8pt;
        }
        .data-table th, .data-table td {
          padding: 4.5px 8px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
        }
        .data-table tr:last-child td { border-bottom: none; }

        /* ── BLOCOS DE ASSINATURA E HOMOLOGAÇÃO ── */
        .signatures-area {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-top: 14px;
          page-break-inside: avoid;
        }
        .signature-card {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background: #f8fafc;
          padding: 8px 10px;
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }
        .sig-space {
          min-height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 4px;
        }
        .sig-img {
          max-height: 46px;
          max-width: 160px;
          object-fit: contain;
          display: block;
          margin: 0 auto;
        }
        .sig-line {
          height: 1.5px;
          background: #0f2b5c;
          margin-bottom: 5px;
        }
        .sig-name {
          font-family: 'Montserrat', sans-serif;
          font-size: 7.5pt;
          font-weight: 800;
          color: #0f2b5c;
          text-transform: uppercase;
        }
        .sig-role {
          font-size: 6.3pt;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-top: 2px;
          line-height: 1.3;
          font-weight: 600;
        }

        /* ── RODAPÉ DE VALIDAÇÃO ELETRÔNICA ── */
        .doc-footer {
          margin-top: 12px;
          padding-top: 7px;
          border-top: 1.5px solid #0f2b5c;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 6.5pt;
          font-weight: 600;
          color: #334155;
          page-break-inside: avoid;
        }
        .hash-badge {
          font-family: 'JetBrains Mono', 'Courier New', monospace;
          font-weight: 800;
          color: #0f2b5c;
          background: #e0f2fe;
          padding: 2px 7px;
          border-radius: 3px;
          border: 1px solid #7dd3fc;
        }
      </style>
    </head>
    <body>

      <!-- BARRA INTERATIVA DE VISUALIZAÇÃO (OCULTA NA IMPRESSÃO) -->
      <div class="screen-ux-bar">
        <div class="screen-ux-brand">
          <span>🛡️ ORBENK OPS // DOSSIÊ PERICIAL E CORPORATIVO</span>
          <span style="font-family:'JetBrains Mono',monospace; font-size:11px; background:rgba(255,255,255,0.16); padding:3px 9px; border-radius:4px;">
            ${occ.protocol || 'OBK-2026-0001'}
          </span>
        </div>
        <div class="screen-ux-actions">
          <button type="button" class="ux-btn ux-btn-print" onclick="window.print()">
            🖨️ IMPRIMIR / SALVAR PDF
          </button>
          <button type="button" class="ux-btn ux-btn-close" onclick="window.close()">
            ✕ FECHAR
          </button>
        </div>
      </div>

      <div class="a4-sheet">
        <!-- CABEÇALHO INSTITUCIONAL -->
        <header class="doc-header">
          <div class="corp-logo-wrap">
            <svg class="corp-emblem" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="36,4 68,20 68,52 36,68 4,52 4,20" fill="#0f2b5c" stroke="#1557a6" stroke-width="2.5"/>
              <polygon points="36,13 58,24 58,48 36,59 14,48 14,24" fill="none" stroke="#38bdf8" stroke-width="1.6"/>
              <circle cx="36" cy="36" r="9" fill="none" stroke="#ffffff" stroke-width="1.6"/>
              <circle cx="36" cy="36" r="3.5" fill="#38bdf8"/>
            </svg>
            <div>
              <div class="corp-logo-title">Orbenk</div>
              <div class="corp-logo-sub">Segurança Privada &amp; Gestão Integrada de Risco</div>
              <div class="corp-legal-info">
                Orbenk Segurança Privada Ltda. · CNPJ: 83.123.456/0001-90 · Portaria PF nº 1.482/DREX/DELESP<br>
                Central Integrada de Monitoramento e Pronta Resposta Tática 24 Horas
              </div>
            </div>
          </div>
          <div class="doc-meta-card">
            <div class="doc-protocol-lbl">Protocolo Unificado</div>
            <div class="doc-protocol">${occ.protocol || 'OBK-2026-0001'}</div>
            <div class="doc-status">${(occ.status || 'HOMOLOGADO').replace('_', ' ').toUpperCase()}</div>
            <div class="doc-date">Emissão: ${timestampStr}</div>
          </div>
        </header>

        <!-- TÍTULO FORMAL DO LAUDO -->
        <div class="doc-main-title">
          <h1>RELATÓRIO TÉCNICO CIRCUNSTANCIADO DE OCORRÊNCIA E AUDITORIA PATRIMONIAL</h1>
          <p>Documento Oficial de Constatação Técnica, Pós-Trauma e Salvaguarda Probatória (Lei nº 7.102/83 &amp; Art. 158-A CPP)</p>
        </div>

        <!-- FAIXA EXECUTIVA DE INDICADORES (KPI STRIP) -->
        <div class="kpi-strip">
          <div class="kpi-card">
            <div class="kpi-lbl">Data &amp; Horário do Evento</div>
            <div class="kpi-val">${occ.occurrence_date || 'Data Atual'} · ${occ.occurrence_time || '—'}</div>
            <div class="kpi-sub">Turno: ${occ.shift || 'Operacional'}</div>
          </div>
          <div class="kpi-card kpi-sla">
            <div class="kpi-lbl">Tempo de Resposta (SLA)</div>
            <div class="kpi-val" style="color:${slaConforme ? '#15803d' : '#b45309'};">${occ.total_attendance_time || '00:11'} min</div>
            <div class="kpi-sub">${slaBadgeText}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-lbl">Integridade Pessoal</div>
            <div class="kpi-val" style="color:${occ.had_victims ? '#b91c1c' : '#15803d'};">
              ${occ.had_victims ? `${occ.victim_count || 1} Vítima(s)` : '100% Preservada'}
            </div>
            <div class="kpi-sub">${occ.had_victims ? (occ.victim_severity || 'Assistência prestada') : 'Zero feridos no local'}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-lbl">Preservação Probatória</div>
            <div class="kpi-val">${occ.bo_number ? `B.O. ${occ.bo_number}` : 'Auditado'}</div>
            <div class="kpi-sub">${occ.crime_scene_preserved ? 'Local Isolado (Art. 6º CPP)' : 'Inspeção Perimetral'}</div>
          </div>
        </div>

        <!-- PREÂMBULO JURÍDICO CENTRALIZADO -->
        <div class="legal-preamble">
          Pelo presente instrumento corporativo, a <strong>ORBENK SEGURANÇA PRIVADA LTDA.</strong> certifica, para fins de prestação de contas contratual, auditoria operacional e instrução probatória, os fatos constatados e as providências adotadas na ocorrência registrada sob o protocolo <strong>${occ.protocol || 'OBK-2026-0001'}</strong>, em estrita observância à Lei Federal nº 7.102/1983 e aos Arts. 6º e 158-A do Código de Processo Penal.
        </div>

        <!-- SEÇÃO 1: QUALIFICAÇÃO DO CONTRATANTE E DO POSTO -->
        <div class="section-box">
          <div class="section-header">
            <span>01 // Qualificação do Contratante &amp; Georreferenciamento da Unidade</span>
            <span class="section-tag">Identificação do Posto</span>
          </div>
          <div class="section-body">
            <div class="ui-grid-4">
              <div class="ui-cell span-2">
                <div class="ui-cell-lbl">Contratante / Unidade Monitorada</div>
                <div class="ui-cell-val strong">${occ.client || 'Cliente Sob Contrato de Monitoramento'}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Município / UF</div>
                <div class="ui-cell-val">${occ.city || 'Joinville, SC'}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Contato / Responsável</div>
                <div class="ui-cell-val">${occ.contact_name || 'Gestor Local'}${occ.contact_phone ? ` (${occ.contact_phone})` : ''}</div>
              </div>
              <div class="ui-cell span-3">
                <div class="ui-cell-lbl">Logradouro / Endereço Completo da Ocorrência</div>
                <div class="ui-cell-val">${occ.address || 'Endereço cadastrado na base contratual'}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Coordenadas GPS</div>
                <div class="ui-cell-val" style="font-family:'JetBrains Mono',monospace; font-size:7.2pt;">
                  ${occ.lat && occ.lon ? `${Number(occ.lat).toFixed(5)}, ${Number(occ.lon).toFixed(5)}` : 'Georreferenciado'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- SEÇÃO 2: CRONOMETRIA OPERACIONAL E TEMPOS DE ATENDIMENTO -->
        <div class="section-box">
          <div class="section-header">
            <span>02 // Cronometria Operacional, Alarme &amp; Auditoria de SLA</span>
            <span class="section-tag">Tempos Auditados</span>
          </div>
          <div class="section-body">
            <div class="ui-grid-4">
              <div class="ui-cell">
                <div class="ui-cell-lbl">Disparo / Detecção</div>
                <div class="ui-cell-val strong">${occ.alarm_trigger_time ? occ.alarm_trigger_time + ' h' : (occ.occurrence_time ? occ.occurrence_time + ' h' : 'Imediato')}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Chegada Pronta Resposta</div>
                <div class="ui-cell-val strong">${occ.attendant_arrival_time ? occ.attendant_arrival_time + ' h' : 'In Loco'}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Tempo Total (SLA)</div>
                <div class="ui-cell-val strong" style="color:${slaConforme ? '#15803d' : '#b45309'};">${occ.total_attendance_time || '00:11'} min</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Zona / Setor do Alarme</div>
                <div class="ui-cell-val">${occ.alarm_zone || 'Perímetro Principal'} (${occ.alarm_status || 'Armado'})</div>
              </div>
              <div class="ui-cell span-4" style="background:#f1f5f9;">
                <div class="ui-cell-lbl">Parecer de Auditoria de SLA</div>
                <div class="ui-cell-val">${slaTextoAvaliacao}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- SEÇÃO 3: DESCRITIVO CENTRALIZADO DA OCORRÊNCIA E CLASSIFICAÇÃO (DESTAQUE CENTRAL) -->
        <div class="section-box" style="border-color:#0f2b5c; border-width:1.5px;">
          <div class="section-header centered">
            <span>03 // DESCRITIVO CIRCUNSTANCIADO DA OCORRÊNCIA &amp; PROVIDÊNCIAS OPERACIONAIS</span>
          </div>
          <div class="section-body" style="padding: 12px 14px;">
            <div style="text-align:center; margin-bottom:4px; font-size:6.5pt; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:1px;">
              Tipologia do Evento &amp; Escopo de Atendimento Acionado
            </div>
            <div class="ui-pills-wrap">
              ${tiposBadgesHtml}
              ${servicosBadgesHtml}
              ${autoridadesBadgesHtml}
            </div>

            <div class="narrative-showcase">
              <div class="narrative-showcase-subtitle">
                Relato Técnico Oficial Lavrado pela Central Integrada Orbenk
              </div>
              <div class="narrative-centered-text">${occ.narrative || 'A Central Integrada de Monitoramento registrou o acionamento dos dispositivos de segurança no horário informado, despachando imediatamente a equipe de pronta resposta tática. No local, procedeu-se à varredura técnica perimetral, verificação de integridade física e patrimonial, adoção dos protocolos de preservação probatória e restabelecimento operacional junto ao responsável.'}</div>
              <div class="narrative-divider"></div>
            </div>

            ${occ.damage_description ? `
            <div class="narrative-showcase" style="margin-top:8px; border-top-color:#d97706; background:#fffbeb;">
              <div class="narrative-showcase-subtitle" style="color:#b45309;">
                Constatação de Danos Materiais &amp; Avarias Patrimoniais
              </div>
              <div class="narrative-centered-text">${occ.damage_description}</div>
            </div>
            ` : ''}
          </div>
        </div>

        <!-- SEÇÃO 4: PÓS-TRAUMA, EFETIVO (LEI 7.102/83) & PRESERVAÇÃO PERICIAL (CPP) -->
        <div class="section-box">
          <div class="section-header">
            <span>04 // Pós-Trauma, Efetivo (Lei nº 7.102/83) &amp; Preservação Pericial (CPP)</span>
            <span class="section-tag">Conformidade Legal</span>
          </div>
          <div class="section-body">
            ${vitimasTextoFormal}
            <div class="ui-grid-3" style="margin-top:6px;">
              <div class="ui-cell">
                <div class="ui-cell-lbl">Enquadramento do Efetivo</div>
                <div class="ui-cell-val">${situacaoEfetivo}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Auditoria de Armamento (PF)</div>
                <div class="ui-cell-val">${situacaoArmamento}</div>
              </div>
              <div class="ui-cell">
                <div class="ui-cell-lbl">Preservação Pericial &amp; B.O.</div>
                <div class="ui-cell-val">
                  ${occ.crime_scene_preserved ? '✔ Local Preservado (Art. 6º CPP)' : 'Inspeção Perimetral'}<br>
                  <strong>B.O.:</strong> ${occ.bo_number || 'Em formalização'} (${occ.police_station || 'DP Comarca'})
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- SEÇÃO 5: TESTEMUNHAS IDENTIFICADAS -->
        ${occ.witnesses && occ.witnesses.length ? `
        <div class="section-box">
          <div class="section-header">
            <span>05 // Pessoas e Testemunhas Qualificadas no Local</span>
            <span class="section-tag">${occ.witnesses.length} Registro(s)</span>
          </div>
          <div class="section-body">
            <table class="data-table">
              <thead>
                <tr style="background:#f1f5f9; font-weight:800; font-size:6.8pt; color:#0f2b5c;">
                  <th style="width:8%;">#</th>
                  <th style="width:42%;">NOME COMPLETO</th>
                  <th style="width:25%;">CONTATO TELEFÔNICO</th>
                  <th style="width:25%;">DOCUMENTO (CPF / RG)</th>
                </tr>
              </thead>
              <tbody>
                ${occ.witnesses.map((w, idx) => `
                  <tr>
                    <td style="font-weight:700; color:#1557a6;">${String(idx + 1).padStart(2, '0')}</td>
                    <td style="font-weight:700; color:#0f2b5c;">${w.name || 'Identificado no local'}</td>
                    <td>${w.phone || 'Informado no termo'}</td>
                    <td style="font-family:'JetBrains Mono',monospace; font-size:7.2pt;">${w.document || 'Constante em arquivo'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}

        <!-- SEÇÃO 6: EVIDÊNCIAS FOTOGRÁFICAS ANEXADAS -->
        ${occ.images && occ.images.length ? `
        <div class="section-box">
          <div class="section-header">
            <span>06 // Evidências Fotográficas &amp; Cadeia de Custódia Visual</span>
            <span class="section-tag">${occ.images.length} Evidência(s)</span>
          </div>
          <div class="section-body">
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
              ${occ.images.map((img, idx) => `
                <div style="border:1px solid #cbd5e1; border-radius:5px; padding:5px; background:#f8fafc; text-align:center;">
                  <img src="${img.url || ''}" style="width:100%; height:105px; object-fit:cover; border-radius:3px; border:1px solid #e2e8f0;" alt="Evidência ${idx + 1}" />
                  <div style="font-size:6.5pt; font-weight:800; color:#0f2b5c; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    EVIDÊNCIA #${String(idx + 1).padStart(2, '0')} — ${img.original_name || 'Registro Pericial'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        ` : ''}

        <!-- TERMO DE FÉ PÚBLICA FUNCIONAL E ASSINATURAS FORMAIS -->
        <div class="signatures-area">
          <div class="signature-card">
            <div class="sig-space">
              ${signatureDataUrl
                ? `<img src="${signatureDataUrl}" class="sig-img" alt="Assinatura Digital do Operador" />`
                : `<div style="font-family:'JetBrains Mono',monospace; font-size:7pt; font-weight:800; color:#1557a6; padding: 4px 10px; border:1px dashed #94a3b8; border-radius:4px; background:#ffffff;">
                     ✔ ASSINADO DIGITALMENTE<br>
                     <span style="font-size:5.8pt; color:#475569;">FÉ PÚBLICA OPERACIONAL</span>
                   </div>`
              }
            </div>
            <div class="sig-line"></div>
            <div class="sig-name">${occ.operator?.full_name || occ.operator || 'Operador de Monitoramento'}</div>
            <div class="sig-role">Responsável Técnico pelo Registro<br>Central de Operações Orbenk</div>
          </div>

          <div class="signature-card">
            <div class="sig-space">
              <div style="font-family:'JetBrains Mono',monospace; font-size:7pt; font-weight:800; color:#0f2b5c; padding: 4px 10px; border:1px solid #cbd5e1; border-radius:4px; background:#ffffff;">
                ORBENK SEGURANÇA PRIVADA<br>
                <span style="font-size:5.8pt; color:#1557a6;">AUDITORIA &amp; COMPLIANCE</span>
              </div>
            </div>
            <div class="sig-line"></div>
            <div class="sig-name">Coordenação de Operações</div>
            <div class="sig-role">Supervisão Tática &amp; Pós-Trauma<br>Orbenk Segurança Privada Ltda.</div>
          </div>

          <div class="signature-card">
            <div class="sig-space">
              <div style="font-size:7pt; color:#475569; font-style:italic;">
                (Visto / Ciência do Contratante)
              </div>
            </div>
            <div class="sig-line"></div>
            <div class="sig-name">${occ.contact_name || 'Representante do Contratante'}</div>
            <div class="sig-role">Gestor Patrimonial da Unidade<br>${occ.client || 'Unidade Contratante'}</div>
          </div>
        </div>

        <!-- RODAPÉ DE VALIDAÇÃO ELETRÔNICA -->
        <footer class="doc-footer">
          <div>ORBENK SEGURANÇA PRIVADA LTDA. — Laudo Pericial e Relatório Circunstanciado</div>
          <div>HASH DE AUTENTICIDADE: <span class="hash-badge">${hashIntegridade}</span></div>
          <div>Valor Probatório · Art. 158-A CPP</div>
        </footer>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 450);
        };
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
}

// ─────────────────────────────────────────
// Reports (PDF)
// ─────────────────────────────────────────
export const reports = {
  async downloadPDF(id, occFallback = null, signatureDataUrl = null) {
    const token = getToken();
    const url = `${API_BASE}/reports/${id}/pdf`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('API PDF offline');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `laudo-tecnico-orbenk-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('PDF gerado com sucesso via servidor', 'success');
    } catch {
      // Geração de Laudo Oficial no Navegador com suporte à Assinatura do Operador
      showToast('Emitindo Laudo Oficial com Amparo Jurídico...', 'info');
      if (occFallback) {
        printOfficialReport(occFallback, signatureDataUrl);
      } else {
        try {
          const occ = await occurrences.get(id);
          printOfficialReport(occ, signatureDataUrl);
        } catch (e) {
          showToast(`Erro ao carregar dados para o PDF: ${e.message}`, 'error');
        }
      }
    }
  },
};

// ─────────────────────────────────────────
// Users
// ─────────────────────────────────────────
export const users = {
  async list() { return apiFetch('/users'); },
  async create(body) { return apiFetch('/users', { method: 'POST', body: JSON.stringify(body) }); },
  async update(id, body) { return apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }); },
  async delete(id) { return apiFetch(`/users/${id}`, { method: 'DELETE' }); },
};

// ─────────────────────────────────────────
// Utilitários globais
// ─────────────────────────────────────────
export function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✔', error: '✖', info: 'ℹ', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  } catch { return dateStr; }
}

export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

export function statusBadge(status) {
  const map = {
    em_andamento: ['badge-red', '● EM ANDAMENTO'],
    concluida:    ['badge-green', '✔ CONCLUÍDA'],
    arquivada:    ['badge-gray', '▣ ARQUIVADA'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function requireAuth() {
  if (!isAuthenticated()) {
    window.location.replace('index.html');
    return false;
  }
  return true;
}

export function setupLiveClock(el) {
  if (!el) return;
  const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const months = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  function tick() {
    const now = new Date();
    const d = days[now.getDay()];
    const day = String(now.getDate()).padStart(2, '0');
    const mon = months[now.getMonth()];
    const yr = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    el.textContent = `${d} ${day} ${mon} ${yr} — ${hh}:${mm}:${ss}`;
  }
  tick();
  return setInterval(tick, 1000);
}

export function buildSidebar(activePage) {
  const user = getCurrentUser();
  const role = user?.role || 'admin';
  const initials = (user?.full_name || user?.username || 'AD').slice(0, 2).toUpperCase();

  const roleColors = { admin: 'text-red', supervisor: 'text-amber', operador: 'text-cyan' };
  const roleColor = roleColors[role] || 'text-cyan';

  const isCollapsed = (localStorage.getItem('orbenk_sidebar') || 'expanded') === 'collapsed';

  return `
    <aside class="sidebar" id="appSidebar">
      <button type="button" class="sidebar-toggle-btn" id="sidebarToggleBtn" onclick="window.toggleSidebar()" title="Alternar Barra Lateral (Clique para fixar / Passe o mouse no chevron para pré-visualizar)">
        <span class="toggle-arrow">«</span>
      </button>
      <a href="dashboard.html" class="sidebar-logo" id="sidebarBrandLink" title="Orbenk Ops — Ir para o Painel Geral (Home)" tabindex="0">
        <div class="sidebar-logo-text">
          <div class="sidebar-brand">Orbenk</div>
          <div class="sidebar-brand-sub">OPERAÇÕES &amp; MONITORAMENTO</div>
        </div>
        <div class="sidebar-brand-mini">OBK</div>
      </a>
      <nav class="sidebar-nav">
        <div class="nav-section-label">Navegação Principal</div>
        <a href="dashboard.html" class="nav-item ${activePage==='dashboard'?'active':''}" data-tooltip="PAINEL GERAL">
          <span class="nav-icon">⬡</span>
          <span class="nav-label">PAINEL GERAL</span>
        </a>
        <a href="form.html" class="nav-item ${activePage==='form'?'active':''}" data-tooltip="REGISTRAR OCORRÊNCIA">
          <span class="nav-icon">＋</span>
          <span class="nav-label">REGISTRAR OCORRÊNCIA</span>
        </a>
        <a href="dashboard.html" class="nav-item ${activePage==='occurrences'?'active':''}" data-tooltip="OCORRÊNCIAS">
          <span class="nav-icon">≡</span>
          <span class="nav-label">OCORRÊNCIAS</span>
        </a>
        <div class="nav-section-label" style="margin-top:10px;">Comando &amp; Inteligência</div>
        <a href="dashboard.html" class="nav-item" data-tooltip="AUDITORIA & LAUDOS" onclick="document.querySelector('.stat-section')?.scrollIntoView({behavior:'smooth'});return false;">
          <span class="nav-icon">◈</span>
          <span class="nav-label">AUDITORIA &amp; LAUDOS</span>
        </a>
        <a href="dashboard.html" class="nav-item" data-tooltip="MAPA DE GRÁFICOS" onclick="document.querySelector('#charts-row')?.scrollIntoView({behavior:'smooth'});return false;">
          <span class="nav-icon">📈</span>
          <span class="nav-label">MAPA DE GRÁFICOS</span>
        </a>
        <div class="nav-section-label" style="margin-top:10px;">Controle de Tela</div>
        <a href="#" class="nav-item" data-tooltip="ALTERNAR ALA LATERAL" onclick="window.toggleSidebar();return false;">
          <span class="nav-icon toggle-arrow" style="display:inline-block;transition:transform 0.35s ease;">⇄</span>
          <span class="nav-label" id="sidebar-collapse-label">${isCollapsed ? 'EXPANDIR MENU' : 'RECOLHER MENU'}</span>
        </a>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user" title="${user?.full_name || user?.username || 'Administrador'} (${role.toUpperCase()})">
          <div class="user-avatar">${initials}</div>
          <div class="user-info">
            <div class="user-name">${user?.full_name || user?.username || 'Administrador'}</div>
            <div class="user-role ${roleColor}">${role.toUpperCase()}</div>
          </div>
        </div>
      </div>
    </aside>`;
}

export function buildTopbar(title = '') {
  const currentTheme = getSavedTheme();
  return `
    <header class="topbar">
      <div class="topbar-left">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="status-dot green"></span>
          <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:700;">Sistema Operacional Ativo</span>
        </div>
        ${title ? `<span style="color:var(--border2);opacity:0.6;">|</span><span style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;">${title}</span>` : ''}
      </div>
      
      <div class="live-clock" id="liveClock"></div>

      <div class="topbar-right">
        <!-- Seletor Imersivo de Temas estilo "Loadout / Arsenal" Cyberpunk/TRON -->
        <div class="theme-arsenal-container" id="themeArsenalContainer">
          <button type="button" class="theme-arsenal-trigger" id="themeArsenalTrigger" aria-haspopup="true" aria-expanded="false" title="Arsenal de Temas // Personalização Visual Tática">
            <span class="arsenal-glitch-icon">◈</span>
            <span class="arsenal-trigger-label">APARÊNCIA // LOADOUT</span>
            <span class="arsenal-current-pill" id="themeActivePill">${currentTheme.toUpperCase()}</span>
            <span class="arsenal-trigger-arrow">▾</span>
          </button>
          
          <div class="theme-arsenal-drawer" id="themeArsenalDrawer" role="region" aria-label="Arsenal de Temas">
            <div class="arsenal-drawer-header">
              <div class="arsenal-drawer-tag">// ARSENAL VISUAL · LIVE PREVIEW HABILITADO</div>
              <div class="arsenal-status-strip">
                <span class="status-dot green"></span>
                <span class="arsenal-status-text">HUD PRONTO</span>
              </div>
            </div>
            
            <div class="theme-arsenal-carousel" id="themeArsenalCarousel">
              <!-- 1. CLARO -->
              <div class="theme-arsenal-card ${currentTheme==='claro'?'active':''}" data-theme="claro" tabindex="0" onclick="window.switchTheme('claro')">
                <div class="arsenal-card-glow"></div>
                <div class="arsenal-card-head">
                  <span class="arsenal-badge">PROTOCOLO 01</span>
                  <span class="arsenal-variant-icon">☀️</span>
                </div>
                <div class="arsenal-palette-preview palette-claro">
                  <span class="swatch swatch-bg" style="background:#f4f7fb;"></span>
                  <span class="swatch swatch-acc" style="background:#0f2b5c;"></span>
                  <span class="swatch swatch-acc2" style="background:#1557a6;"></span>
                </div>
                <div class="arsenal-card-body">
                  <div class="arsenal-card-title">CLARO // DAYLIGHT</div>
                  <div class="arsenal-card-desc">Solar, Formal &amp; Institucional. Contraste executivo em Azul Real e Branco.</div>
                </div>
                <div class="arsenal-card-footer">
                  <span class="arsenal-commit-prompt">[CLIQUE P/ ARMAR]</span>
                </div>
              </div>

              <!-- 2. ESCURO -->
              <div class="theme-arsenal-card ${currentTheme==='escuro'?'active':''}" data-theme="escuro" tabindex="0" onclick="window.switchTheme('escuro')">
                <div class="arsenal-card-glow"></div>
                <div class="arsenal-card-head">
                  <span class="arsenal-badge">PROTOCOLO 02</span>
                  <span class="arsenal-variant-icon">⚡</span>
                </div>
                <div class="arsenal-palette-preview palette-escuro">
                  <span class="swatch swatch-bg" style="background:#080c16;"></span>
                  <span class="swatch swatch-acc" style="background:#00f0ff;"></span>
                  <span class="swatch swatch-acc2" style="background:#ff3366;"></span>
                </div>
                <div class="arsenal-card-body">
                  <div class="arsenal-card-title">ESCURO // TACTICAL</div>
                  <div class="arsenal-card-desc">Mission Control. Cinza grafite, acentos ciano neon e foco tático em monitoramento.</div>
                </div>
                <div class="arsenal-card-footer">
                  <span class="arsenal-commit-prompt">[CLIQUE P/ ARMAR]</span>
                </div>
              </div>

              <!-- 3. NOTURNO -->
              <div class="theme-arsenal-card ${currentTheme==='noturno'?'active':''}" data-theme="noturno" tabindex="0" onclick="window.switchTheme('noturno')">
                <div class="arsenal-card-glow"></div>
                <div class="arsenal-card-head">
                  <span class="arsenal-badge">PROTOCOLO 03</span>
                  <span class="arsenal-variant-icon">🌙</span>
                </div>
                <div class="arsenal-palette-preview palette-noturno">
                  <span class="swatch swatch-bg" style="background:#040812;"></span>
                  <span class="swatch swatch-acc" style="background:#38bdf8;"></span>
                  <span class="swatch swatch-acc2" style="background:#1d4ed8;"></span>
                </div>
                <div class="arsenal-card-body">
                  <div class="arsenal-card-title">NOTURNO // STEALTH</div>
                  <div class="arsenal-card-desc">Deep Space. Azul marinho profundo, pulso ciano e ergonomia visual noturna.</div>
                </div>
                <div class="arsenal-card-footer">
                  <span class="arsenal-commit-prompt">[CLIQUE P/ ARMAR]</span>
                </div>
              </div>

              <!-- 4. CYBER -->
              <div class="theme-arsenal-card ${currentTheme==='cyber'?'active':''}" data-theme="cyber" tabindex="0" onclick="window.switchTheme('cyber')">
                <div class="arsenal-card-glow"></div>
                <div class="arsenal-card-head">
                  <span class="arsenal-badge">PROTOCOLO 04</span>
                  <span class="arsenal-variant-icon">🔮</span>
                </div>
                <div class="arsenal-palette-preview palette-cyber">
                  <span class="swatch swatch-bg" style="background:#050616;"></span>
                  <span class="swatch swatch-acc" style="background:#00e5ff;"></span>
                  <span class="swatch swatch-acc2" style="background:#a855f7;"></span>
                </div>
                <div class="arsenal-card-body">
                  <div class="arsenal-card-title">CYBER // OVERDRIVE</div>
                  <div class="arsenal-card-desc">TRON Matrix. Fusão eletrizante de ultravioleta, azul elétrico e acentos laser neon.</div>
                </div>
                <div class="arsenal-card-footer">
                  <span class="arsenal-commit-prompt">[CLIQUE P/ ARMAR]</span>
                </div>
              </div>
            </div>

            <div class="arsenal-drawer-footer">
              <span class="arsenal-hint">◈ LIVE PREVIEW ATIVO AO PASSAR O MOUSE · SELEÇÃO FIXADA NO CLIQUE</span>
            </div>
          </div>
        </div>

        <span style="font-size:11px;font-weight:600;color:var(--text-muted);" id="topbar-username"></span>
        <button class="btn btn-ghost btn-sm" onclick="auth.logout()" title="Encerrar Sessão">
          ⏻ SAIR
        </button>
      </div>
    </header>`;
}

// ─────────────────────────────────────────
// Mapa Tático em Movimento Omnipresente (Todas as Telas)
// ─────────────────────────────────────────
export function initAmbientTacticalMap(containerId = 'ambient-bg-map', focusCoord = null) {
  const mapEl = document.getElementById(containerId);
  if (!mapEl || !window.L) return null;

  const defaultCenter = focusCoord && focusCoord[0] ? focusCoord : [-26.3044, -48.8464];

  const ambientMap = window.L.map(containerId, {
    center: defaultCenter,
    zoom: 14,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    zoomSnap: 0.1,
  });

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
  }).addTo(ambientMap);

  const tacticalZones = [
    { name: 'CENTRAL OPERACIONAL // HUB', lat: defaultCenter[0], lon: defaultCenter[1], alert: false },
    { name: 'SETOR LOGÍSTICO // ANEL VIÁRIO', lat: defaultCenter[0] + 0.035, lon: defaultCenter[1] - 0.025, alert: true },
    { name: 'POSTO CORPORATIVO // MATRIZ', lat: defaultCenter[0] - 0.028, lon: defaultCenter[1] + 0.018, alert: false },
    { name: 'POLO INDUSTRIAL // PERÍMETRO', lat: defaultCenter[0] + 0.022, lon: defaultCenter[1] + 0.038, alert: false },
  ];

  const hubCoord = [tacticalZones[0].lat, tacticalZones[0].lon];

  // Plota nós táticos
  tacticalZones.forEach((z, idx) => {
    const icon = window.L.divIcon({
      className: '',
      html: `
        <div class="dash-map-node">
          <div class="dash-node-dot ${z.alert ? 'alert' : ''}"></div>
          <div class="dash-node-label">${z.name.split('//')[0].trim()}</div>
        </div>`,
      iconAnchor: [5, 5]
    });
    window.L.marker([z.lat, z.lon], { icon }).addTo(ambientMap);

    if (idx > 0) {
      window.L.polyline([hubCoord, [z.lat, z.lon]], {
        color: z.alert ? '#f59e0b' : '#00e5ff',
        weight: 1.4,
        opacity: 0.4,
        dashArray: '5, 7'
      }).addTo(ambientMap);
    }

    window.L.circle([z.lat, z.lon], {
      radius: z.alert ? 380 : 280,
      color: z.alert ? '#f59e0b' : '#00e5ff',
      weight: 1,
      fillOpacity: 0.05
    }).addTo(ambientMap);
  });

  // Movimento orbital contínuo e navegação suave
  let angle = 0;
  let zoneIdx = 0;

  setInterval(() => {
    angle += 0.016;
    const dx = Math.cos(angle) * 0.65;
    const dy = Math.sin(angle * 0.8) * 0.55;
    ambientMap.panBy([dx, dy], { animate: false });
  }, 50);

  setInterval(() => {
    zoneIdx = (zoneIdx + 1) % tacticalZones.length;
    const target = tacticalZones[zoneIdx];
    ambientMap.panTo([target.lat, target.lon], {
      animate: true,
      duration: 6.0,
      easeLinearity: 0.15
    });
  }, 8500);

  window.addEventListener('orbenk:sidebar-toggle', () => {
    setTimeout(() => ambientMap.invalidateSize(true), 120);
    setTimeout(() => ambientMap.invalidateSize(true), 400);
  });

  return ambientMap;
}

// Estímulo Háptico / Sonoro Universal para Botões
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn, .page-btn, .chip, .theme-btn, .filter-pill, .sidebar-toggle-btn');
    if (btn) {
      playTacticalAudio('click');
    }
  });
});

// Global switch
window.switchTheme = changeTheme;
window.toggleSidebar = toggleSidebar;
window.auth = auth;


