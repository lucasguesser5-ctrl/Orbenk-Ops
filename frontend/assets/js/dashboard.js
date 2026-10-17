/**
 * dashboard.js — Lógica Avançada do Painel Operacional Centralizado
 * Orbenk Ops — Sistema Integrado de Ocorrências e Auditoria Tática
 */
import {
  requireAuth, stats, occurrences, showToast,
  formatDate, statusBadge, setupLiveClock,
  buildSidebar, buildTopbar, getCurrentUser, initTheme,
  printOfficialReport, VOCAB, parseMinutes, computeSeverity, OrbenkStorage
} from './api.js';

// ── Estado Global da Página ───────────────────────────────────────────
let currentPage = 1;
const itemsPerPage = 10;
let currentFilter = '';
let currentSearch = '';
let currentType = '';
let currentShift = '';
let currentSeverity = '';
let searchTimeout = null;
let deleteTargetId = null;
let previewOccurrence = null;

// Instâncias dos Gráficos
let chartMonthlyInstance = null;
let chartTypesInstance = null;
let chartSlaInstance = null;
let chartClientsInstance = null;

// ── Inicialização ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;

  // Injeção de Componentes Estruturais
  const sidebarSlot = document.getElementById('sidebar-slot');
  if (sidebarSlot) sidebarSlot.innerHTML = buildSidebar('dashboard');

  const topbarSlot = document.getElementById('topbar-slot');
  if (topbarSlot) topbarSlot.innerHTML = buildTopbar('Painel Geral');

  initTheme();

  // Relógio Militar em Tempo Real
  const liveClockEl = document.getElementById('liveClock');
  if (liveClockEl) setupLiveClock(liveClockEl);

  // Usuário no Topbar
  const user = getCurrentUser();
  const topUserEl = document.getElementById('topbar-username');
  if (topUserEl && user) {
    topUserEl.textContent = user.full_name || user.username;
  }

  // Popula select de Tipos de Evento com vocabulário canônico
  const filterTypeEl = document.getElementById('filterType');
  if (filterTypeEl && VOCAB?.types) {
    VOCAB.types.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      filterTypeEl.appendChild(opt);
    });
    filterTypeEl.addEventListener('change', e => {
      currentType = e.target.value;
      currentPage = 1;
      loadOccurrences();
    });
  }

  document.getElementById('filterShift')?.addEventListener('change', e => {
    currentShift = e.target.value;
    currentPage = 1;
    loadOccurrences();
  });

  document.getElementById('filterSeverity')?.addEventListener('change', e => {
    currentSeverity = e.target.value;
    currentPage = 1;
    loadOccurrences();
  });

  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    currentFilter = '';
    currentSearch = '';
    currentType = '';
    currentShift = '';
    currentSeverity = '';
    currentPage = 1;
    const sInput = document.getElementById('searchInput');
    if (sInput) sInput.value = '';
    if (filterTypeEl) filterTypeEl.value = '';
    const shEl = document.getElementById('filterShift');
    if (shEl) shEl.value = '';
    const sevEl = document.getElementById('filterSeverity');
    if (sevEl) sevEl.value = '';
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', !p.dataset.status));
    loadOccurrences();
  });

  // Configuração dos Filtros por Pílula
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.status || '';
      currentPage = 1;
      loadOccurrences();
    });
  });

  // Busca Instantânea com Debounce
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentSearch = e.target.value.trim();
        currentPage = 1;
        loadOccurrences();
      }, 220);
    });
  }

  // Botão de Atualização Manual
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    showToast('Sincronizando banco de dados operacional...', 'info');
    loadStats();
    loadOccurrences();
  });

  // Exportação CSV
  document.getElementById('btn-export-csv')?.addEventListener('click', exportFilteredCSV);

  // Modal de Exclusão
  document.getElementById('btn-cancel-delete')?.addEventListener('click', closeDeleteModal);
  document.getElementById('btn-confirm-delete')?.addEventListener('click', confirmDelete);

  // Modal de Pré-Visualização Rápida
  document.getElementById('btn-close-preview')?.addEventListener('click', closePreviewModal);
  document.getElementById('preview-modal')?.addEventListener('click', e => {
    if (e.target.id === 'preview-modal') closePreviewModal();
  });
  document.getElementById('prev-btn-pdf')?.addEventListener('click', () => {
    if (previewOccurrence) {
      showToast('Emitindo Laudo Pericial Oficial...', 'info');
      printOfficialReport(previewOccurrence);
    }
  });
  document.getElementById('prev-status-select')?.addEventListener('change', async (e) => {
    if (!previewOccurrence) return;
    const newStatus = e.target.value;
    try {
      previewOccurrence = await occurrences.update(previewOccurrence.id, { status: newStatus });
      document.getElementById('prev-status').innerHTML = statusBadge(newStatus);
      showToast(`Status atualizado para ${newStatus.toUpperCase()}`, 'success');
      loadStats();
      loadOccurrences();
    } catch (err) {
      showToast(`Erro ao atualizar status: ${err.message}`, 'error');
    }
  });

  // Inicializa o Mapa Tático em Movimento Contínuo no Fundo do Dashboard
  initDashboardBackgroundMap();

  // ── CARGA IMEDIATA SÍNCRONA DE GRÁFICOS (ZERO DELAY AO ABRIR O PAINEL) ──
  const instantStats = OrbenkStorage.computeStats();
  if (instantStats) {
    renderKPIs(instantStats);
    if (window.Chart) {
      renderIntelligentCharts(instantStats);
    }
  }

  // Poller de verificação instantânea caso o CDN do Chart.js termine de carregar logo após
  let chartPollerCount = 0;
  const chartPoller = setInterval(() => {
    chartPollerCount++;
    if (window.Chart) {
      clearInterval(chartPoller);
      const s = OrbenkStorage.computeStats();
      if (s) renderIntelligentCharts(s);
    }
    if (chartPollerCount > 60) clearInterval(chartPoller);
  }, 50);

  // Sincronização assíncrona com backend / banco de dados
  loadStats();
  loadOccurrences();

  // Atualização em tempo real dos gráficos e mapas ao alternar temas
  window.addEventListener('orbenk:theme-change', () => {
    const s = OrbenkStorage.computeStats();
    if (s && window.Chart) renderIntelligentCharts(s);
  });

  // Garante re-renderização se o usuário voltar para a aba ou redimensionar
  window.addEventListener('pageshow', () => {
    const s = OrbenkStorage.computeStats();
    if (s && window.Chart) renderIntelligentCharts(s);
  });
});

// ── Mapa Tático Geoespacial em Movimento Contínuo no Dashboard ──────────
function initDashboardBackgroundMap() {
  const mapEl = document.getElementById('dashboard-bg-map');
  const telemetryEl = document.getElementById('dash-geo-telemetry');
  if (!mapEl || !window.L) return;

  const tacticalZones = [
    { name: 'CENTRAL ORBENK // CENTRO CÍVICO', lat: -26.3044, lon: -48.8464, alert: false },
    { name: 'DISTRITO INDUSTRIAL NORTE // PERINI', lat: -26.2425, lon: -48.8802, alert: true },
    { name: 'SETOR AMÉRICA // POLO CORPORATIVO', lat: -26.2865, lon: -48.8548, alert: false },
    { name: 'CORREDOR LOGÍSTICO BR-101 SUL', lat: -26.3410, lon: -48.8590, alert: true },
    { name: 'SETOR BUCAREIN // UNIDADE BANCÁRIA', lat: -26.3168, lon: -48.8362, alert: false },
    { name: 'ZONA LESTE // BOA VISTA & COMASA', lat: -26.2920, lon: -48.8140, alert: false },
  ];

  const dashMap = window.L.map('dashboard-bg-map', {
    center: [tacticalZones[0].lat, tacticalZones[0].lon],
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
  }).addTo(dashMap);

  const hubCoord = [tacticalZones[0].lat, tacticalZones[0].lon];

  // Plota as ocorrências reais registradas no banco de dados
  const allOccs = OrbenkStorage.load() || [];
  allOccs.forEach(occ => {
    if (!occ.lat || !occ.lon) return;
    const isCritical = occ.status === 'em_andamento';
    const icon = window.L.divIcon({
      className: '',
      html: `
        <div class="dash-map-node">
          <div class="dash-node-dot ${isCritical ? 'alert' : ''}"></div>
          <div class="dash-node-label">${occ.protocol} · ${(occ.client || '').slice(0, 18)}</div>
        </div>`,
      iconAnchor: [5, 5],
    });
    window.L.marker([occ.lat, occ.lon], { icon }).addTo(dashMap);
    window.L.polyline([hubCoord, [occ.lat, occ.lon]], {
      color: isCritical ? '#ef4444' : '#00e5ff',
      weight: 1.4,
      opacity: 0.45,
      dashArray: '5, 7',
    }).addTo(dashMap);
  });

  // Plota setores estratégicos complementares com anéis de radar
  tacticalZones.forEach(zone => {
    window.L.circle([zone.lat, zone.lon], {
      radius: zone.alert ? 380 : 280,
      color: zone.alert ? '#f59e0b' : '#00e5ff',
      weight: 1.2,
      fillOpacity: 0.06,
    }).addTo(dashMap);
  });

  // Viatura de Patrulha Tática VTR-04 em Movimento Contínuo
  const vtrIcon = window.L.divIcon({
    className: '',
    html: `
      <div class="dash-map-node">
        <div class="dash-node-dot" style="background:#10b981;box-shadow:0 0 14px #10b981;"></div>
        <div class="dash-node-label" style="border-color:#10b981;color:#10b981;font-weight:900;">⚡ VTR-04 EM RONDA</div>
      </div>`,
    iconAnchor: [5, 5],
  });
  const vtrMarker = window.L.marker(hubCoord, { icon: vtrIcon }).addTo(dashMap);

  let angle = 0;
  let zoneIdx = 0;
  let vtrProgress = 0;

  // Deriva suave contínua em 60fps (órbita tática de fundo)
  setInterval(() => {
    angle += 0.018;
    const dx = Math.cos(angle) * 0.7;
    const dy = Math.sin(angle * 0.8) * 0.55;
    dashMap.panBy([dx, dy], { animate: false });

    // Deslocamento da VTR-04 entre setores
    vtrProgress = (vtrProgress + 0.0025) % 1;
    const targetZone = tacticalZones[(zoneIdx + 1) % tacticalZones.length];
    const originZone = tacticalZones[zoneIdx];
    const curLat = originZone.lat + (targetZone.lat - originZone.lat) * vtrProgress;
    const curLon = originZone.lon + (targetZone.lon - originZone.lon) * vtrProgress;
    vtrMarker.setLatLng([curLat, curLon]);
  }, 45);

  // Transição de foco tático entre zonas estratégicas
  setInterval(() => {
    zoneIdx = (zoneIdx + 1) % tacticalZones.length;
    const z = tacticalZones[zoneIdx];
    dashMap.panTo([z.lat, z.lon], {
      animate: true,
      duration: 6.5,
      easeLinearity: 0.15,
    });
    if (telemetryEl) {
      telemetryEl.textContent = `SAT-LINK ATIVO // ${z.name} (${z.lat.toFixed(4)}°, ${z.lon.toFixed(4)}°)`;
    }
  }, 8500);

  window.addEventListener('orbenk:sidebar-toggle', () => {
    setTimeout(() => dashMap.invalidateSize(true), 120);
    setTimeout(() => dashMap.invalidateSize(true), 420);
  });
}

// ── Estatísticas e Indicadores Estratégicos ─────────────────────────────
async function loadStats() {
  try {
    const data = await stats.get();
    if (!data) return;
    renderKPIs(data);
    renderIntelligentCharts(data);
    updateFilterCounts(data);
  } catch (err) {
    console.warn('Erro ao carregar estatísticas:', err);
  }
}

function renderKPIs(data) {
  const totalEl = document.getElementById('stat-total');
  const totalSubEl = document.getElementById('stat-total-sub');
  const activeEl = document.getElementById('stat-active');
  const activeSubEl = document.getElementById('stat-active-sub');
  const slaEl = document.getElementById('stat-sla');
  const slaAvgEl = document.getElementById('stat-sla-avg');
  const lifeEl = document.getElementById('stat-life');
  const lifeSubEl = document.getElementById('stat-life-sub');

  const byStatus = data.occurrences_by_status || {};
  if (totalEl) animateCount(totalEl, data.total_occurrences || 0);
  if (totalSubEl) {
    totalSubEl.textContent = `Hoje: ${data.today_count || 0} · Últimos 7 dias: ${data.recent_7_days || 0}`;
  }

  if (activeEl) animateCount(activeEl, byStatus.em_andamento || 0);
  if (activeSubEl) {
    activeSubEl.innerHTML = `<span class="status-dot red"></span> ${byStatus.concluida || 0} concluídas · ${byStatus.arquivada || 0} arquivadas`;
  }

  const slaPct = data.sla_compliance_pct !== null && data.sla_compliance_pct !== undefined
    ? `${data.sla_compliance_pct}%`
    : (data.sla_compliance_rate || '—');
  const avgMins = data.avg_response_minutes !== null && data.avg_response_minutes !== undefined
    ? `${data.avg_response_minutes} min`
    : (data.avg_response_time || '—');

  if (slaEl) slaEl.textContent = slaPct;
  if (slaAvgEl) slaAvgEl.textContent = avgMins;

  const pt = data.post_trauma || {};
  const preservedPct = pt.scene_preserved_pct !== null && pt.scene_preserved_pct !== undefined
    ? `${pt.scene_preserved_pct}%`
    : '100%';
  if (lifeEl) {
    lifeEl.textContent = preservedPct;
    lifeEl.className = `stat-value ${(pt.fatalities > 0 || pt.weapons_stolen > 0) ? 'text-amber' : 'text-green'}`;
  }
  if (lifeSubEl) {
    lifeSubEl.textContent = `${pt.victims || 0} ferido(s) · ${pt.fatalities || 0} óbito(s) · ${pt.weapons_stolen || 0} arma(s) subtraída(s)`;
  }
}

function animateCount(el, target) {
  const duration = 650;
  const steps = 20;
  const stepTime = duration / steps;
  const increment = target / steps;
  let current = 0;

  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      el.textContent = Math.round(target).toLocaleString('pt-BR');
      clearInterval(timer);
    } else {
      el.textContent = Math.round(current).toLocaleString('pt-BR');
    }
  }, stepTime);
}

function updateFilterCounts(data) {
  const byStatus = data.occurrences_by_status || {};
  const total = data.total_occurrences || 0;
  
  document.querySelectorAll('.filter-pill').forEach(pill => {
    const st = pill.dataset.status;
    if (!st) {
      pill.textContent = `TODOS (${total})`;
    } else if (st === 'em_andamento') {
      pill.textContent = `EM ANDAMENTO (${byStatus.em_andamento || 0})`;
    } else if (st === 'concluida') {
      pill.textContent = `CONCLUÍDAS (${byStatus.concluida || 0})`;
    } else if (st === 'arquivada') {
      pill.textContent = `ARQUIVADAS (${byStatus.arquivada || 0})`;
    }
  });
}

// ── Matriz de Inteligência Gráfica (4 Gráficos Dinâmicos) ──────────────
function getThemeChartTextColor() {
  const theme = document.documentElement.getAttribute('data-theme') || 'noturno';
  if (theme === 'claro') return '#0f172a'; // Contraste máximo no Claro
  if (theme === 'cyber') return '#ffffff'; // Neon branco nítido no Cyber
  if (theme === 'escuro') return '#f8fafc'; // Branco brilhante no Escuro
  return '#f1f5f9'; // Branco nítido no Noturno
}

function getThemeChartMutedColor() {
  const theme = document.documentElement.getAttribute('data-theme') || 'noturno';
  if (theme === 'claro') return '#334155';
  if (theme === 'cyber') return '#e2e8f0';
  return '#94a3b8';
}

function renderIntelligentCharts(data) {
  if (!window.Chart || !data) return;

  const textColor = getThemeChartTextColor();
  const mutedColor = getThemeChartMutedColor();

  const PALETTE = {
    blue: '#1d6ed8',
    cyan: '#00d4ff',
    green: '#00ff88',
    amber: '#ffb800',
    red: '#ff3b3b',
    purple: '#a855f7',
    teal: '#06b6d4',
    indigo: '#6366f1',
    pink: '#ec4899',
    slate: '#94a3b8'
  };

  const chartThemeColors = [
    PALETTE.cyan, PALETTE.green, PALETTE.amber, PALETTE.blue,
    PALETTE.red, PALETTE.purple, PALETTE.teal, PALETTE.indigo,
    PALETTE.pink, PALETTE.slate
  ];

  // 1. Gráfico de Evolução Temporal (Últimos 12 Meses) — Linha/Área Reativa
  const monthlyCanvas = document.getElementById('chartMonthly');
  if (monthlyCanvas) {
    if (chartMonthlyInstance) chartMonthlyInstance.destroy();
    
    const months = data.occurrences_by_month || [];
    const labels = months.map(m => {
      const parts = (m.month || '').split('-');
      if (parts.length < 2) return m.month;
      const mNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${mNames[parseInt(parts[1], 10) - 1]}/${parts[0].slice(2)}`;
    });
    const values = months.map(m => m.count || 0);
    const totalAccum = values.reduce((a, b) => a + b, 0);

    const ctx = monthlyCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.45)');
    gradient.addColorStop(1, 'rgba(21, 87, 166, 0.0)');

    chartMonthlyInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Chamados Operacionais',
          data: values,
          fill: true,
          backgroundColor: gradient,
          borderColor: PALETTE.cyan,
          borderWidth: 2.8,
          pointBackgroundColor: '#07152b',
          pointBorderColor: PALETTE.cyan,
          pointBorderWidth: 2.5,
          pointRadius: 4.5,
          pointHoverRadius: 9,
          pointHoverBorderWidth: 3.5,
          pointHoverBorderColor: '#ffffff',
          pointHoverBackgroundColor: PALETTE.cyan,
          tension: 0.42
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 900,
          easing: 'easeOutQuart'
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(7, 21, 43, 0.92)',
            titleColor: '#00d4ff',
            bodyColor: '#ffffff',
            borderColor: '#00d4ff',
            borderWidth: 1.5,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw || 0;
                const pct = totalAccum > 0 ? ((val / totalAccum) * 100).toFixed(1) : 0;
                return ` ${val} ocorrência(s) (${pct}% do período)`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(148,163,184,0.1)' },
            ticks: { color: mutedColor, font: { size: 10.5, family: 'Inter', weight: '700' } }
          },
          y: {
            grid: { color: 'rgba(148,163,184,0.1)' },
            ticks: { color: mutedColor, font: { size: 10.5, family: 'Inter', weight: '700' }, stepSize: 1 },
            beginAtZero: true
          }
        }
      }
    });
  }

  // 2. Gráfico de Tipologia & Participação Percentual (Donut Interativo Hiper-Reativo)
  const typesCanvas = document.getElementById('chartTypes');
  if (typesCanvas) {
    if (chartTypesInstance) chartTypesInstance.destroy();

    const typesObj = data.occurrences_by_type || {};
    const sortedEntries = Object.entries(typesObj).sort((a, b) => b[1] - a[1]);
    const labels = sortedEntries.map(([k]) => k);
    const values = sortedEntries.map(([, v]) => v);
    const totalTypes = values.reduce((a, b) => a + b, 0);

    const ctx = typesCanvas.getContext('2d');
    chartTypesInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: chartThemeColors.slice(0, labels.length),
          borderColor: 'transparent',
          borderWidth: 2,
          hoverOffset: 22,
          hoverBorderWidth: 3.5,
          hoverBorderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 950,
          easing: 'easeOutQuart'
        },
        onHover: (event, chartElement) => {
          const target = event?.native?.target;
          if (target) target.style.cursor = chartElement.length ? 'pointer' : 'default';
        },
        onClick: (_evt, elements) => {
          if (elements && elements.length > 0) {
            const idx = elements[0].index;
            const clickedType = labels[idx];
            const filterTypeEl = document.getElementById('filterType');
            if (currentType === clickedType) {
              currentType = '';
              if (filterTypeEl) filterTypeEl.value = '';
              showToast('Filtro de natureza removido', 'info', 2000);
            } else {
              currentType = clickedType;
              if (filterTypeEl) filterTypeEl.value = clickedType;
              showToast(`Filtrando por: ${clickedType}`, 'info', 2200);
            }
            currentPage = 1;
            loadOccurrences();
          }
        },
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: textColor,
              font: { size: 11.5, family: 'Inter', weight: '700' },
              padding: 9,
              boxWidth: 12,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              generateLabels: (chart) => {
                const d = chart.data;
                return d.labels.map((lbl, idx) => {
                  const val = d.datasets[0].data[idx] || 0;
                  const pct = totalTypes > 0 ? ((val / totalTypes) * 100).toFixed(1) : 0;
                  const shortLbl = lbl.length > 25 ? lbl.slice(0, 23) + '…' : lbl;
                  return {
                    text: `${shortLbl} (${pct}%)`,
                    fillStyle: d.datasets[0].backgroundColor[idx],
                    strokeStyle: '#ffffff',
                    lineWidth: 1,
                    fontColor: textColor,
                    index: idx
                  };
                });
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(7, 21, 43, 0.94)',
            titleColor: '#00d4ff',
            bodyColor: '#ffffff',
            borderColor: '#00d4ff',
            borderWidth: 1.5,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw || 0;
                const pct = totalTypes > 0 ? ((val / totalTypes) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${val} registro(s) (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // 3. Gráfico de Auditoria de SLA & Tempos Reais de Resposta por Turno
  const slaCanvas = document.getElementById('chartSla');
  if (slaCanvas) {
    if (chartSlaInstance) chartSlaInstance.destroy();

    const diurnoAvg = data.sla_by_shift?.Diurno ?? data.avg_response_minutes ?? 8.0;
    const noturnoAvg = data.sla_by_shift?.Noturno ?? data.avg_response_minutes ?? 8.5;
    const overallAvg = data.avg_response_minutes ?? 8.2;

    const ctx = slaCanvas.getContext('2d');
    chartSlaInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Turno Diurno (Real)', 'Turno Noturno (Real)', 'Média Geral', 'Teto SLA Contratual'],
        datasets: [{
          label: 'Tempo Médio (minutos)',
          data: [diurnoAvg, noturnoAvg, overallAvg, 12.0],
          backgroundColor: [
            'rgba(0, 212, 255, 0.75)',
            'rgba(0, 255, 136, 0.75)',
            'rgba(29, 110, 216, 0.75)',
            'rgba(255, 59, 59, 0.45)'
          ],
          borderColor: [
            PALETTE.cyan,
            PALETTE.green,
            PALETTE.blue,
            PALETTE.red
          ],
          borderWidth: 2,
          borderRadius: 6,
          hoverBorderWidth: 3.5,
          hoverBorderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 850, easing: 'easeOutQuart' },
        onHover: (event, chartElement) => {
          const target = event?.native?.target;
          if (target) target.style.cursor = chartElement.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(7, 21, 43, 0.94)',
            titleColor: '#00d4ff',
            bodyColor: '#ffffff',
            borderColor: '#00d4ff',
            borderWidth: 1.5,
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.raw} minutos de tempo médio`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 10.5, family: 'Inter', weight: '700' } }
          },
          y: {
            grid: { color: 'rgba(148,163,184,0.1)' },
            ticks: {
              color: mutedColor,
              font: { size: 10.5, family: 'Inter', weight: '600' },
              callback: (v) => `${v} min`
            },
            beginAtZero: true,
            suggestedMax: 15
          }
        }
      }
    });
  }

  // 4. Gráfico de Mapeamento de Postos Críticos / Clientes (Barras Horizontais Reativas)
  const clientsCanvas = document.getElementById('chartClients');
  if (clientsCanvas) {
    if (chartClientsInstance) chartClientsInstance.destroy();

    const clientsList = data.most_affected_clients || [];
    const totalClientsCount = clientsList.reduce((acc, c) => acc + (c.count || 0), 0);
    const labels = clientsList.map(c => {
      const name = c.client || 'Posto';
      return name.length > 25 ? name.substring(0, 23) + '…' : name;
    });
    const values = clientsList.map(c => c.count || 0);

    const ctx = clientsCanvas.getContext('2d');
    chartClientsInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Acionamentos',
          data: values,
          backgroundColor: 'rgba(29, 110, 216, 0.72)',
          borderColor: PALETTE.cyan,
          borderWidth: 2,
          borderRadius: 6,
          hoverBorderWidth: 3,
          hoverBorderColor: '#ffffff',
          hoverBackgroundColor: 'rgba(0, 212, 255, 0.85)'
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 850, easing: 'easeOutQuart' },
        onHover: (event, chartElement) => {
          const target = event?.native?.target;
          if (target) target.style.cursor = chartElement.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(7, 21, 43, 0.94)',
            titleColor: '#00d4ff',
            bodyColor: '#ffffff',
            borderColor: '#00d4ff',
            borderWidth: 1.5,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const v = ctx.raw || 0;
                const pct = totalClientsCount > 0 ? ((v / (data.total_occurrences || totalClientsCount)) * 100).toFixed(1) : 0;
                return ` ${v} acionamento(s) (${pct}% da base)`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(148,163,184,0.1)' },
            ticks: { color: mutedColor, font: { size: 10.5, family: 'Inter', weight: '600' }, stepSize: 1 },
            beginAtZero: true
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 10.5, family: 'Inter', weight: '700' } }
          }
        }
      }
    });
  }
}

// ── Tabela Tática de Ocorrências ───────────────────────────────────────
async function loadOccurrences() {
  const tbody = document.getElementById('occurrences-tbody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">
        <div class="spinner" style="margin:0 auto 10px;"></div>
        Carregando ocorrências e laudos periciais...
      </td>
    </tr>`;

  try {
    const res = await occurrences.list({
      search: currentSearch,
      status: currentFilter,
      type: currentType,
      shift: currentShift,
      severity: currentSeverity,
      page: currentPage,
      limit: itemsPerPage
    });

    const items = res?.items || [];
    const total = res?.total || 0;
    const pages = res?.pages || 1;

    renderTable(items, tbody);
    renderPagination(pages, total);
  } catch (err) {
    console.error('Erro ao listar ocorrências:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:32px; color:var(--accent-red);">
          ⚠ Falha ao consultar registros operacionais. Tente atualizar a página.
        </td>
      </tr>`;
  }
}

function renderTable(items, tbody) {
  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">
          Nenhuma ocorrência encontrada para os filtros selecionados.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(occ => {
    const typesList = Array.isArray(occ.occurrence_types) ? occ.occurrence_types : [occ.occurrence_types || 'Geral'];
    const typesHtml = typesList.slice(0, 2).map(t => 
      `<span class="badge badge-blue" style="font-size:10px; margin-right:4px;">${escapeHtml(t)}</span>`
    ).join('') + (typesList.length > 2 ? `<span class="badge badge-gray" style="font-size:9px;">+${typesList.length - 2}</span>` : '');

    const dataFormatada = formatDate(occ.occurrence_date);
    const shiftIcon = occ.shift === 'Noturno' ? '🌙' : '☀️';

    // Gravidade calculada dinamicamente
    const sev = computeSeverity(occ);
    const sevBadge = `<span class="badge ${sev.cls}" style="font-size:10px;">NV.${sev.level} · ${sev.label}</span>`;

    // SLA Badge usando parseMinutes universal
    const slaMins = parseMinutes(occ.total_attendance_time);
    const slaDisplay = slaMins !== null ? `${slaMins} min` : (occ.total_attendance_time || '—');
    const slaBadge = (slaMins === null || slaMins <= 12)
      ? `<span class="badge badge-green" title="Tempo de resposta em conformidade (≤ 12 min)">⏱ ${escapeHtml(slaDisplay)} (OK)</span>`
      : `<span class="badge badge-amber" title="Tempo excedeu a meta de 12 minutos">⏱ ${escapeHtml(slaDisplay)} (>12m)</span>`;

    return `
      <tr class="occurrence-row" data-id="${occ.id}" style="cursor:pointer;" title="Clique para inspecionar o dossiê rápido">
        <td>
          <a href="occurrence.html?id=${occ.id}" class="font-mono text-cyan" style="font-weight:700; text-decoration:none;" onclick="event.stopPropagation();" title="Abrir Dossiê Completo">
            ${escapeHtml(occ.protocol || `OBK-${occ.id}`)}
          </a>
        </td>
        <td style="font-size:12px; font-family:var(--font-mono); color:var(--text-secondary);">
          <div>${escapeHtml(dataFormatada)} ${escapeHtml(occ.occurrence_time || '')}</div>
          <div class="text-xs text-muted">${shiftIcon} ${escapeHtml(occ.shift || '—')}</div>
        </td>
        <td>
          <div style="font-weight:600; color:var(--text-primary); font-size:13px;">${escapeHtml(occ.client || '—')}</div>
          <div class="text-xs text-muted" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px;">
            ${escapeHtml(occ.address || occ.city || '')}
          </div>
        </td>
        <td>${typesHtml}</td>
        <td>${sevBadge}</td>
        <td>${slaBadge}</td>
        <td>${statusBadge(occ.status)}</td>
        <td style="text-align:right; white-space:nowrap;" onclick="event.stopPropagation();">
          <div style="display:inline-flex; gap:6px; align-items:center;">
            <a href="occurrence.html?id=${occ.id}" class="btn btn-ghost btn-sm" title="Abrir Dossiê Completo">
              👁
            </a>
            <a href="form.html?id=${occ.id}" class="btn btn-ghost btn-sm" title="Editar Registro">
              ✎
            </a>
            <button type="button" class="btn btn-primary btn-sm btn-print-laudo" data-id="${occ.id}" title="Emitir Laudo Pericial Oficial (PDF)">
              📄 LAUDO
            </button>
            <button type="button" class="btn btn-ghost btn-sm btn-delete-row text-red" data-id="${occ.id}" data-protocol="${escapeHtml(occ.protocol || '')}" title="Excluir Ocorrência">
              🗑
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Clique na linha abre o Modal de Inspeção Rápida
  tbody.querySelectorAll('.occurrence-row').forEach(row => {
    row.addEventListener('click', () => {
      const occ = items.find(o => String(o.id) === String(row.dataset.id));
      if (occ) openPreviewModal(occ);
    });
  });

  // Listeners para botões de laudo
  tbody.querySelectorAll('.btn-print-laudo').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const occ = items.find(o => String(o.id) === String(id));
      if (occ) {
        showToast('Gerando Laudo Oficial com Amparo Jurídico...', 'info');
        printOfficialReport(occ);
      }
    });
  });

  // Listeners para botões de exclusão
  tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(btn.dataset.id, btn.dataset.protocol);
    });
  });
}

// ── Modal de Pré-Visualização Rápida do Dossiê ─────────────────────────
function openPreviewModal(occ) {
  previewOccurrence = occ;
  const modal = document.getElementById('preview-modal');
  if (!modal) return;

  const sev = computeSeverity(occ);
  document.getElementById('prev-protocol').textContent = occ.protocol || `OBK-${occ.id}`;
  document.getElementById('prev-status').innerHTML = statusBadge(occ.status);
  document.getElementById('prev-severity').innerHTML = `<span class="badge ${sev.cls}">GRAVIDADE ${sev.label}</span>`;

  const stSelect = document.getElementById('prev-status-select');
  if (stSelect) stSelect.value = occ.status || 'em_andamento';

  document.getElementById('prev-btn-full').href = `occurrence.html?id=${occ.id}`;
  document.getElementById('prev-btn-edit').href = `form.html?id=${occ.id}`;

  const types = (occ.occurrence_types || []).join(' · ') || '—';
  const services = (occ.contracted_services || []).join(' · ') || '—';
  const auths = (occ.authorities || []).join(', ') || 'Nenhuma acionada';

  document.getElementById('prev-body').innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:14px; background:var(--bg-input); padding:12px; border-radius:6px; border:1px solid var(--border);">
      <div>
        <div class="text-xs text-muted font-mono">CONTRATANTE / POSTO</div>
        <div style="font-weight:700; color:var(--text-primary);">${escapeHtml(occ.client || '—')}</div>
        <div class="text-xs text-muted">${escapeHtml(occ.address || '')} (${escapeHtml(occ.city || '')})</div>
      </div>
      <div>
        <div class="text-xs text-muted font-mono">CRONOLOGIA &amp; RESPOSTA</div>
        <div style="font-weight:700; color:var(--text-primary);">${formatDate(occ.occurrence_date)} às ${escapeHtml(occ.occurrence_time || '—')} (${escapeHtml(occ.shift || '—')})</div>
        <div class="text-xs text-cyan">Acionamento: ${escapeHtml(occ.alarm_trigger_time || '—')} · Chegada: ${escapeHtml(occ.attendant_arrival_time || '—')} · SLA: ${escapeHtml(occ.total_attendance_time || '—')}</div>
      </div>
      <div>
        <div class="text-xs text-muted font-mono">NATUREZA DO EVENTO</div>
        <div style="font-weight:600;">${escapeHtml(types)}</div>
      </div>
      <div>
        <div class="text-xs text-muted font-mono">SERVIÇOS &amp; AUTORIDADES</div>
        <div class="text-xs">${escapeHtml(services)}</div>
        <div class="text-xs text-muted">Autoridades: ${escapeHtml(auths)} ${occ.bo_number ? `· <strong>${escapeHtml(occ.bo_number)}</strong>` : ''}</div>
      </div>
      <div>
        <div class="text-xs text-muted font-mono">PESSOAS &amp; VÍTIMAS</div>
        <div class="text-xs">${occ.had_victims ? `⚠ ${occ.victim_count || 1} vítima(s) (${escapeHtml(occ.victim_severity || 'Em avaliação')})` : '✔ Sem feridos registrados'}</div>
      </div>
      <div>
        <div class="text-xs text-muted font-mono">EFETIVO &amp; LEI 7.102/83</div>
        <div class="text-xs">${occ.guard_on_site ? `Vigilante: ${escapeHtml(occ.guard_name || 'No posto')} ${occ.weapon_stolen ? '· <span class="text-red font-bold">ARMA SUBTRAÍDA</span>' : '· Armamento regular'}` : 'Posto sem vigilância presencial fixa'}</div>
      </div>
    </div>
    <div>
      <div class="text-xs text-muted font-mono" style="margin-bottom:4px;">RELATO CIRCUNSTANCIADO DOS FATOS</div>
      <div style="background:var(--bg-input); border:1px solid var(--border); border-radius:6px; padding:10px 12px; font-size:12.5px; white-space:pre-wrap;">${escapeHtml(occ.narrative || 'Sem relato cadastrado.')}</div>
    </div>
  `;

  modal.style.display = 'flex';
}

function closePreviewModal() {
  previewOccurrence = null;
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'none';
}

// ── Exportação de Planilha CSV ─────────────────────────────────────────
function exportFilteredCSV() {
  try {
    const res = OrbenkStorage.list({
      search: currentSearch,
      status: currentFilter,
      type: currentType,
      shift: currentShift,
      severity: currentSeverity,
      page: 1,
      limit: 10000
    });
    const rows = res.items || [];
    if (!rows.length) {
      showToast('Nenhum registro para exportar nos filtros atuais.', 'warning');
      return;
    }

    const headers = [
      'Protocolo', 'Data', 'Hora', 'Turno', 'Status', 'Gravidade',
      'Cliente', 'Cidade', 'Endereco', 'Tipos_Evento', 'Tempo_Resposta',
      'Vitimas', 'Qtd_Vitimas', 'Vigilante_Posto', 'Arma_Subtraida', 'Local_Preservado_CPP', 'BO_Policial'
    ];
    const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(';')];

    rows.forEach(o => {
      const sev = computeSeverity(o);
      lines.push([
        o.protocol,
        o.occurrence_date,
        o.occurrence_time,
        o.shift,
        o.status,
        sev.label,
        o.client,
        o.city,
        o.address,
        (o.occurrence_types || []).join(' | '),
        o.total_attendance_time,
        o.had_victims ? 'SIM' : 'NAO',
        o.victim_count || 0,
        o.guard_name || (o.guard_on_site ? 'SIM' : 'NAO'),
        o.weapon_stolen ? 'SIM' : 'NAO',
        o.crime_scene_preserved ? 'SIM' : 'NAO',
        o.bo_number || ''
      ].map(csvCell).join(';'));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orbenk-ocorrencias-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Planilha CSV exportada (${rows.length} registros).`, 'success');
  } catch (err) {
    showToast(`Falha ao exportar CSV: ${err.message}`, 'error');
  }
}

function renderPagination(totalPages, totalItems) {
  const container = document.getElementById('pagination');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = `<span class="text-xs text-muted">${totalItems} registro(s) encontrado(s)</span>`;
    return;
  }

  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:12px;">
      <span class="text-xs text-muted font-mono" style="font-weight:700;">
        Página <strong class="text-cyan">${currentPage}</strong> de ${totalPages} (${totalItems} ocorrências)
      </span>
      <div class="pagination-controls">
        <button class="page-btn page-btn-nav" ${currentPage === 1 ? 'disabled' : ''} id="btn-prev-page">‹ Anterior</button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }

  html += `
        <button class="page-btn page-btn-nav" ${currentPage === totalPages ? 'disabled' : ''} id="btn-next-page">Próxima ›</button>
      </div>
    </div>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.page-btn[data-page]').forEach(b => {
    b.addEventListener('click', () => {
      currentPage = parseInt(b.dataset.page, 10);
      loadOccurrences();
    });
  });

  document.getElementById('btn-prev-page')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadOccurrences();
    }
  });

  document.getElementById('btn-next-page')?.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadOccurrences();
    }
  });
}

// ── Modal de Exclusão ─────────────────────────────────────────────────
function openDeleteModal(id, protocol) {
  deleteTargetId = id;
  const modal = document.getElementById('delete-modal');
  const protocolEl = document.getElementById('delete-protocol');
  if (protocolEl) protocolEl.textContent = protocol || `ID #${id}`;
  if (modal) modal.style.display = 'flex';
}

function closeDeleteModal() {
  deleteTargetId = null;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.style.display = 'none';
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  const btn = document.getElementById('btn-confirm-delete');
  if (btn) btn.disabled = true;

  try {
    await occurrences.delete(deleteTargetId);
    showToast('Ocorrência excluída com sucesso!', 'success');
    closeDeleteModal();
    loadStats();
    loadOccurrences();
  } catch (err) {
    showToast(`Erro ao excluir: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


