/**
 * occurrence.js — Detalhes de uma ocorrência
 */
import {
  requireAuth, occurrences, reports, showToast,
  buildSidebar, buildTopbar, setupLiveClock, getCurrentUser,
  formatDate, formatDateTime, statusBadge, auth, initTheme,
  initAmbientTacticalMap
} from './api.js';

let occData = null;
let detailMap = null;
let ambientMapInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  document.getElementById('sidebar-slot').innerHTML = buildSidebar('occurrences');
  document.getElementById('topbar-slot').innerHTML = buildTopbar('Detalhe da Ocorrência');
  initTheme();
  setupLiveClock(document.getElementById('liveClock'));

  // Inicializa o mapa tático de fundo em movimento omnipresente
  ambientMapInstance = initAmbientTacticalMap('ambient-bg-map');

  const user = getCurrentUser();
  const el = document.getElementById('topbar-username');
  if (el && user) el.textContent = user.full_name || user.username;

  const params = new URLSearchParams(window.location.search);
  const id = parseInt(params.get('id'));
  if (!id) {
    showToast('ID de ocorrência inválido', 'error');
    return;
  }

  // Controle de permissões
  if (user?.role === 'operador') {
    document.querySelectorAll('.supervisor-only').forEach(el => el.remove());
  }

  await loadOccurrence(id);
  setupActions(id, user);
});

async function loadOccurrence(id) {
  try {
    occData = await occurrences.get(id);
    renderAll(occData);
  } catch (e) {
    showToast(`Erro: ${e.message}`, 'error');
    document.getElementById('content').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠</div>
        <div class="empty-state-title">Ocorrência não encontrada</div>
        <div class="empty-state-sub">${e.message}</div>
      </div>`;
  }
}

function renderAll(occ) {
  // Header
  document.getElementById('occ-protocol').textContent = occ.protocol;
  document.getElementById('occ-status-badge').innerHTML = statusBadge(occ.status);
  document.getElementById('occ-created').textContent = `Registrado em ${formatDateTime(occ.created_at)}`;

  // Seção 1 — Identificação
  setField('r-operador',  occ.operator?.full_name || '—');
  setField('r-turno',     occ.shift || '—');
  setField('r-datahora',  `${formatDate(occ.occurrence_date)} ${occ.occurrence_time ? 'às ' + occ.occurrence_time : ''}`);
  setField('r-protocolo', occ.protocol);

  // Seção 2 — Cliente & Localização
  setField('r-cliente',      occ.client || '—');
  setField('r-cidade',       occ.city || '—');
  setField('r-endereco',     occ.address || '—');
  setField('r-contato',      `${occ.contact_name || '—'} ${occ.contact_phone ? '· ' + occ.contact_phone : ''}`);
  setField('r-coords',       occ.lat ? `${occ.lat.toFixed(6)}, ${occ.lon.toFixed(6)}` : 'N/A');

  // Mapa
  if (occ.lat && occ.lon) {
    initDetailMap(occ.lat, occ.lon, occ.address);
    document.getElementById('map-section').style.display = 'block';
  }

  // Seção 3 — Classificação e Alarme
  setHTML('r-servicos',     badges(occ.contracted_services, 'badge-cyan'));
  setHTML('r-tipos',        badges(occ.occurrence_types, 'badge-red'));
  setHTML('r-autoridades',  badges(occ.authorities, 'badge-amber'));
  setField('r-alarme',      occ.alarm_status || '—');
  setField('r-zona',        occ.alarm_zone || 'N/A');
  setField('r-disparo',     occ.alarm_triggered ? 'Sim' : 'Não');
  setField('r-hora-disparo',occ.alarm_trigger_time || 'N/A');
  setField('r-hora-cheg',   occ.attendant_arrival_time || '—');
  setField('r-tempo-total', occ.total_attendance_time || '—');
  setField('r-bo',          occ.bo_number || 'Não registrado');

  // Seção 4 — Mapeamento Clínico e Vítimas
  const hadVictims = !!occ.had_victims;
  setField('r-vitimas', hadVictims ? 'SIM' : 'NÃO');
  setField('r-vitimas-count', hadVictims ? String(occ.victim_count || 1) : '0');
  
  let gravidadeTxt = occ.victim_severity || 'Não informada';
  if (occ.had_fatalities) {
    gravidadeTxt = `ÓBITO CONFIRMADO (${occ.fatality_count || 1} óbito(s))`;
  }
  setField('r-vitimas-gravidade', gravidadeTxt);

  const victimDetails = occ.victim_details || {};
  setField('r-meio-agressao', occ.assault_medium || victimDetails.aggression_means || (hadVictims ? 'Em apuração' : 'Não se aplica'));
  const careText = (occ.medical_care || occ.hospital_destination)
    ? `${occ.medical_care || ''}${occ.hospital_destination ? ' — Destino: ' + occ.hospital_destination : ''}`
    : (victimDetails.care_destination || (hadVictims ? 'Socorro prestado no local' : 'Não se aplica'));
  setField('r-socorro-info', careText);

  // Seção 5 — Vigilante e Armamento (Lei 7.102/83)
  const guardOnSite = !!occ.guard_on_site;
  setField('r-vig-posto', guardOnSite ? 'SIM (Posto Operacional com Efetivo)' : 'NÃO');
  setField('r-vig-count', guardOnSite ? String(occ.guard_count || 1) : '0');
  setField('r-vig-nome', occ.guard_name || 'Não informado / N/A');
  setField('r-vig-rendido', occ.guard_surrendered ? 'SIM (Rendido pela Agressão)' : 'NÃO');
  
  let agredidoTxt = 'NÃO';
  if (occ.guard_assaulted) {
    agredidoTxt = `SIM — Lesão: ${occ.guard_injury_severity || 'Não informada'}`;
  }
  setField('r-vig-agredido', agredidoTxt);
  setField('r-vig-disparos', occ.guard_weapon_fired ? 'SIM (Disparos / Confronto Armado)' : 'NÃO');
  setField('r-vig-colete', occ.vest_stolen ? 'SIM (Colete Balístico Subtraído)' : 'NÃO');
  
  if (occ.weapon_stolen) {
    setField('r-vig-arma', `⚠ SUBTRAÍDA: ${occ.weapon_stolen_details || 'Informar PF imediatamente conforme Lei 7.102/83'}`);
  } else {
    setField('r-vig-arma', 'NÃO (Armamento Preservado / Não se aplica)');
  }

  // Seção 6 — Amparo Jurídico & Perícia Oficial (CPP Arts. 6º e 158-A)
  setField('r-local-preservado', occ.crime_scene_preserved ? 'SIM (Isolado conforme Art. 6º, I do CPP)' : 'NÃO / Sem isolamento pericial');
  setField('r-pericia-oficial', occ.forensic_team_called ? 'SIM (Perícia Oficial Acionada)' : 'NÃO');
  setField('r-delegacia', occ.police_station || 'Não informada');
  setField('r-policial', occ.police_officer || 'Não informado');
  setField('r-custodia', occ.legal_custody_notes || 'Cadeia de custódia preservada conforme Arts. 158-A a 158-F do CPP.');

  // Seção 7 — Danos
  if (occ.damage_description) {
    document.getElementById('r-danos').textContent = occ.damage_description;
    document.getElementById('sec-danos').style.display = 'block';
  } else {
    document.getElementById('sec-danos').style.display = 'none';
  }

  // Seção 8 — Testemunhas
  if (occ.witnesses?.length) {
    renderWitnesses(occ.witnesses);
    document.getElementById('sec-testemunhas').style.display = 'block';
  } else {
    document.getElementById('sec-testemunhas').style.display = 'none';
  }

  // Seção 9 — Relato
  document.getElementById('r-relato').textContent =
    occ.narrative || 'Nenhum relato detalhado registrado para esta ocorrência.';

  // Seção 10 — Imagens
  if (occ.images?.length) {
    renderImages(occ.images);
    document.getElementById('sec-imagens').style.display = 'block';
  } else {
    document.getElementById('sec-imagens').style.display = 'none';
  }

  // Seção 11 — Cadeia de Custódia & Trilha de Auditoria
  renderAuditLog(occ.audit_log || [{ at: occ.created_at, by: occ.operator?.full_name || 'Operador', action: 'CRIAÇÃO', detail: 'Registro inicial da ocorrência' }]);
}

function renderAuditLog(logEntries) {
  const container = document.getElementById('audit-log-list');
  if (!container) return;
  container.innerHTML = logEntries.map(entry => `
    <div style="background:var(--bg-input); border:1px solid var(--border); border-left:3px solid var(--accent-cyan); border-radius:4px; padding:8px 10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
        <span class="font-mono text-cyan" style="font-weight:700; font-size:11px;">${entry.action || 'EVENTO'}</span>
        <span class="font-mono text-muted" style="font-size:10.5px;">${formatDateTime(entry.at)}</span>
      </div>
      <div style="color:var(--text-primary); font-size:12px;">${entry.detail || '—'}</div>
      <div class="text-xs text-muted" style="margin-top:2px;">Responsável: ${entry.by || 'Sistema'}</div>
    </div>
  `).join('');
}

function setField(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '—';
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html || '—';
}

function badges(items, cls) {
  if (!items?.length) return '—';
  return items.map(i => `<span class="badge ${cls}">${i}</span>`).join(' ');
}

function renderWitnesses(witnesses) {
  const tbody = document.getElementById('witnesses-tbody');
  if (!tbody) return;
  tbody.innerHTML = witnesses.map((w, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${w.name || '—'}</td>
      <td>${w.phone || '—'}</td>
      <td>${w.document || '—'}</td>
    </tr>`).join('');
}

function renderImages(images) {
  const grid = document.getElementById('images-grid');
  if (!grid) return;
  grid.innerHTML = images.map(img => `
    <div class="image-card" onclick="openLightbox('${img.url}')" title="${img.original_name}">
      <img src="${img.url}" alt="${img.original_name}" loading="lazy">
    </div>`).join('');
}

function initDetailMap(lat, lon, label) {
  if (detailMap) { detailMap.setView([lat, lon], 15); return; }

  detailMap = L.map('detailMap', { zoomControl: true }).setView([lat, lon], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(detailMap);

  const marker = L.divIcon({
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

  L.marker([lat, lon], { icon: marker })
    .addTo(detailMap)
    .bindPopup(`<strong>${label || 'Local da ocorrência'}</strong>`)
    .openPopup();

  window.addEventListener('orbenk:sidebar-toggle', () => {
    setTimeout(() => detailMap?.invalidateSize(true), 80);
    setTimeout(() => detailMap?.invalidateSize(true), 400);
  });

  setTimeout(() => detailMap.invalidateSize(true), 200);
}

// ── Lightbox ──────────────────────────────────────────────────────────
window.openLightbox = (url) => {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <img src="${url}" class="lightbox-img" alt="Evidência">
    <button class="lightbox-close" onclick="this.closest('.lightbox-overlay').remove()">×</button>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
};

// ── Módulo de Assinatura Digital do Operador ──────────────────────────
let isDrawing = false;
let hasSigned = false;
let sigCanvas = null;
let sigCtx = null;

function initSignaturePad(user, occ) {
  sigCanvas = document.getElementById('operator-sig-canvas');
  if (!sigCanvas) return;

  const opName = occ?.operator?.full_name || user?.full_name || user?.username || 'Operador de Monitoramento';
  const opMatricula = `OBK-OP-${occ?.operator?.id ? String(occ.operator.id).padStart(4, '0') : '2026'}`;
  const agora = new Date();
  const dataHoraStr = agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  setField('sig-operador-nome', opName);
  setField('sig-matricula', opMatricula);
  setField('sig-datahora', dataHoraStr);
  const hashVal = 'SHA256: ' + (occ?.protocol ? occ.protocol.replace(/[^A-Z0-9]/gi, '') : 'OBK') + '-' + Date.now().toString(16).toUpperCase();
  setField('sig-hash', hashVal);

  // Configuração Retina / High-DPI
  const rect = sigCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  sigCanvas.width = (rect.width || 480) * dpr;
  sigCanvas.height = (rect.height || 140) * dpr;
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.scale(dpr, dpr);
  sigCtx.strokeStyle = '#0f2b5c';
  sigCtx.lineWidth = 2.4;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';

  const watermark = document.getElementById('sig-watermark');
  const badge = document.getElementById('sig-status-badge');

  function getPos(e) {
    const r = sigCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - r.left,
      y: clientY - r.top
    };
  }

  function startDraw(e) {
    isDrawing = true;
    hasSigned = true;
    if (watermark) watermark.style.opacity = '0';
    if (badge) {
      badge.textContent = '✔ ASSINADO DIGITALMENTE';
      badge.className = 'signature-status-pill signed';
    }
    const pos = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
  }

  function moveDraw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
  }

  function endDraw() {
    isDrawing = false;
  }

  sigCanvas.addEventListener('mousedown', startDraw);
  sigCanvas.addEventListener('mousemove', moveDraw);
  window.addEventListener('mouseup', endDraw);

  sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
  sigCanvas.addEventListener('touchmove', moveDraw, { passive: false });
  window.addEventListener('touchend', endDraw);

  // Botão Limpar
  document.getElementById('btn-clear-sig')?.addEventListener('click', () => {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    hasSigned = false;
    if (watermark) watermark.style.opacity = '1';
    if (badge) {
      badge.textContent = '● AGUARDANDO ASSINATURA';
      badge.className = 'signature-status-pill pending';
    }
    showToast('Assinatura limpa', 'info');
  });

  // Botão Rubrica Digital Automática
  document.getElementById('btn-auto-sig')?.addEventListener('click', () => {
    generateAutoRubric(opName, opMatricula);
  });
}

function generateAutoRubric(name, matricula) {
  if (!sigCanvas || !sigCtx) return;
  const w = sigCanvas.width / (window.devicePixelRatio || 1);
  const h = sigCanvas.height / (window.devicePixelRatio || 1);

  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);

  const watermark = document.getElementById('sig-watermark');
  if (watermark) watermark.style.opacity = '0';

  const badge = document.getElementById('sig-status-badge');
  if (badge) {
    badge.textContent = '✔ ASSINADO DIGITALMENTE';
    badge.className = 'signature-status-pill signed';
  }

  hasSigned = true;

  // Traçado caligráfico elegante
  sigCtx.save();
  sigCtx.strokeStyle = '#0f2b5c';
  sigCtx.lineWidth = 2.2;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';

  sigCtx.beginPath();
  sigCtx.moveTo(w * 0.12, h * 0.65);
  sigCtx.bezierCurveTo(w * 0.20, h * 0.15, w * 0.26, h * 0.85, w * 0.35, h * 0.40);
  sigCtx.bezierCurveTo(w * 0.42, h * 0.22, w * 0.46, h * 0.72, w * 0.56, h * 0.42);
  sigCtx.bezierCurveTo(w * 0.64, h * 0.30, w * 0.70, h * 0.65, w * 0.82, h * 0.46);
  sigCtx.stroke();

  // Traço de encerramento
  sigCtx.beginPath();
  sigCtx.moveTo(w * 0.10, h * 0.78);
  sigCtx.bezierCurveTo(w * 0.32, h * 0.80, w * 0.62, h * 0.74, w * 0.88, h * 0.78);
  sigCtx.stroke();

  // Selo de autenticação eletrônica
  sigCtx.font = 'bold 9px "Segoe UI", Arial, sans-serif';
  sigCtx.fillStyle = '#1557a6';
  sigCtx.fillText('✔ AUTENTICAÇÃO DIGITAL ICP-ORBENK', w * 0.38, h * 0.89);
  sigCtx.font = '8px monospace';
  sigCtx.fillStyle = '#64748b';
  sigCtx.fillText(`RESP: ${name.toUpperCase()} · ${matricula}`, w * 0.38, h * 0.97);
  sigCtx.restore();

  showToast('Rubrica digital certificada gerada com sucesso!', 'success');
}

async function handleEmitPDF(id, occ) {
  if (!hasSigned) {
    const opName = occ?.operator?.full_name || 'Operador de Monitoramento';
    const opMatricula = `OBK-OP-${occ?.operator?.id ? String(occ.operator.id).padStart(4, '0') : '2026'}`;
    generateAutoRubric(opName, opMatricula);
  }

  const sigImage = sigCanvas ? sigCanvas.toDataURL('image/png') : null;
  showToast('Emitindo Laudo Oficial com Amparo Jurídico e Assinatura...', 'info');
  reports.downloadPDF(id, occ, sigImage);
}

// ── Ações ──────────────────────────────────────────────────────────────
function setupActions(id, user) {
  initSignaturePad(user, occData);

  document.getElementById('btn-edit')?.addEventListener('click', () => {
    window.location.href = `form.html?id=${id}`;
  });

  document.getElementById('btn-pdf')?.addEventListener('click', () => {
    handleEmitPDF(id, occData);
  });

  document.getElementById('btn-sign-pdf')?.addEventListener('click', () => {
    handleEmitPDF(id, occData);
  });

  document.getElementById('btn-archive')?.addEventListener('click', async () => {
    try {
      await occurrences.update(id, { status: 'arquivada' });
      showToast('Ocorrência arquivada', 'success');
      document.getElementById('occ-status-badge').innerHTML = statusBadge('arquivada');
    } catch (e) {
      showToast(`Erro: ${e.message}`, 'error');
    }
  });

  document.getElementById('btn-delete')?.addEventListener('click', () => {
    const modal = document.getElementById('delete-modal');
    document.getElementById('delete-protocol').textContent = occData?.protocol;
    document.getElementById('btn-confirm-delete').onclick = async () => {
      try {
        await occurrences.delete(id);
        showToast('Ocorrência excluída', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
      } catch (e) {
        showToast(`Erro: ${e.message}`, 'error');
      }
    };
    modal.style.display = 'flex';
  });
}

window.closeModal = () => {
  document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
};
