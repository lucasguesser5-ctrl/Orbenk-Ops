/**
 * form.js — Lógica avançada do Cockpit Tático de Ocorrências (Orbenk Ops)
 * Gerencia navegação de missão, switches táteis, cálculo de SLA em tempo real,
 * assistente de narrativa e sincronização com a API.
 */
import {
  requireAuth, occurrences, geo, weather, reports, showToast,
  buildSidebar, buildTopbar, getCurrentUser, setupLiveClock, auth,
  initTheme, printOfficialReport, initAmbientTacticalMap
} from './api.js';

// ── Estado da Aplicação ──────────────────────────────────────────────
let editId = null;
let currentStage = 1;
let isAllStagesMode = false;

let mapPrincipal = null, mapSatelite = null, mapTerreno = null;
let markerPrincipal = null, markerSatelite = null, markerTerreno = null;
let lastLat = -26.3044, lastLon = -48.8464;
let geoTimeout = null;

let uploadedImages = [];   // {file, url} para modo criação
let existingImages = [];   // imagens já salvas (modo edição)
let witnessCount = 0;
const TOTAL_FIELDS_GOAL = 14;

// ── Inicialização ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  document.getElementById('sidebar-slot').innerHTML = buildSidebar('form');
  document.getElementById('topbar-slot').innerHTML = buildTopbar('Registro Tático de Ocorrência');
  initTheme();
  setupLiveClock(document.getElementById('liveClock'));

  // Inicializa Mapa Tático de Fundo em Movimento Contínuo
  initAmbientTacticalMap('ambient-bg-map');

  // Inicializa Telemetria do Clima ao Vivo
  carregarTelemetriaClima(lastLat, lastLon, 'Joinville, SC');

  const user = getCurrentUser();
  const topUserEl = document.getElementById('topbar-username');
  if (topUserEl && user) topUserEl.textContent = user.full_name || user.username;

  // Detecta modo edição
  const params = new URLSearchParams(window.location.search);
  editId = params.get('id') ? parseInt(params.get('id')) : null;

  document.getElementById('page-title').textContent = editId
    ? 'EDITAR OCORRÊNCIA TÁTICA'
    : 'REGISTRO TÁTICO DE OCORRÊNCIA';

  // Pré-preenchimento para novo registro
  if (!editId) {
    const now = new Date();
    document.getElementById('dataOcorrencia').value = now.toISOString().split('T')[0];
    document.getElementById('horaOcorrencia').value =
      String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    if (user?.full_name) document.getElementById('operador').value = user.full_name;
    if (!document.getElementById('protocolo').value) {
      const randNum = String(Math.floor(Math.random() * 900) + 100).padStart(4, '0');
      document.getElementById('protocolo').value = `OBK-2026-${randNum}`;
    }
  }

  // Inicializa mapas
  initMaps();

  // Configura Stepper e Modo de Visualização
  setupStepper();

  // Configura Switches Táticos Segmentados
  setupTacticalSwitches();

  // Configura Chips de Seleção
  setupChips();

  // Configura Autocalculador de SLA
  setupSLACalculator();

  // Se for edição, carrega dados da API
  if (editId) {
    await loadOccurrence(editId);
  }

  // Configura listeners de progresso e HUD
  document.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('input', () => { updateProgress(); updateLiveHUD(); });
    el.addEventListener('change', () => { updateProgress(); updateLiveHUD(); });
  });

  // Configura Dropzone de Imagens
  setupDropzone();

  // Configura Autocomplete de Endereço
  setupAutocomplete();

  // Configura Botões de Ação
  setupActionButtons();

  // Executa primeira atualização do HUD e Progresso
  updateProgress();
  updateLiveHUD();
});

// ── Navegador de Estágios da Missão (Tactical Stepper) ─────────────────
function setupStepper() {
  const tabs = document.querySelectorAll('.step-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const stage = parseInt(tab.dataset.stage);
      goToStage(stage);
    });
  });

  // Alternador de modo Focado / Visão Completa
  const btnFocado = document.getElementById('btn-mode-stepper');
  const btnCompleto = document.getElementById('btn-mode-all');
  const container = document.getElementById('form-layout-container');

  btnFocado?.addEventListener('click', () => {
    isAllStagesMode = false;
    btnFocado.classList.add('active');
    btnCompleto.classList.remove('active');
    container.classList.remove('show-all-stages');
    goToStage(currentStage);
  });

  btnCompleto?.addEventListener('click', () => {
    isAllStagesMode = true;
    btnCompleto.classList.add('active');
    btnFocado.classList.remove('active');
    container.classList.add('show-all-stages');
    document.querySelectorAll('.tactical-stage-pane').forEach(p => p.classList.add('active'));
    document.getElementById('current-stage-name').textContent = 'VISÃO COMPLETA (TODOS OS BLOCOS)';
    setTimeout(refreshMaps, 200);
  });
}

export function goToStage(stageNum) {
  if (isAllStagesMode) return;
  currentStage = stageNum;

  // Atualiza tabs
  document.querySelectorAll('.step-tab').forEach(tab => {
    const s = parseInt(tab.dataset.stage);
    tab.classList.toggle('active', s === stageNum);
    if (s < stageNum) tab.classList.add('completed');
  });

  // Atualiza panes
  document.querySelectorAll('.tactical-stage-pane').forEach((pane, idx) => {
    pane.classList.toggle('active', (idx + 1) === stageNum);
  });

  // Atualiza label do estágio no topo
  const names = {
    1: '01 // DESPACHO & LOCAL',
    2: '02 // TEMPOS & ALARME',
    3: '03 // TIPO DO EVENTO',
    4: '04 // PESSOAS & ARMAS',
    5: '05 // POLÍCIA & B.O.',
    6: '06 // RELATO & PROVAS'
  };
  const labelEl = document.getElementById('current-stage-name');
  if (labelEl) labelEl.textContent = names[stageNum] || '';

  // Invalida tamanho dos mapas se for o estágio 1
  if (stageNum === 1) {
    setTimeout(refreshMaps, 200);
  }

  // Rolagem suave para o topo do formulário
  window.scrollTo({ top: 120, behavior: 'smooth' });
}
window.goToStage = goToStage;

// ── Switches Táticos Segmentados ──────────────────────────────────────
function setupTacticalSwitches() {
  document.querySelectorAll('.tactical-toggle-group').forEach(group => {
    const radioName = group.dataset.radio;
    const buttons = group.querySelectorAll('.tactical-toggle-btn');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;

        // Atualiza botões do grupo
        buttons.forEach(b => {
          b.className = 'tactical-toggle-btn';
        });

        if (val === 'Sim') {
          btn.classList.add('active-sim');
        } else if (val === 'Não') {
          btn.classList.add('active-nao');
        } else {
          btn.classList.add('active-neutral');
        }

        // Sincroniza com rádio nativo oculto
        const targetRadio = document.querySelector(`input[name="${radioName}"][value="${val}"]`);
        if (targetRadio) {
          targetRadio.checked = true;
          targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }

        handleConditionals();
        updateLiveHUD();
        updateProgress();
      });
    });
  });
}

function syncSwitchUI(radioName, value) {
  const group = document.querySelector(`.tactical-toggle-group[data-radio="${radioName}"]`);
  if (!group) return;
  const buttons = group.querySelectorAll('.tactical-toggle-btn');
  buttons.forEach(btn => {
    btn.className = 'tactical-toggle-btn';
    if (btn.dataset.val === value) {
      if (value === 'Sim') btn.classList.add('active-sim');
      else if (value === 'Não') btn.classList.add('active-nao');
      else btn.classList.add('active-neutral');
    }
  });
}

// ── Chips de Seleção ──────────────────────────────────────────────────
function setupChips() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      updateProgress();
      updateLiveHUD();
    });
  });
}

// ── Calculador Inteligente de SLA ─────────────────────────────────────
function setupSLACalculator() {
  const dispEl = document.getElementById('horaDisparo');
  const chegEl = document.getElementById('horaAtendente');
  const totalEl = document.getElementById('tempoTotal');

  function calculateSLA() {
    const dVal = dispEl?.value;
    const cVal = chegEl?.value;

    if (!dVal || !cVal) return;

    const [dHora, dMin] = dVal.split(':').map(Number);
    const [cHora, cMin] = cVal.split(':').map(Number);

    let diffMin = (cHora * 60 + cMin) - (dHora * 60 + dMin);
    if (diffMin < 0) diffMin += 24 * 60; // caso vire a meia-noite

    totalEl.value = `${diffMin} min`;
    updateLiveHUD();
  }

  dispEl?.addEventListener('change', calculateSLA);
  chegEl?.addEventListener('change', calculateSLA);
}

// ── Atualização do Cockpit HUD em Tempo Real ──────────────────────────
function updateLiveHUD() {
  // Protocolo
  const proto = document.getElementById('protocolo')?.value || 'NOVO REGISTRO';
  document.getElementById('hud-protocol').textContent = proto;

  // Cliente
  const cliente = document.getElementById('cliente')?.value || '—';
  document.getElementById('hud-client-name').textContent = cliente;

  // Vítimas & Gravidade
  const temVitimas = document.querySelector('input[name="houveVitimas"]:checked')?.value === 'Sim';
  const numVitimas = parseInt(document.getElementById('numVitimas')?.value) || 0;
  const gravidade = document.getElementById('gravidadeVitima')?.value || '';
  const vitEl = document.getElementById('hud-victims-count');

  if (!temVitimas) {
    vitEl.textContent = 'NENHUMA';
    vitEl.className = 'hud-stat-val text-green';
  } else {
    vitEl.textContent = `${numVitimas} (${gravidade.includes('Óbito') ? 'ÓBITO' : 'FERIDOS'})`;
    vitEl.className = 'hud-stat-val text-red';
  }

  // Vigilante no Posto
  const temVig = document.querySelector('input[name="vigNoLocal"]:checked')?.value === 'Sim';
  const vigRendido = document.querySelector('input[name="vigRendido"]:checked')?.value === 'Sim';
  const guardStatusEl = document.getElementById('hud-guard-status');

  if (!temVig) {
    guardStatusEl.textContent = 'SEM VIGILANTE';
    guardStatusEl.className = 'hud-stat-val text-muted';
  } else if (vigRendido) {
    guardStatusEl.textContent = '⚠ RENDIDO';
    guardStatusEl.className = 'hud-stat-val text-red';
  } else {
    guardStatusEl.textContent = 'EM POSTO / OK';
    guardStatusEl.className = 'hud-stat-val text-green';
  }

  // Armamento
  const armaSubtraida = document.querySelector('input[name="weaponStolen"]:checked')?.value === 'Sim';
  const weaponStatusEl = document.getElementById('hud-weapon-status');
  if (armaSubtraida) {
    weaponStatusEl.textContent = '⚠ SUBTRAÍDA';
    weaponStatusEl.className = 'hud-stat-val text-red';
  } else {
    weaponStatusEl.textContent = 'PRESERVADO';
    weaponStatusEl.className = 'hud-stat-val text-green';
  }

  // Local de Crime Preservado
  const localPreservado = document.querySelector('input[name="crimeScenePreserved"]:checked')?.value === 'Sim';
  const crimeSceneEl = document.getElementById('hud-crime-scene');
  if (localPreservado) {
    crimeSceneEl.textContent = 'PRESERVADO';
    crimeSceneEl.className = 'hud-stat-val text-green';
  } else {
    crimeSceneEl.textContent = 'NÃO PRESERVADO';
    crimeSceneEl.className = 'hud-stat-val text-red';
  }

  // SLA de Resposta
  const tempoTotalStr = document.getElementById('tempoTotal')?.value || '';
  const match = tempoTotalStr.match(/\d+/);
  const slaStatusEl = document.getElementById('hud-sla-status');
  const slaFillEl = document.getElementById('hud-sla-fill');
  const slaTimeEl = document.getElementById('hud-sla-time');

  if (match) {
    const minutos = parseInt(match[0]);
    slaTimeEl.textContent = `${minutos} min (Meta: ≤ 12 min)`;

    const pct = Math.min(Math.round((minutos / 25) * 100), 100);
    slaFillEl.style.width = `${pct}%`;

    if (minutos <= 12) {
      slaStatusEl.textContent = 'SLA CUMPRIDO';
      slaStatusEl.style.color = 'var(--accent-green)';
      slaFillEl.style.background = 'var(--accent-green)';
    } else if (minutos <= 18) {
      slaStatusEl.textContent = 'SLA TOLERADO';
      slaStatusEl.style.color = 'var(--accent-amber)';
      slaFillEl.style.background = 'var(--accent-amber)';
    } else {
      slaStatusEl.textContent = 'SLA EXCEDIDO';
      slaStatusEl.style.color = 'var(--accent-red)';
      slaFillEl.style.background = 'var(--accent-red)';
    }
  } else {
    slaStatusEl.textContent = 'AGUARDANDO';
    slaStatusEl.style.color = 'var(--text-muted)';
    slaFillEl.style.width = '0%';
    slaTimeEl.textContent = '— (Meta: ≤ 12 min)';
  }

  // Nível de Ameaça Tática (DEFCON Matrix)
  calculateThreatLevel();
}

function calculateThreatLevel() {
  const houveObito = document.getElementById('gravidadeVitima')?.value?.includes('Óbito');
  const houveDisparos = document.querySelector('input[name="guardWeaponFired"]:checked')?.value === 'Sim';
  const armaSubtraida = document.querySelector('input[name="weaponStolen"]:checked')?.value === 'Sim';
  const vigRendido = document.querySelector('input[name="vigRendido"]:checked')?.value === 'Sim';
  const tipoSelecionado = Array.from(document.querySelectorAll('.chip.selected[data-group="tipo"]'))
    .map(c => c.dataset.value);

  const headerBadge = document.getElementById('header-threat-badge');
  const hudBadge = document.getElementById('hud-threat-badge');

  let levelText = 'NÍVEL 4 · ROTINA';
  let levelClass = 'threat-level-badge threat-normal';

  if (houveObito || houveDisparos) {
    levelText = 'NÍVEL 1 · CRÍTICO';
    levelClass = 'threat-level-badge threat-critical';
  } else if (armaSubtraida || vigRendido || tipoSelecionado.some(t => t.includes('Roubo') || t.includes('Rendição'))) {
    levelText = 'NÍVEL 2 · ELEVADO';
    levelClass = 'threat-level-badge threat-critical';
  } else if (tipoSelecionado.some(t => t.includes('Tentativa') || t.includes('Arrombamento') || t.includes('Furto'))) {
    levelText = 'NÍVEL 3 · ATENÇÃO';
    levelClass = 'threat-level-badge threat-elevated';
  }

  [headerBadge, hudBadge].forEach(b => {
    if (b) {
      b.textContent = levelText;
      b.className = levelClass;
    }
  });
}

// ── Assistente de Narrativa com Modelos Táticos ───────────────────────
export function applyNarrativeTemplate(templateType) {
  const relatoEl = document.getElementById('relato');
  if (!relatoEl) return;

  const cliente = document.getElementById('cliente')?.value || '[CLIENTE]';
  const zona = document.getElementById('zonaDisparada')?.value || '[ZONA/SETOR]';
  const horaDisp = document.getElementById('horaDisparo')?.value || '[HORA DISPARO]';
  const horaAtend = document.getElementById('horaAtendente')?.value || '[HORA CHEGADA]';
  const tempoResp = document.getElementById('tempoTotal')?.value || '[TEMPO TOTAL]';
  const operador = document.getElementById('operador')?.value || '[OPERADOR]';
  const bo = document.getElementById('numeroBO')?.value || '[B.O.]';

  const templates = {
    alarme_falso:
`Às ${horaDisp}, a Central de Operações da Orbenk identificou o disparo do sistema de alarme na ${zona} do cliente ${cliente}.
O operador de serviço (${operador}) realizou o despacho imediato da equipe tática móvel.
A viatura de resposta operacional chegou ao local às ${horaAtend} (tempo de resposta: ${tempoResp}, em estrita conformidade com o SLA Orbenk).
Foi procedida a verificação perimetral minuciosa em todos os acessos, portas e janelas.
Constatou-se ausência de qualquer sinal de arrombamento, intrusão ou tentativa de dano ao patrimônio, caracterizando disparo técnico sem violação.
O contato no local foi orientado e o sistema de alarme foi devidamente rearmado e testado.`,

    intrusao_repelida:
`Por volta de ${horaDisp}, a Central de Monitoramento Orbenk acusou violação na ${zona} em ${cliente}.
A equipe de resposta tática aproximou-se do posto às ${horaAtend}, constatando aproximação suspeita na cerca perimetral.
Com a chegada da viatura tática com giroflex ativo, os suspeitos empreenderam fuga em direção ignorada.
Realizada vistoria rigorosa no local com acompanhamento de apoio tático.
Houve danos parciais em [DESCREVER GRADE/CERCA/PORTA], sem que houvesse invasão consumada ao interior do estabelecimento ou subtração de pertences.
O perímetro foi isolado temporariamente até a chegada da equipe de manutenção e do responsável da empresa.`,

    assalto_rendicao:
`Por volta de ${horaDisp}, indivíduos armados invadiram as dependências de ${cliente}.
Os agressores renderam o efetivo no local e anunciaram o assalto, permanecendo no interior por período aproximado de [X] minutos.
Assim que cessada a ação delituosa, a Central Orbenk foi alertada e imediatamente despachou suporte tático e comunicou o COPOM (190).
Ao chegar às ${horaAtend}, a equipe Orbenk prestou o acolhimento emergencial pós-trauma às vítimas e garantiu a preservação do local dos fatos.
Foram subtraídos: [DESCRIMINAR BENS].
A Polícia Militar compareceu no local (B.O. nº ${bo}), procedendo com o registro e buscas preliminares na região.`,

    confronto_armado:
`Às ${horaDisp}, foi registrada ocorrência de gravidade máxima em ${cliente}, com confronto armado e disparos de arma de fogo no posto.
O efetivo de vigilância atuou em defesa legítima do patrimônio sob guarda e da integridade física das pessoas presentes, conforme preceitua a Lei Federal nº 7.102/1983.
O socorro médico de urgência (SAMU / Corpo de Bombeiros) e a Polícia Militar foram acionados em código de emergência prioritária.
O local do crime foi prontamente isolado com preservação rigorosa de todos os vestígios balísticos e materiais, em estrito cumprimento ao Art. 6º, I do Código de Processo Penal e Arts. 158-A a 158-F (Cadeia de Custódia Probatória).
Aguardada no local a chegada da Autoridade Policial e da Perícia Oficial da Polícia Científica.`
  };

  const selectedText = templates[templateType];
  if (!selectedText) return;

  if (relatoEl.value.trim().length > 0) {
    if (confirm('Deseja substituir o relato atual pelo modelo tático padronizado?')) {
      relatoEl.value = selectedText;
    }
  } else {
    relatoEl.value = selectedText;
  }

  showToast('Modelo tático inserido com sucesso!', 'info');
  updateProgress();
  updateLiveHUD();
}
window.applyNarrativeTemplate = applyNarrativeTemplate;

// ── Condicionais Dinâmicas ───────────────────────────────────────────
function handleConditionals() {
  const radioVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '';

  const vigLocal = radioVal('vigNoLocal') === 'Sim';
  document.querySelectorAll('.cond-vig').forEach(el => el.classList.toggle('hidden', !vigLocal));

  const vitimas = radioVal('houveVitimas') === 'Sim';
  document.querySelectorAll('.cond-vitimas').forEach(el => el.classList.toggle('hidden', !vitimas));

  const disparo = radioVal('disparo') === 'Sim';
  document.querySelectorAll('.cond-disparo').forEach(el => el.classList.toggle('hidden', !disparo));

  const armaSubtraida = radioVal('weaponStolen') === 'Sim';
  document.querySelectorAll('.cond-arma-subtraida').forEach(el => el.classList.toggle('hidden', !armaSubtraida));
}

// ── Barra de Progresso & Indicadores de Fase ─────────────────────────
function updateProgress() {
  const filled = new Set();
  if (document.getElementById('protocolo')?.value) filled.add('protocolo');
  if (document.getElementById('operador')?.value) filled.add('operador');
  if (document.getElementById('cliente')?.value?.trim()) filled.add('cliente');
  if (document.getElementById('endereco')?.value?.trim()) filled.add('endereco');
  if (document.getElementById('dataOcorrencia')?.value) filled.add('data');
  if (document.querySelector('.chip.selected[data-group="servico"]')) filled.add('servicos');
  if (document.querySelector('.chip.selected[data-group="tipo"]')) filled.add('tipos');
  if (document.querySelector('input[name="disparo"]:checked')) filled.add('disparo');
  if (document.querySelector('input[name="houveVitimas"]:checked')) filled.add('vitimas');
  if (document.querySelector('input[name="vigNoLocal"]:checked')) filled.add('vigilante');
  if (document.querySelector('input[name="sistemaAlarme"]:checked')) filled.add('alarme');
  if (document.querySelector('.chip.selected[data-group="autoridade"]')) filled.add('autoridades');
  if (document.getElementById('relato')?.value.trim()) filled.add('relato');

  const pct = Math.min(100, Math.round((filled.size / TOTAL_FIELDS_GOAL) * 100));
  const bar = document.getElementById('progress-fill');
  const pctEl = document.getElementById('progress-pct');
  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;

  // Marca visualmente cada estágio concluído no Stepper
  const stageDone = {
    1: filled.has('cliente') && filled.has('endereco'),
    2: filled.has('data') && filled.has('disparo'),
    3: filled.has('tipos'),
    4: filled.has('vitimas') && filled.has('vigilante'),
    5: filled.has('alarme'),
    6: filled.has('relato'),
  };
  document.querySelectorAll('.step-tab').forEach(tab => {
    const st = parseInt(tab.dataset.stage, 10);
    tab.classList.toggle('completed', !!stageDone[st]);
  });
}

// ── Mapas Leaflet Multi-Escala ───────────────────────────────────────
function initMaps() {
  const coord = [lastLat, lastLon];
  const osm = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const osmSat = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const osmTopo = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';

  const redIcon = L.divIcon({
    html: `<div style="
      width:14px;height:14px;
      background:#ff3b3b;
      border:2px solid white;
      border-radius:50%;
      box-shadow:0 0 10px rgba(255,59,59,0.9);
    "></div>`,
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  mapPrincipal = L.map('mapaPrincipal', { zoomControl: true }).setView(coord, 15);
  L.tileLayer(osm, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapPrincipal);
  markerPrincipal = L.marker(coord, { icon: redIcon, draggable: true }).addTo(mapPrincipal);

  // Permite clicar no mapa ou arrastar o pino para ajustar coordenadas manualmente
  mapPrincipal.on('click', e => {
    atualizarMapas(e.latlng.lat, e.latlng.lng);
  });
  markerPrincipal.on('dragend', e => {
    const pos = e.target.getLatLng();
    atualizarMapas(pos.lat, pos.lng);
  });

  mapSatelite = L.map('mapaSatelite', { zoomControl: false, attributionControl: false }).setView(coord, 16);
  L.tileLayer(osmSat, { maxZoom: 19 }).addTo(mapSatelite);
  markerSatelite = L.marker(coord, { icon: redIcon }).addTo(mapSatelite);

  mapTerreno = L.map('mapaTerreno', { zoomControl: false, attributionControl: false }).setView(coord, 14);
  const topoLayer = L.tileLayer(osmTopo, { maxZoom: 17 }).addTo(mapTerreno);
  topoLayer.on('tileerror', () => {
    if (!mapTerreno._fallbackApplied) {
      mapTerreno._fallbackApplied = true;
      L.tileLayer(osm, { maxZoom: 19 }).addTo(mapTerreno);
    }
  });
  markerTerreno = L.marker(coord, { icon: redIcon }).addTo(mapTerreno);

  window.addEventListener('orbenk:sidebar-toggle', () => {
    setTimeout(refreshMaps, 80);
    setTimeout(refreshMaps, 400);
  });
  window.addEventListener('resize', refreshMaps);

  const mapEl = document.getElementById('mapaPrincipal');
  if (mapEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => refreshMaps());
    ro.observe(mapEl);
  }

  setTimeout(refreshMaps, 250);
  setTimeout(refreshMaps, 650);
}

function refreshMaps() {
  [mapPrincipal, mapSatelite, mapTerreno].forEach(m => m?.invalidateSize({ animate: false }));
}

function atualizarMapas(lat, lon) {
  lastLat = lat; lastLon = lon;
  const coord = [lat, lon];
  [
    [mapPrincipal, markerPrincipal, 15],
    [mapSatelite, markerSatelite, 16],
    [mapTerreno, markerTerreno, 14],
  ].forEach(([map, marker, zoom]) => {
    if (!map) return;
    map.invalidateSize(true);
    map.setView(coord, zoom, { animate: true });
    marker?.setLatLng(coord);
  });
  document.getElementById('lat-hidden').value = lat;
  document.getElementById('lon-hidden').value = lon;
}

// ── Autocomplete Endereço (Nominatim Proxy) ───────────────────────────
function setupAutocomplete() {
  const input = document.getElementById('endereco');
  const box = document.getElementById('suggestionsBox');

  input?.addEventListener('input', e => {
    clearTimeout(geoTimeout);
    geoTimeout = setTimeout(() => buscarEnderecos(e.target.value), 350);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) {
      if (box) box.style.display = 'none';
    }
  });
}

async function buscarEnderecos(termo) {
  const box = document.getElementById('suggestionsBox');
  if (!box || !termo || termo.trim().length < 2) {
    if (box) box.style.display = 'none';
    return;
  }

  try {
    box.innerHTML = '<div class="suggestion-item text-cyan font-bold" style="padding:10px 14px;">📡 Pesquisando no Território Nacional...</div>';
    box.style.display = 'block';

    const results = await geo.search(termo.trim());
    box.innerHTML = '';
    if (!results || !results.length) {
      box.innerHTML = '<div class="suggestion-item text-muted" style="padding:10px 14px;">Nenhum endereço localizado no território nacional.</div>';
      return;
    }

    results.forEach(item => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      
      const addr = item.address || {};
      const city = addr.city || addr.town || addr.municipality || addr.village || addr.county || '';
      const state = addr.state || '';
      const formattedCity = city ? (state ? `${city} - ${state}` : city) : '';

      div.innerHTML = `
        <div style="font-weight:800; color:var(--text-primary); font-size:12.5px;">📍 ${item.display_name.split(',').slice(0, 3).join(',')}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${item.display_name}</div>
      `;

      div.addEventListener('click', () => {
        document.getElementById('endereco').value = item.display_name;
        if (formattedCity) {
          const cityEl = document.getElementById('cidade');
          if (cityEl) cityEl.value = formattedCity;
        }
        box.style.display = 'none';
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        atualizarMapas(lat, lon);
        carregarTelemetriaClima(lat, lon, formattedCity || item.display_name.split(',')[0]);
        showToast(`📍 Localizado: ${formattedCity || 'Brasil'} — Coordenadas e Clima Atualizados!`, 'success');
      });
      box.appendChild(div);
    });
    box.style.display = 'block';
  } catch {
    if (box) box.style.display = 'none';
  }
}

// ── Telemetria Meteorológica em Tempo Real (Open-Meteo & Data Viz) ─────────────────
async function carregarTelemetriaClima(lat, lon, locationName = '') {
  const weatherCard = document.getElementById('weather-panel-card');
  if (!weatherCard || !lat || !lon) return;

  const locEl = document.getElementById('weather-location-name');
  const tempEl = document.getElementById('weather-temp');
  const condEl = document.getElementById('weather-condition');
  const svgEl = document.getElementById('weather-icon-svg');
  const roadImpactEl = document.getElementById('weather-road-impact');
  const rainEl = document.getElementById('weather-rain');
  const rainBarEl = document.getElementById('weather-rain-bar');
  const rainSubEl = document.getElementById('weather-rain-sub');
  const windEl = document.getElementById('weather-wind');
  const windBarEl = document.getElementById('weather-wind-bar');
  const windSubEl = document.getElementById('weather-wind-sub');
  const humEl = document.getElementById('weather-humidity');
  const humBarEl = document.getElementById('weather-humidity-bar');
  const humSubEl = document.getElementById('weather-humidity-sub');
  const trendEl = document.getElementById('weather-trend-container');
  const alertEl = document.getElementById('weather-alert');
  const alertTextEl = document.getElementById('weather-alert-text');

  if (locEl && locationName) locEl.textContent = `${locationName} · Território Nacional`;
  if (condEl) condEl.textContent = 'Consultando satélites meteorológicos...';

  try {
    const w = await weather.get(lat, lon);
    if (!w) {
      if (condEl) condEl.textContent = 'Dados meteorológicos indisponíveis';
      return;
    }

    if (tempEl) tempEl.textContent = `${w.temperature}°C`;
    if (condEl) condEl.textContent = w.condition;
    if (svgEl && w.svg) svgEl.innerHTML = w.svg;
    if (roadImpactEl) roadImpactEl.textContent = `🚗 ${w.roadImpact}`;

    if (rainEl) rainEl.textContent = `${w.precipitation.toFixed(1)} mm`;
    if (rainBarEl) rainBarEl.style.width = Math.min(100, Math.round(w.precipitation * 12)) + '%';
    if (rainSubEl) rainSubEl.textContent = w.precipitation > 5 ? 'Acúmulo Severo' : (w.precipitation > 0 ? 'Pista Úmida' : 'Sem Acúmulo');

    if (windEl) windEl.textContent = `${w.windSpeed} km/h`;
    if (windBarEl) windBarEl.style.width = Math.min(100, Math.max(10, Math.round(w.windSpeed * 2.5))) + '%';
    if (windSubEl) windSubEl.textContent = w.windSpeed > 30 ? 'Vento Forte' : (w.windSpeed > 15 ? 'Brisa Moderada' : 'Calmo / Seguro');

    if (humEl) humEl.textContent = `${w.humidity}%`;
    if (humBarEl) humBarEl.style.width = Math.min(100, Math.max(10, w.humidity)) + '%';
    if (humSubEl) humSubEl.textContent = w.humidity > 80 ? 'Elevada (Orvalho)' : (w.humidity < 40 ? 'Baixa (Seco)' : 'Ideal p/ Operação');

    if (trendEl && Array.isArray(w.hourlyTrend)) {
      trendEl.innerHTML = w.hourlyTrend.map(t => `
        <div class="weather-trend-step" title="${t.label}">
          <span>${t.hour}</span>: <strong>${t.temp}°C</strong>
        </div>
      `).join('');
    }

    if (alertTextEl) alertTextEl.textContent = w.operationalAlert;
    if (alertEl) {
      alertEl.className = `weather-alert-strip ${w.alertLevel}`;
    }
  } catch (err) {
    console.warn('Erro ao carregar telemetria de clima:', err);
  }
}

// ── Dropzone de Imagens ───────────────────────────────────────────────
function setupDropzone() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  if (!dropzone) return;

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleImageFiles(Array.from(e.dataTransfer.files));
  });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', e => handleImageFiles(Array.from(e.target.files)));
}

function handleImageFiles(files) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const maxSize = 10 * 1024 * 1024;

  files.forEach(file => {
    if (!allowed.includes(file.type)) {
      showToast(`Tipo não suportado: ${file.name}`, 'warning');
      return;
    }
    if (file.size > maxSize) {
      showToast(`Arquivo muito grande: ${file.name} (máx. 10MB)`, 'warning');
      return;
    }
    const url = URL.createObjectURL(file);
    uploadedImages.push({ file, url });
  });
  renderImageGrid();
  updateProgress();
}

function renderImageGrid() {
  const grid = document.getElementById('imageGrid');
  if (!grid) return;
  grid.innerHTML = '';

  existingImages.forEach(img => {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.innerHTML = `
      <img src="${img.url}" alt="${img.original_name}" loading="lazy">
      <button type="button" class="image-card-remove" onclick="removeExistingImage(${img.id})" title="Remover">×</button>`;
    grid.appendChild(card);
  });

  uploadedImages.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.innerHTML = `
      <img src="${item.url}" alt="Nova imagem" loading="lazy">
      <button type="button" class="image-card-remove" onclick="removeNewImage(${i})" title="Remover">×</button>`;
    grid.appendChild(card);
  });
}

window.removeExistingImage = async (imgId) => {
  if (!editId) return;
  try {
    await occurrences.deleteImage(editId, imgId);
    existingImages = existingImages.filter(i => i.id !== imgId);
    renderImageGrid();
    showToast('Imagem removida com sucesso', 'success');
  } catch (e) {
    showToast(`Erro: ${e.message}`, 'error');
  }
};

window.removeNewImage = (idx) => {
  URL.revokeObjectURL(uploadedImages[idx]?.url);
  uploadedImages.splice(idx, 1);
  renderImageGrid();
};

// ── Testemunhas Catalogadas ───────────────────────────────────────────
window.addWitness = (data = null) => {
  witnessCount++;
  const container = document.getElementById('witnessList');
  const id = witnessCount;
  const div = document.createElement('div');
  div.className = 'witness-card';
  div.id = `witness-${id}`;
  div.innerHTML = `
    <div class="witness-card-header">
      <span>◈ Testemunha / Contato #${id}</span>
      <button type="button" class="btn btn-danger btn-sm" onclick="removeWitness(${id})">✖ Remover</button>
    </div>
    <div class="grid-3">
      <div class="field">
        <label class="field-label" for="wit-nome-${id}">Nome Completo</label>
        <input type="text" id="wit-nome-${id}" class="wit-nome" value="${data?.name || ''}">
      </div>
      <div class="field">
        <label class="field-label" for="wit-tel-${id}">Telefone / Celular</label>
        <input type="text" id="wit-tel-${id}" class="wit-tel" value="${data?.phone || ''}">
      </div>
      <div class="field">
        <label class="field-label" for="wit-doc-${id}">CPF / RG / Identidade</label>
        <input type="text" id="wit-doc-${id}" class="wit-doc" value="${data?.document || ''}">
      </div>
    </div>`;
  container.appendChild(div);
};

window.removeWitness = (id) => {
  document.getElementById(`witness-${id}`)?.remove();
};

// ── Coleta de Dados do Formulário ─────────────────────────────────────
function collectFormData() {
  const radioVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '';
  const chips = (group) =>
    Array.from(document.querySelectorAll(`.chip.selected[data-group="${group}"]`))
      .map(c => c.dataset.value);

  const witnesses = Array.from(document.querySelectorAll('.witness-card')).map(card => ({
    name: card.querySelector('.wit-nome')?.value || '',
    phone: card.querySelector('.wit-tel')?.value || '',
    document: card.querySelector('.wit-doc')?.value || '',
  }));

  return {
    protocol: document.getElementById('protocolo')?.value || undefined,
    shift: document.getElementById('turno')?.value || '',
    client: document.getElementById('cliente')?.value || '',
    city: document.getElementById('cidade')?.value || 'Joinville, SC',
    address: document.getElementById('endereco')?.value || '',
    lat: parseFloat(document.getElementById('lat-hidden')?.value) || null,
    lon: parseFloat(document.getElementById('lon-hidden')?.value) || null,
    contact_name: document.getElementById('contatoNome')?.value || '',
    contact_phone: document.getElementById('contatoTel')?.value || '',
    occurrence_date: document.getElementById('dataOcorrencia')?.value || null,
    occurrence_time: document.getElementById('horaOcorrencia')?.value || '',
    contracted_services: chips('servico'),
    occurrence_types: chips('tipo'),
    authorities: chips('autoridade'),
    alarm_triggered: radioVal('disparo') === 'Sim',
    alarm_trigger_time: document.getElementById('horaDisparo')?.value || '',
    attendant_arrival_time: document.getElementById('horaAtendente')?.value || '',
    total_attendance_time: document.getElementById('tempoTotal')?.value || '',
    alarm_status: radioVal('sistemaAlarme'),
    alarm_zone: document.getElementById('zonaDisparada')?.value || '',
    had_victims: radioVal('houveVitimas') === 'Sim',
    victim_count: parseInt(document.getElementById('numVitimas')?.value) || 0,
    victim_severity: document.getElementById('gravidadeVitima')?.value || '',
    had_fatalities: document.getElementById('gravidadeVitima')?.value?.includes('Óbito') || false,
    victim_details: {
      aggression_means: document.getElementById('meioAgressao')?.value || '',
      care_destination: `${document.getElementById('socorroMedico')?.value || ''} - Destino: ${document.getElementById('hospitalDestino')?.value || ''}`,
    },
    assault_medium: document.getElementById('meioAgressao')?.value || '',
    medical_care: document.getElementById('socorroMedico')?.value || '',
    hospital_destination: document.getElementById('hospitalDestino')?.value || '',
    guard_on_site: radioVal('vigNoLocal') === 'Sim',
    guard_count: parseInt(document.getElementById('guardCount')?.value) || 1,
    guard_name: document.getElementById('nomeVigilante')?.value || '',
    guard_surrendered: radioVal('vigRendido') === 'Sim',
    guard_assaulted: radioVal('guardAssaulted') === 'Sim',
    guard_injury_severity: document.getElementById('guardInjurySeverity')?.value || 'Ileso',
    guard_weapon_fired: radioVal('guardWeaponFired') === 'Sim',
    weapon_stolen: radioVal('weaponStolen') === 'Sim',
    weapon_stolen_details: document.getElementById('weaponStolenDetails')?.value || null,
    vest_stolen: radioVal('vestStolen') === 'Sim',
    crime_scene_preserved: radioVal('crimeScenePreserved') === 'Sim',
    forensic_team_called: radioVal('forensicTeamCalled') === 'Sim',
    police_station: document.getElementById('policeStation')?.value || '',
    police_officer: document.getElementById('policeOfficer')?.value || '',
    legal_custody_notes: document.getElementById('legalCustodyNotes')?.value || null,
    damage_description: document.getElementById('danosDesc')?.value || null,
    bo_number: document.getElementById('numeroBO')?.value || '',
    narrative: document.getElementById('relato')?.value || null,
    status: document.getElementById('status-select')?.value || 'em_andamento',
    witnesses,
  };
}

// ── Carregar Ocorrência para Edição ───────────────────────────────────
async function loadOccurrence(id) {
  try {
    const occ = await occurrences.get(id);

    // Identificação
    document.getElementById('protocolo').value = occ.protocol || '';
    document.getElementById('operador').value = occ.operator?.full_name || '';
    document.getElementById('turno').value = occ.shift || '';

    // Cliente e Localização
    document.getElementById('cliente').value = occ.client || '';
    document.getElementById('cidade').value = occ.city || 'Joinville, SC';
    document.getElementById('endereco').value = occ.address || '';
    document.getElementById('contatoNome').value = occ.contact_name || '';
    document.getElementById('contatoTel').value = occ.contact_phone || '';

    if (occ.lat && occ.lon) {
      atualizarMapas(occ.lat, occ.lon);
    }

    // Cronologia e SLA
    if (occ.occurrence_date) document.getElementById('dataOcorrencia').value = occ.occurrence_date;
    if (occ.occurrence_time) document.getElementById('horaOcorrencia').value = occ.occurrence_time;

    const dispVal = occ.alarm_triggered ? 'Sim' : 'Não';
    syncSwitchUI('disparo', dispVal);
    const dispRadio = document.querySelector(`input[name="disparo"][value="${dispVal}"]`);
    if (dispRadio) dispRadio.checked = true;

    document.getElementById('horaDisparo').value = occ.alarm_trigger_time || '';
    document.getElementById('horaAtendente').value = occ.attendant_arrival_time || '';
    document.getElementById('tempoTotal').value = occ.total_attendance_time || '';

    // Alarme
    const almVal = occ.alarm_status || 'Armado';
    syncSwitchUI('sistemaAlarme', almVal);
    const almRadio = document.querySelector(`input[name="sistemaAlarme"][value="${almVal}"]`);
    if (almRadio) almRadio.checked = true;
    document.getElementById('zonaDisparada').value = occ.alarm_zone || '';

    // Chips
    (occ.contracted_services || []).forEach(val => {
      document.querySelector(`.chip[data-group="servico"][data-value="${val}"]`)?.classList.add('selected');
    });
    (occ.occurrence_types || []).forEach(val => {
      document.querySelector(`.chip[data-group="tipo"][data-value="${val}"]`)?.classList.add('selected');
    });
    (occ.authorities || []).forEach(val => {
      document.querySelector(`.chip[data-group="autoridade"][data-value="${val}"]`)?.classList.add('selected');
    });

    // Vítimas
    const vitVal = occ.had_victims ? 'Sim' : 'Não';
    syncSwitchUI('houveVitimas', vitVal);
    const vitRadio = document.querySelector(`input[name="houveVitimas"][value="${vitVal}"]`);
    if (vitRadio) vitRadio.checked = true;

    document.getElementById('numVitimas').value = occ.victim_count || 1;
    document.getElementById('gravidadeVitima').value = occ.victim_severity || 'Leve (Escoriações / Lesão Superficial)';
    document.getElementById('meioAgressao').value = occ.assault_medium || occ.victim_details?.aggression_means || 'Arma de Fogo (Projétil Balístico)';
    document.getElementById('socorroMedico').value = occ.medical_care || '';
    document.getElementById('hospitalDestino').value = occ.hospital_destination || '';

    // Vigilante
    const vigVal = occ.guard_on_site ? 'Sim' : 'Não';
    syncSwitchUI('vigNoLocal', vigVal);
    const vigRadio = document.querySelector(`input[name="vigNoLocal"][value="${vigVal}"]`);
    if (vigRadio) vigRadio.checked = true;

    document.getElementById('guardCount').value = occ.guard_count || 1;
    document.getElementById('nomeVigilante').value = occ.guard_name || '';

    const vrendVal = occ.guard_surrendered ? 'Sim' : 'Não';
    syncSwitchUI('vigRendido', vrendVal);
    const vrendRadio = document.querySelector(`input[name="vigRendido"][value="${vrendVal}"]`);
    if (vrendRadio) vrendRadio.checked = true;

    const vagrVal = occ.guard_assaulted ? 'Sim' : 'Não';
    syncSwitchUI('guardAssaulted', vagrVal);
    const vagrRadio = document.querySelector(`input[name="guardAssaulted"][value="${vagrVal}"]`);
    if (vagrRadio) vagrRadio.checked = true;

    document.getElementById('guardInjurySeverity').value = occ.guard_injury_severity || 'Ileso';

    const vdispVal = occ.guard_weapon_fired ? 'Sim' : 'Não';
    syncSwitchUI('guardWeaponFired', vdispVal);
    const vdispRadio = document.querySelector(`input[name="guardWeaponFired"][value="${vdispVal}"]`);
    if (vdispRadio) vdispRadio.checked = true;

    const vcolVal = occ.vest_stolen ? 'Sim' : 'Não';
    syncSwitchUI('vestStolen', vcolVal);
    const vcolRadio = document.querySelector(`input[name="vestStolen"][value="${vcolVal}"]`);
    if (vcolRadio) vcolRadio.checked = true;

    const varmVal = occ.weapon_stolen ? 'Sim' : 'Não';
    syncSwitchUI('weaponStolen', varmVal);
    const varmRadio = document.querySelector(`input[name="weaponStolen"][value="${varmVal}"]`);
    if (varmRadio) varmRadio.checked = true;

    document.getElementById('weaponStolenDetails').value = occ.weapon_stolen_details || '';

    // Perícia e Amparo Jurídico
    const cspVal = occ.crime_scene_preserved ? 'Sim' : 'Não';
    syncSwitchUI('crimeScenePreserved', cspVal);
    const cspRadio = document.querySelector(`input[name="crimeScenePreserved"][value="${cspVal}"]`);
    if (cspRadio) cspRadio.checked = true;

    const ftcVal = occ.forensic_team_called ? 'Sim' : 'Não';
    syncSwitchUI('forensicTeamCalled', ftcVal);
    const ftcRadio = document.querySelector(`input[name="forensicTeamCalled"][value="${ftcVal}"]`);
    if (ftcRadio) ftcRadio.checked = true;

    document.getElementById('policeStation').value = occ.police_station || '';
    document.getElementById('policeOfficer').value = occ.police_officer || '';
    document.getElementById('legalCustodyNotes').value = occ.legal_custody_notes || '';

    // Danos e B.O.
    document.getElementById('danosDesc').value = occ.damage_description || '';
    document.getElementById('numeroBO').value = occ.bo_number || '';

    // Relato
    document.getElementById('relato').value = occ.narrative || '';

    // Status
    document.getElementById('status-select').value = occ.status || 'em_andamento';

    // Imagens salvas
    existingImages = occ.images || [];
    renderImageGrid();

    // Testemunhas
    (occ.witnesses || []).forEach(w => window.addWitness(w));

    handleConditionals();
    updateLiveHUD();
    updateProgress();

  } catch (e) {
    showToast(`Erro ao carregar ocorrência: ${e.message}`, 'error');
  }
}

// ── Botões de Ação e Submissão ────────────────────────────────────────
function setupActionButtons() {
  document.getElementById('btn-save')?.addEventListener('click', handleSave);

  document.getElementById('btn-pdf')?.addEventListener('click', () => {
    const dadosForm = collectFormData();
    if (!dadosForm.client && !dadosForm.address) {
      showToast('Preencha o cliente ou endereço antes de emitir o Laudo', 'warning');
    }
    showToast('Gerando Laudo Oficial com Amparo Jurídico...', 'info');
    printOfficialReport(dadosForm);
  });

  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });
}

async function handleSave() {
  const data = collectFormData();

  // Validação assistida de campos essenciais para validade jurídica do registro
  if (!data.client?.trim()) {
    showToast('Informe o Cliente / Contratante na Fase 1 (Despacho & Local).', 'warning');
    goToStage(1);
    document.getElementById('cliente')?.focus();
    return;
  }
  if (!data.address?.trim()) {
    showToast('Informe o Endereço da Ocorrência na Fase 1 (Despacho & Local).', 'warning');
    goToStage(1);
    document.getElementById('endereco')?.focus();
    return;
  }
  if (!data.occurrence_types || data.occurrence_types.length === 0) {
    showToast('Selecione ao menos um Tipo do Evento na Fase 3.', 'warning');
    goToStage(3);
    return;
  }
  if (!data.narrative?.trim()) {
    showToast('Preencha ou gere o Relato Técnico na Fase 6 (Relato & Laudo).', 'warning');
    goToStage(6);
    document.getElementById('relato')?.focus();
    return;
  }

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> SALVANDO REGISTRO…';

  try {
    const wasEditing = !!editId;
    let occ;

    if (wasEditing) {
      occ = await occurrences.update(editId, data);
    } else {
      occ = await occurrences.create(data);
      editId = occ.id;
    }

    // Upload de imagens novas
    if (uploadedImages.length > 0) {
      const files = uploadedImages.map(i => i.file);
      await occurrences.uploadImages(occ.id, files);
      uploadedImages.forEach(i => URL.revokeObjectURL(i.url));
      uploadedImages = [];
    }

    showToast(
      wasEditing ? `Ocorrência ${occ.protocol} atualizada com sucesso!` : `Ocorrência ${occ.protocol} criada e protocolada!`,
      'success'
    );

    setTimeout(() => {
      window.location.href = `occurrence.html?id=${occ.id}`;
    }, 900);

  } catch (e) {
    showToast(`Erro ao salvar: ${e.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = '💾 SALVAR OCORRÊNCIA';
  }
}
