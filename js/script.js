// Estado global: nombre en inglés del equipo -> info de status
// status: { eliminated: bool, winner: bool, group: string }
let teamStatus = {};
let liveMatchesCount = 0;
let allMatches = [];
let currentBetTarget = null;
let currentBetContext = "";

const SITE_URL = "https://quiniela-drab-ten.vercel.app";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------- Tabs ---------- */
function initTabs() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("#" + btn.dataset.tab).classList.add("active");
    });
  });
}

/* ---------- Participantes ---------- */
function initials(name) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function renderPeople() {
  const grid = $("#people-grid");
  grid.innerHTML = "";

  PEOPLE.forEach((person) => {
    const card = document.createElement("div");
    card.className = "person-card";
    card.addEventListener("click", (e) => {
      if (e.target.closest(".bet-trigger")) return;
      openPersonModal(person);
    });

    const stillIn = person.teams.filter(
      (t) => !(teamStatus[t.en] && teamStatus[t.en].eliminated)
    ).length;
    const champion = person.teams.some((t) => teamStatus[t.en] && teamStatus[t.en].winner);

    const heartsHtml = person.teams
      .map((t) => {
        const broken = teamStatus[t.en] && teamStatus[t.en].eliminated;
        return `<span class="heart ${broken ? "broken" : ""}">♥</span>`;
      })
      .join("");

    card.innerHTML = `
      <div class="person-header">
        <img class="person-photo" src="images/${person.photo}" alt="${person.name}"
             onerror="this.outerHTML='<div class=\\'person-photo-fallback\\'>${initials(person.name)}</div>'" />
        <div>
          <div class="person-name">${person.name}</div>
          <div class="person-status-row">
            <span class="person-status">${
              champion
                ? "🏆 ¡Tiene al campeón!"
                : stillIn > 0
                ? `${stillIn} de ${person.teams.length} equipos con vida`
                : "Sin equipos vivos"
            }</span>
            <span class="hearts">${heartsHtml}</span>
          </div>
        </div>
      </div>
      <div class="team-list">
        ${person.teams
          .map((t) => {
            const st = teamStatus[t.en] || {};
            const cls = st.winner ? "winner" : st.eliminated ? "eliminated" : "";
            return `<div class="team-row ${cls}">
              <img class="flag" src="https://flagcdn.com/w40/${t.flag}.png" alt="${t.es}" />
              <span>${t.es}</span>
            </div>`;
          })
          .join("")}
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ---------- Tabla de grupos ---------- */
async function loadStandings() {
  try {
    const res = await fetch("/api/standings");
    const data = await res.json();

    if (data.error || !data.standings || data.standings.length === 0) {
      $("#api-warning").classList.remove("hidden");
      return;
    }
    $("#api-warning").classList.add("hidden");
    renderGroups(data.standings);
  } catch (e) {
    $("#api-warning").classList.remove("hidden");
  }
}

function flagFor(teamName) {
  for (const person of PEOPLE) {
    const match = person.teams.find((t) => t.en === teamName);
    if (match) return match.flag;
  }
  return null;
}

function ownerFor(teamName) {
  return PEOPLE.find((person) => person.teams.some((t) => t.en === teamName)) || null;
}

function esNameFor(teamName) {
  for (const person of PEOPLE) {
    const match = person.teams.find((t) => t.en === teamName);
    if (match) return match.es;
  }
  return teamName;
}

function ownerAvatarHtml(teamName) {
  const owner = ownerFor(teamName);
  if (!owner) return "";
  return `<img class="owner-avatar" src="images/${owner.photo}" alt="${owner.name}" title="${owner.name}"
    onerror="this.outerHTML='<span class=\\'owner-avatar-fallback\\' title=\\'${owner.name}\\'>${initials(owner.name)}</span>'" />`;
}

function renderGroups(standings) {
  const grid = $("#groups-grid");
  grid.innerHTML = "";

  // football-data.org devuelve standings tipo TOTAL agrupados por "group" (GROUP_A, etc.)
  const groupStandings = standings.filter((s) => s.type === "TOTAL" && s.group);
  groupStandings.sort((a, b) => a.group.localeCompare(b.group));

  groupStandings.forEach((group) => {
    const letter = group.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "");
    const groupLetter = `Grupo ${letter}`;
    const card = document.createElement("div");
    card.className = "group-card";

    const rows = group.table
      .map((row, idx) => {
        const flag = flagFor(row.team.name);
        const qualified = idx < 2; // primeros 2 lugares avanzan (referencia visual)
        const eliminated = teamStatus[row.team.name] && teamStatus[row.team.name].eliminated;
        return `<tr class="${qualified ? "qualified" : ""} ${eliminated ? "eliminated-row" : ""}">
          <td>${row.position}</td>
          <td class="team-cell">
            ${flag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${flag}.png" alt="" />` : ""}
            ${esNameFor(row.team.name)}
          </td>
          <td>${row.playedGames}</td>
          <td>${row.won}</td>
          <td>${row.draw}</td>
          <td>${row.lost}</td>
          <td>${row.goalDifference}</td>
          <td><strong>${row.points}</strong></td>
        </tr>`;
      })
      .join("");

    card.innerHTML = `
      <h3>${groupLetter}</h3>
      <table class="group-table">
        <thead>
          <tr><th>#</th><th style="text-align:left">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    grid.appendChild(card);

    // Actualiza el estado de eliminación: si el equipo no califica y el grupo ya terminó (4 juegos cada uno aprox.)
    group.table.forEach((row) => {
      if (!teamStatus[row.team.name]) teamStatus[row.team.name] = {};
    });
  });
}

/* ---------- Partidos ---------- */
async function loadMatches() {
  try {
    const res = await fetch("/api/matches");
    const data = await res.json();

    if (data.error || !data.matches) {
      $("#matches-warning").classList.remove("hidden");
      return;
    }
    $("#matches-warning").classList.add("hidden");
    allMatches = data.matches;
    renderMatches(allMatches);
    applyMatchResultsToTeamStatus(allMatches);
    if (openPerson) openPersonModal(openPerson);
  } catch (e) {
    $("#matches-warning").classList.remove("hidden");
  }
}

const STATUS_LABELS = {
  SCHEDULED: "Programado",
  TIMED: "Programado",
  IN_PLAY: "EN VIVO",
  PAUSED: "Medio tiempo",
  FINISHED: "Finalizado",
  POSTPONED: "Postergado",
  SUSPENDED: "Suspendido",
  CANCELLED: "Cancelado",
};

function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function statusClass(status) {
  if (status === "IN_PLAY" || status === "PAUSED") return "live";
  if (status === "FINISHED") return "finished";
  return "";
}

function buildMatchCard(m) {
  const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
  const homeFlag = flagFor(m.homeTeam.name);
  const awayFlag = flagFor(m.awayTeam.name);
  const home = m.score?.fullTime?.home ?? m.score?.halfTime?.home;
  const away = m.score?.fullTime?.away ?? m.score?.halfTime?.away;
  const hasScore = home != null && away != null;

  const homeOwner = ownerFor(m.homeTeam.name);
  const awayOwner = ownerFor(m.awayTeam.name);
  const matchLabel = `${esNameFor(m.homeTeam.name)} vs ${esNameFor(m.awayTeam.name)} - ${formatTime(m.utcDate)}`;

  const card = document.createElement("div");
  card.className = "match-card" + (isLive ? " is-live" : "");
  card.innerHTML = `
    <div class="match-header">
      <span class="match-time">${formatTime(m.utcDate)}</span>
      <span class="match-status ${statusClass(m.status)}">${STATUS_LABELS[m.status] || m.status}</span>
    </div>
    <div class="match-row">
      <div class="match-team">
        ${homeFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${homeFlag}.png" alt="" />` : ""}
        <span>${esNameFor(m.homeTeam.name)}</span>
        ${ownerAvatarHtml(m.homeTeam.name)}
      </div>
      <span class="match-row-score">${hasScore ? home : "-"}</span>
    </div>
    <div class="match-row">
      <div class="match-team">
        ${awayFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${awayFlag}.png" alt="" />` : ""}
        <span>${esNameFor(m.awayTeam.name)}</span>
        ${ownerAvatarHtml(m.awayTeam.name)}
      </div>
      <span class="match-row-score">${hasScore ? away : "-"}</span>
    </div>
    <div class="match-bet-row" style="display:flex; gap:6px;">
      ${homeOwner ? `<button class="bet-btn bet-trigger" data-target="${homeOwner.name}" data-context="${matchLabel}">🎲 ${homeOwner.name}</button>` : ""}
      ${awayOwner ? `<button class="bet-btn bet-trigger" data-target="${awayOwner.name}" data-context="${matchLabel}">🎲 ${awayOwner.name}</button>` : ""}
    </div>
  `;
  return card;
}

function renderMatches(matches) {
  const list = $("#matches-list");
  const empty = $("#matches-empty");
  list.innerHTML = "";

  liveMatchesCount = matches.filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED").length;
  updateLiveBanner();

  const todays = matches
    .filter((m) => isToday(m.utcDate))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (todays.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  todays.forEach((m) => list.appendChild(buildMatchCard(m)));
}

function applyMatchResultsToTeamStatus(matches) {
  // Marca como eliminado a un equipo que perdió un partido de eliminación directa (knockout)
  matches.forEach((m) => {
    if (m.status !== "FINISHED") return;
    const isKnockout = m.stage && m.stage !== "GROUP_STAGE";
    if (!isKnockout) return;

    const home = m.score?.fullTime?.home;
    const away = m.score?.fullTime?.away;
    if (home == null || away == null) return;

    let loserName = null;
    if (home < away) loserName = m.homeTeam.name;
    else if (away < home) loserName = m.awayTeam.name;
    else return; // empate -> probablemente penales, no diferenciamos aquí

    if (!teamStatus[loserName]) teamStatus[loserName] = {};
    teamStatus[loserName].eliminated = true;

    if (m.stage === "FINAL") {
      const winnerName = home > away ? m.homeTeam.name : m.awayTeam.name;
      if (!teamStatus[winnerName]) teamStatus[winnerName] = {};
      teamStatus[winnerName].winner = true;
    }
  });

  renderPeople();
}

/* ---------- Modal de participante ---------- */
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

let openPerson = null;

function openPersonModal(person) {
  openPerson = person;
  const teamNames = person.teams.map((t) => t.en);
  const personMatches = allMatches
    .filter((m) => teamNames.includes(m.homeTeam.name) || teamNames.includes(m.awayTeam.name))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const played = personMatches.filter((m) => m.status === "FINISHED");
  const upcoming = personMatches.filter((m) => m.status !== "FINISHED");

  const rowHtml = (m) => {
    const homeFlag = flagFor(m.homeTeam.name);
    const awayFlag = flagFor(m.awayTeam.name);
    const home = m.score?.fullTime?.home ?? m.score?.halfTime?.home;
    const away = m.score?.fullTime?.away ?? m.score?.halfTime?.away;
    const hasScore = home != null && away != null;
    const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
    const isHome = teamNames.includes(m.homeTeam.name);
    const rivalTeamName = isHome ? m.awayTeam.name : m.homeTeam.name;
    const rivalOwner = ownerFor(rivalTeamName);

    let resultClass = "";
    if (m.status === "FINISHED" && hasScore) {
      const ownScore = isHome ? home : away;
      const rivalScore = isHome ? away : home;
      resultClass = ownScore > rivalScore ? "result-win" : ownScore < rivalScore ? "result-loss" : "result-draw";
    }

    return `<div class="modal-match ${resultClass}">
      <div class="modal-match-header">
        <span>${formatDate(m.utcDate)}</span>
        <span class="match-status ${statusClass(m.status)}">${isLive ? "EN VIVO" : STATUS_LABELS[m.status] || m.status}</span>
      </div>
      <div class="match-row">
        <div class="match-team">
          ${homeFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${homeFlag}.png" alt="" />` : ""}
          <span>${esNameFor(m.homeTeam.name)}</span>
          ${ownerAvatarHtml(m.homeTeam.name)}
        </div>
        <span class="match-row-score">${hasScore ? home : "-"}</span>
      </div>
      <div class="match-row">
        <div class="match-team">
          ${awayFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${awayFlag}.png" alt="" />` : ""}
          <span>${esNameFor(m.awayTeam.name)}</span>
          ${ownerAvatarHtml(m.awayTeam.name)}
        </div>
        <span class="match-row-score">${hasScore ? away : "-"}</span>
      </div>
      ${
        m.status !== "FINISHED" && rivalOwner && rivalOwner.name !== person.name
          ? `<button class="bet-btn bet-trigger" data-target="${rivalOwner.name}" data-context="${esNameFor(m.homeTeam.name)} vs ${esNameFor(m.awayTeam.name)} - ${formatTime(m.utcDate)}">🎲 Apostarle a ${rivalOwner.name} en este partido</button>`
          : ""
      }
    </div>`;
  };

  $("#modal-content").innerHTML = `
    <h2>${person.name}</h2>
    <div class="modal-section-title">Jugados</div>
    ${played.length ? played.map(rowHtml).join("") : '<div class="modal-empty">Aún no hay partidos jugados.</div>'}
    <div class="modal-section-title">Por jugar</div>
    ${upcoming.length ? upcoming.map(rowHtml).join("") : '<div class="modal-empty">No hay partidos pendientes.</div>'}
  `;

  $("#person-modal").classList.remove("hidden");
  syncBodyScrollLock();
}

function closePersonModal() {
  openPerson = null;
  $("#person-modal").classList.add("hidden");
  syncBodyScrollLock();
}

function initModal() {
  $("#modal-close").addEventListener("click", closePersonModal);
  $("#person-modal").addEventListener("click", (e) => {
    if (e.target.id === "person-modal") closePersonModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePersonModal();
      closeBetModal();
    }
  });
}

/* ---------- Apuestas ---------- */
function syncBodyScrollLock() {
  const anyOpen = !$("#person-modal").classList.contains("hidden") || !$("#bet-modal").classList.contains("hidden");
  document.body.classList.toggle("modal-open", anyOpen);
}

function openBetModal(targetName, context) {
  const target = PEOPLE.find((p) => p.name === targetName);
  if (!target) return;

  currentBetTarget = target;
  currentBetContext = context || "";

  $("#bet-modal-title").textContent = `Apostarle a ${target.name}`;
  $("#bet-modal-context").textContent = currentBetContext;
  $("#bet-amount").value = "";

  $("#bet-modal").classList.remove("hidden");
  syncBodyScrollLock();
  $("#bet-amount").focus();
}

function closeBetModal() {
  $("#bet-modal").classList.add("hidden");
  syncBodyScrollLock();
}

async function sendBet() {
  if (!currentBetTarget) return;
  const amount = Number($("#bet-amount").value);

  if (!amount || amount <= 0) {
    alert("Pon una cantidad válida para la apuesta.");
    return;
  }

  try {
    const res = await fetch("/api/bets/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetName: currentBetTarget.name,
        amount,
        context: currentBetContext,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    alert("No se pudo guardar la apuesta en la página, pero igual te abrimos WhatsApp.");
  }

  const message =
    `🎲 *Nueva apuesta*\n` +
    (currentBetContext ? `${currentBetContext}\n` : "") +
    `Monto: $${amount} MXN\n` +
    `Va dirigida a: *${currentBetTarget.name}*\n\n` +
    `Entra a la página y acepta la apuesta en la pestaña "Apuestas": ${SITE_URL}`;

  const phoneDigits = currentBetTarget.phone.replace(/[^0-9]/g, "");
  window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`, "_blank");

  closeBetModal();
  loadBets();
}

function initBetModal() {
  $("#bet-modal-close").addEventListener("click", closeBetModal);
  $("#bet-modal").addEventListener("click", (e) => {
    if (e.target.id === "bet-modal") closeBetModal();
  });
  $("#bet-send").addEventListener("click", sendBet);

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".bet-trigger");
    if (!trigger) return;
    e.stopPropagation();
    openBetModal(trigger.dataset.target, trigger.dataset.context);
  });
}

function renderBets(bets) {
  const list = $("#bets-list");
  const empty = $("#bets-empty");
  list.innerHTML = "";

  if (bets.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  bets.forEach((bet) => {
    const card = document.createElement("div");
    card.className = "bet-card";
    card.innerHTML = `
      <div class="bet-card-info">
        <div class="bet-card-title">$${bet.amount} MXN — vs ${bet.targetName}</div>
        <div class="bet-card-context">${bet.context || "Apuesta general"}</div>
      </div>
      <div class="bet-card-meta">
        <span class="bet-status ${bet.status}">${bet.status === "aceptada" ? "Aceptada" : "Pendiente"}</span>
        ${bet.status === "pendiente" ? `<button class="bet-accept-btn" data-id="${bet.id}">Aceptar</button>` : ""}
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".bet-accept-btn").forEach((btn) => {
    btn.addEventListener("click", () => acceptBet(btn.dataset.id));
  });
}

async function acceptBet(id) {
  try {
    const res = await fetch("/api/bets/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    loadBets();
  } catch (e) {
    alert("No se pudo aceptar la apuesta. Intenta de nuevo.");
  }
}

async function loadBets() {
  try {
    const res = await fetch("/api/bets/list");
    const data = await res.json();

    if (data.error) {
      $("#bets-warning").classList.remove("hidden");
      return;
    }
    $("#bets-warning").classList.add("hidden");
    renderBets(data.bets || []);
  } catch (e) {
    $("#bets-warning").classList.remove("hidden");
  }
}

function updateLiveBanner() {
  const banner = $("#live-banner");
  if (liveMatchesCount > 0) {
    banner.textContent = `🔴 EN VIVO: ${liveMatchesCount} partido(s) jugándose ahora`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

/* ---------- Init ---------- */
function init() {
  initTabs();
  initModal();
  initBetModal();
  renderPeople();
  loadStandings();
  loadMatches();
  loadBets();

  // Refresca datos en vivo cada 30s
  setInterval(loadMatches, 30000);
  setInterval(loadStandings, 120000);
  setInterval(loadBets, 20000);
}

document.addEventListener("DOMContentLoaded", init);
