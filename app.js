/**
 * Cronograma de Guardias — App Logic
 * Multi-agent registration + batch Google Calendar upload
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, setDoc, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC9WliyMGH8ovRFD8XjrqOv7Y06rdbWzMs",
  authDomain: "guardias-8d35d.firebaseapp.com",
  projectId: "guardias-8d35d",
  storageBucket: "guardias-8d35d.firebasestorage.app",
  messagingSenderId: "745431499410",
  appId: "1:745431499410:web:12c75b9da8be8327a2dc4b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const guardsCollection = collection(db, "guards");

(function () {
  'use strict';

  // ──────────────────────────────────
  // Constants & State
  // ──────────────────────────────────
  const STORAGE_KEY = 'guardias_data';
  const CALENDAR_LINK_KEY = 'guardias_calendar_url';

  let guards = [];
  let deleteTargetId = null;
  let rotationData = { agents: [], currentIndex: 0 };

  // ──────────────────────────────────
  // DOM References
  // ──────────────────────────────────
  const guardForm = document.getElementById('guard-form');
  const agentNameInput = document.getElementById('agent-name');
  const startDateInput = document.getElementById('start-date');
  const endDateInput = document.getElementById('end-date');
  const startTimeInput = document.getElementById('start-time');
  const endTimeInput = document.getElementById('end-time');
  const registerBtn = document.getElementById('register-btn');
  const uploadAllCalendarBtn = document.getElementById('upload-all-calendar-btn');
  const resetBtn = document.getElementById('form-reset-btn');
  const tableContent = document.getElementById('table-content');
  const tableBadge = document.getElementById('table-badge');
  const toastContainer = document.getElementById('toast-container');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCancel = document.getElementById('modal-cancel');
  const modalConfirm = document.getElementById('modal-confirm');

  // Config Bar
  const calendarLinkInput = document.getElementById('calendar-link');
  const saveCalendarBtn = document.getElementById('save-calendar-btn');
  const calendarStatus = document.getElementById('calendar-status');

  // Rotation
  const rotationList = document.getElementById('rotation-list');
  const rotationForm = document.getElementById('rotation-form');
  const newRotationAgent = document.getElementById('new-rotation-agent');

  // Stats
  const statTotal = document.getElementById('stat-total');
  const statAgents = document.getElementById('stat-agents');
  const statActive = document.getElementById('stat-active');
  const statUpcoming = document.getElementById('stat-upcoming');

  // ──────────────────────────────────
  // Initialization
  // ──────────────────────────────────
  function init() {
    loadGuards(); // This sets up the real-time Firebase listener
    loadRotation(); // Listen to rotation config
    loadCalendarUrl();
    bindEvents();
    setDefaultDates();
  }

  function setDefaultDates() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const formatDt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (!startDateInput.value) startDateInput.value = formatDt(today);
    if (!endDateInput.value) endDateInput.value = formatDt(tomorrow);
  }

  function bindEvents() {
    guardForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleRegister();
    });
    if (rotationForm) {
      rotationForm.addEventListener('submit', handleAddRotationAgent);
    }
    uploadAllCalendarBtn.addEventListener('click', handleUploadAllToCalendar);
    resetBtn.addEventListener('click', handleReset);
    saveCalendarBtn.addEventListener('click', handleSaveCalendar);
    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', handleConfirmDelete);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    // Auto-advance end date to next day based on static times
    startDateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        const [y, m, d] = e.target.value.split('-');
        const nextDay = new Date(y, m - 1, d);
        nextDay.setDate(nextDay.getDate() + 1);
        const y2 = nextDay.getFullYear();
        const m2 = String(nextDay.getMonth() + 1).padStart(2, '0');
        const d2 = String(nextDay.getDate()).padStart(2, '0');
        endDateInput.value = `${y2}-${m2}-${d2}`;
      }
    });
  }

  // ──────────────────────────────────
  // Calendar URL Config
  // ──────────────────────────────────
  function loadCalendarUrl() {
    const rawUrl = localStorage.getItem(CALENDAR_LINK_KEY) || '';
    if (calendarLinkInput) calendarLinkInput.value = rawUrl;
    updateCalendarStatus(!!rawUrl);
  }

  function handleSaveCalendar() {
    let val = calendarLinkInput.value.trim();
    if (!val) {
      localStorage.removeItem(CALENDAR_LINK_KEY);
      updateCalendarStatus(false);
      showToast('Configuración de calendar eliminada', 'info');
      return;
    }

    // Try to extract the src parameter, otherwise save the raw value
    let srcMatch = val.match(/src=([^&"'>]+)/);
    let finalVal = srcMatch ? decodeURIComponent(srcMatch[1]) : val;

    localStorage.setItem(CALENDAR_LINK_KEY, finalVal);
    calendarLinkInput.value = finalVal;
    updateCalendarStatus(true);
    showToast('Calendario configurado', 'success');
  }

  function updateCalendarStatus(connected) {
    if (!calendarStatus) return;
    calendarStatus.className = 'config-bar__status ' +
      (connected ? 'config-bar__status--connected' : 'config-bar__status--disconnected');
    calendarStatus.title = connected ? 'Calendario configurado' : 'Sin calendar configurado';
  }

  // ──────────────────────────────────
  // Firebase Sync
  // ──────────────────────────────────
  function loadRotation() {
    onSnapshot(doc(db, "config", "rotation"), (document) => {
      if (document.exists()) {
        rotationData = document.data();
        if (!rotationData.agents) rotationData.agents = [];
      } else {
        // Inicializar si no existe
        rotationData = {
          agents: ["@Nicolas", "@jld", "@Yaz", "@Bruno", "@Guillermo", "@lappiolaza", "@LeoFarra", "@ccastellaro"],
          currentIndex: 3 // Bruno
        };
        setDoc(doc(db, "config", "rotation"), rotationData);
      }
      renderRotationList();
    }, (error) => {
      console.error("Error cargando rotación:", error);
    });
  }

  function renderRotationList() {
    if (!rotationList) return;
    rotationList.innerHTML = rotationData.agents.map((agent, index) => {
      const isCurrent = index === rotationData.currentIndex;
      return `<li style="margin-bottom:0.5rem; ${isCurrent ? 'font-weight: bold; color: #3b82f6;' : ''}">
        ${escapeHtml(agent)} ${isCurrent ? '<span style="font-size:0.7em; background:#3b82f6; color:#fff; padding:2px 6px; border-radius:4px; margin-left:8px;">Guardia Actual</span>' : ''}
      </li>`;
    }).join('');
  }

  async function handleAddRotationAgent(e) {
    e.preventDefault();
    if (!newRotationAgent) return;
    let newAgent = newRotationAgent.value.trim();
    if (!newAgent) return;

    if (!newAgent.startsWith('@')) newAgent = '@' + newAgent;

    try {
      const newAgents = [...rotationData.agents, newAgent];
      await updateDoc(doc(db, "config", "rotation"), {
        agents: newAgents
      });
      newRotationAgent.value = '';
      showToast('Agente agregado a la rotación', 'success');
    } catch (error) {
      console.error('Error agregando agente:', error);
      showToast('Error al agregar el agente', 'error');
    }
  }

  function loadGuards() {
    onSnapshot(guardsCollection, (snapshot) => {
      guards = snapshot.docs.map(document => document.data());
      renderTable();
      updateStats();
    });
  }

  async function saveGuardToFirebase(guard) {
    try {
      await setDoc(doc(db, "guards", guard.id), guard);
    } catch (error) {
      console.error("Error guardando en Firebase:", error);
      showToast('Error al guardar en Firebase (revisá credenciales/reglas)', 'error');
    }
  }

  async function deleteGuardFromFirebase(id) {
    try {
      await deleteDoc(doc(db, "guards", id));
    } catch (error) {
      console.error("Error eliminando de Firebase:", error);
      showToast('Error al eliminar de Firebase', 'error');
    }
  }

  // ──────────────────────────────────
  // Register Guard (save to table)
  // ──────────────────────────────────
  function handleRegister() {

    const agentName = agentNameInput.value.trim();
    if (!agentName) {
      showToast('Ingresá el nombre del agente', 'error');
      agentNameInput.focus();
      return;
    }

    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    const startTime = startTimeInput.value;
    const endTime = endTimeInput.value;

    if (!startDate || !endDate || !startTime || !endTime) {
      showToast('Completá las fechas y horas', 'error');
      return;
    }

    const startDT = new Date(`${startDate}T${startTime}`);
    const endDT = new Date(`${endDate}T${endTime}`);

    if (endDT <= startDT) {
      showToast('La fecha/hora de fin debe ser posterior al inicio', 'error');
      return;
    }

    const isDuplicate = guards.some(g => 
      g.agentName.toLowerCase() === agentName.toLowerCase() && 
      g.startDate === startDate
    );

    if (isDuplicate) {
      showToast('⚠️ Esta guardia ya está registrada para este agente en esa fecha', 'error');
      agentNameInput.focus();
      return;
    }

    const newGuard = {
      id: generateId(),
      agentName,
      startDate,
      endDate,
      startTime,
      endTime,
      createdAt: new Date().toISOString()
    };

    saveGuardToFirebase(newGuard);
    showToast(`Guardia registrada exitosamente`, 'success');

    // Keep dates, only clear agent name and times
    agentNameInput.value = '';
    agentNameInput.focus();
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ──────────────────────────────────
  // Google Calendar
  // ──────────────────────────────────
  function buildCalendarUrl(guard) {
    const startDT = guard.startDate.replace(/-/g, '') + 'T' + guard.startTime.replace(/:/g, '') + '00';
    const endDT = guard.endDate.replace(/-/g, '') + 'T' + guard.endTime.replace(/:/g, '') + '00';

    const title = encodeURIComponent(guard.agentName);
    const details = encodeURIComponent(
      `Guardia de ${guard.agentName}\nInicio: ${formatDate(guard.startDate)} ${guard.startTime}\nFin: ${formatDate(guard.endDate)} ${guard.endTime}`
    );

    let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDT}/${endDT}&details=${details}`;
    
    // Append the specific calendar if defined
    const calendarSrc = localStorage.getItem(CALENDAR_LINK_KEY);
    if (calendarSrc) {
      url += `&src=${encodeURIComponent(calendarSrc)}`;
    }

    return url;
  }

  function formatIcsDate(dateStr, timeStr) {
    return dateStr.replace(/-/g, '') + 'T' + timeStr.replace(/:/g, '') + '00';
  }

  function handleUploadAllToCalendar() {
    if (guards.length === 0) {
      showToast('No hay guardias registradas', 'error');
      return;
    }

    const calendarId = localStorage.getItem(CALENDAR_LINK_KEY) || '';
    if (!calendarId) {
      showToast('Primero configurá un calendario en la barra superior', 'error');
      return;
    }

    const n8nWebhookUrl = 'https://empredimientos-crown.app.n8n.cloud/webhook/18c4cc38-18a8-4413-a2ce-aefdaccba134';

    uploadAllCalendarBtn.disabled = true;
    const originalText = uploadAllCalendarBtn.innerHTML;
    uploadAllCalendarBtn.innerHTML = '⏳ Subiendo...';
    showToast('Conectando con Google Calendar vía n8n...', 'info');

    fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId, guards })
    })
    .then(response => {
      if (response.ok) {
        showToast(`¡${guards.length} guardias enviadas a Google Calendar!`, 'success');
      } else {
        showToast('Error al enviar: ' + response.statusText, 'error');
      }
    })
    .catch(error => {
      showToast('Error de conexión con n8n: ' + error.message, 'error');
      console.error(error);
    })
    .finally(() => {
      uploadAllCalendarBtn.disabled = false;
      uploadAllCalendarBtn.innerHTML = originalText;
    });
  }

  function sendToCalendar(id) {
    const guard = guards.find(g => g.id === id);
    if (!guard) return;
    const url = buildCalendarUrl(guard);
    window.open(url, '_blank');
    showToast(`Abriendo Calendar para ${guard.agentName}`, 'success');
  }

  // Expose to global
  window.sendToCalendar = sendToCalendar;

  // ──────────────────────────────────
  // Reset
  // ──────────────────────────────────
  function handleReset() {
    guardForm.reset();
    setDefaultDates();
    showToast('Formulario limpiado', 'info');
  }

  // ──────────────────────────────────
  // Delete Guard
  // ──────────────────────────────────
  function requestDelete(id) {
    deleteTargetId = id;
    const guard = guards.find(g => g.id === id);
    if (guard) {
      document.getElementById('modal-text').textContent =
        `Se eliminará la guardia de "${guard.agentName}" (${formatDate(guard.startDate)} - ${formatDate(guard.endDate)}). Esta acción no se puede deshacer.`;
    }
    modalOverlay.classList.add('modal-overlay--visible');
  }

  function closeModal() {
    modalOverlay.classList.remove('modal-overlay--visible');
    deleteTargetId = null;
  }

  function handleConfirmDelete() {
    if (deleteTargetId) {
      const guardToDelete = guards.find(g => g.id === deleteTargetId);
      
      deleteGuardFromFirebase(deleteTargetId);
      showToast('Guardia eliminada', 'info');

      // Notificar a n8n para borrar de Calendar
      const calendarId = localStorage.getItem(CALENDAR_LINK_KEY) || '';
      if (calendarId && guardToDelete) {
        const n8nWebhookUrl = 'https://empredimientos-crown.app.n8n.cloud/webhook/18c4cc38-18a8-4413-a2ce-aefdaccba134';
        try {
          fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', calendarId, guard: guardToDelete })
          });
        } catch(e) { console.error('Error enviando delete a n8n', e); }
      }
    }
    deleteTargetId = null;
    closeModal();
  }

  window.requestDelete = requestDelete;

  // ──────────────────────────────────
  // Render Table
  // ──────────────────────────────────
  function renderTable() {
    tableBadge.textContent = `${guards.length} registro${guards.length !== 1 ? 's' : ''}`;

    if (guards.length === 0) {
      tableContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📅</div>
          <h3 class="empty-state__title">Sin guardias registradas</h3>
          <p class="empty-state__text">Cargá agentes y completá las fechas para registrar guardias.</p>
        </div>
      `;
      return;
    }

    const sorted = [...guards].sort((a, b) => {
      const dateComp = a.startDate.localeCompare(b.startDate);
      if (dateComp !== 0) return dateComp;
      return a.startTime.localeCompare(b.startTime);
    });

    const rows = sorted.map(g => {
      const status = getGuardStatus(g);
      return `
        <tr>
          <td>
            <span class="agent-badge">
              <span class="agent-badge__dot"></span>
              ${escapeHtml(g.agentName)}
            </span>
          </td>
          <td>${formatDate(g.startDate)}</td>
          <td>${formatDate(g.endDate)}</td>
          <td>${g.startTime}</td>
          <td>${g.endTime}</td>
          <td>
            <span class="status-pill status-pill--${status.class}">
              ${status.icon} ${status.label}
            </span>
          </td>
          <td class="td-actions">
            <button class="btn btn--calendar btn--sm" onclick="sendToCalendar('${g.id}')" title="Enviar a Google Calendar">
              📅
            </button>
            <button class="btn btn--danger btn--sm" onclick="requestDelete('${g.id}')" title="Eliminar guardia">
              🗑
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tableContent.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Agente</th>
              <th>Fecha Inicio</th>
              <th>Fecha Fin</th>
              <th>Hora Inicio</th>
              <th>Hora Fin</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function getGuardStatus(guard) {
    const now = new Date();
    const start = new Date(`${guard.startDate}T${guard.startTime}`);
    const end = new Date(`${guard.endDate}T${guard.endTime}`);

    if (now >= start && now <= end) {
      return { class: 'active', label: 'Activa', icon: '●' };
    } else if (now < start) {
      return { class: 'upcoming', label: 'Próxima', icon: '◷' };
    } else {
      return { class: 'completed', label: 'Finalizada', icon: '✓' };
    }
  }

  // ──────────────────────────────────
  // Stats
  // ──────────────────────────────────
  function updateStats() {
    const now = new Date();
    const uniqueAgents = new Set(guards.map(g => g.agentName.toLowerCase()));
    const activeCount = guards.filter(g => {
      const start = new Date(`${g.startDate}T${g.startTime}`);
      const end = new Date(`${g.endDate}T${g.endTime}`);
      return now >= start && now <= end;
    }).length;
    const upcomingCount = guards.filter(g => {
      const start = new Date(`${g.startDate}T${g.startTime}`);
      return now < start;
    }).length;

    animateValue(statTotal, parseInt(statTotal.textContent) || 0, guards.length, 400);
    animateValue(statAgents, parseInt(statAgents.textContent) || 0, uniqueAgents.size, 400);
    animateValue(statActive, parseInt(statActive.textContent) || 0, activeCount, 400);
    animateValue(statUpcoming, parseInt(statUpcoming.textContent) || 0, upcomingCount, 400);
  }

  function animateValue(el, from, to, duration) {
    if (from === to) { el.textContent = to; return; }
    const start = performance.now();
    function step(timestamp) {
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ──────────────────────────────────
  // Toast Notifications
  // ──────────────────────────────────
  function showToast(message, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span class="toast__message">${escapeHtml(message)}</span>
      <button class="toast__close" onclick="this.closest('.toast').remove()">✕</button>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast--exiting');
      setTimeout(() => toast.remove(), 350);
    }, 4000);
  }

  // ──────────────────────────────────
  // Utilities
  // ──────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ──────────────────────────────────
  // Boot
  // ──────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
