// Estado global: nombre en inglés del equipo -> info de status
// status: { eliminated: bool, winner: bool, group: string }
let teamStatus = {};
let liveMatchesCount = 0;
let allMatches = [];
let lastBets = [];
let lastStandings = null; // última tabla de grupos recibida, para re-pintarla
let advancingTeams = new Set(); // equipos que ya están en el cuadro de eliminación
let currentBetTarget = null;
let currentBetFrom = null;
let currentBetContext = "";
let currentBetHomeEn = "";
let currentBetAwayEn = "";

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
    const qualifiedCount = person.teams.filter(
      (t) => teamStatus[t.en] && teamStatus[t.en].advancing && !teamStatus[t.en].eliminated
    ).length;

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
                ? `${stillIn} de ${person.teams.length} con vida${qualifiedCount > 0 ? ` · ${qualifiedCount} en 16avos` : ""}`
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
            const cls = st.winner ? "winner" : st.eliminated ? "eliminated" : st.advancing ? "advancing" : "";
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
    const res = await fetch("/api/standings", { cache: "no-store" });
    const data = await res.json();

    // Sí hubo conexión (no es excepción). Si viene vacío puede ser que la fase
    // de grupos aún no esté publicada: mostramos aviso pero NO lo tratamos como
    // "sin conexión", para no alarmar de más.
    if (data.error || !data.standings || data.standings.length === 0) {
      $("#api-warning").classList.remove("hidden");
      return true;
    }
    $("#api-warning").classList.add("hidden");
    lastStandings = data.standings;
    renderGroups(lastStandings);
    return true;
  } catch (e) {
    $("#api-warning").classList.remove("hidden");
    return false;
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
        const st = teamStatus[row.team.name] || {};
        const eliminated = !!st.eliminated;
        // Los 2 primeros avanzan siempre; un 3º puede avanzar como mejor tercero
        // (lo confirmamos si ya está asegurado o ya aparece en el cuadro).
        const qualified = !eliminated && (idx < 2 || st.advancing || advancingTeams.has(row.team.name));
        const tag = eliminated
          ? `<span class="grp-tag grp-tag-out">Eliminado</span>`
          : qualified
          ? `<span class="grp-tag grp-tag-in">16avos</span>`
          : "";
        return `<tr class="${qualified ? "qualified" : ""} ${eliminated ? "eliminated-row" : ""}">
          <td>${row.position}</td>
          <td class="team-cell">
            ${flag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${flag}.png" alt="" />` : ""}
            <span class="grp-team-name">${esNameFor(row.team.name)}</span>
            ${tag}
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

    group.table.forEach((row) => {
      if (!teamStatus[row.team.name]) teamStatus[row.team.name] = {};
    });

    // Si el grupo ya terminó (todos jugaron sus 3 partidos), el último lugar
    // queda eliminado con certeza: en el formato de 48, el 4º nunca avanza.
    const groupDone = group.table.length > 0 && group.table.every((r) => r.playedGames >= 3);
    if (groupDone) {
      const last = group.table[group.table.length - 1];
      if (last) {
        teamStatus[last.team.name] = teamStatus[last.team.name] || {};
        teamStatus[last.team.name].eliminated = true;
      }
    }
  });

  // Reflejamos de inmediato cualquier eliminación recién detectada en las
  // tarjetas de participantes (corazones rotos).
  renderPeople();
}

/* ---------- Partidos ---------- */
async function loadMatches() {
  try {
    const res = await fetch("/api/matches", { cache: "no-store" });
    const data = await res.json();

    if (data.error || !data.matches) {
      $("#matches-warning").classList.remove("hidden");
      return false;
    }
    $("#matches-warning").classList.add("hidden");
    allMatches = data.matches;
    computeGroupQualification(allMatches);
    renderMatches(allMatches);
    applyMatchResultsToTeamStatus(allMatches);
    renderBracket(allMatches);
    // Re-pintamos la tabla de grupos para reflejar clasificados/eliminados
    // recién calculados a partir de los resultados de los partidos.
    if (lastStandings) renderGroups(lastStandings);
    if (openPerson) openPersonModal(openPerson);
    if (lastBets.length) renderBets(lastBets);
    return true;
  } catch (e) {
    $("#matches-warning").classList.remove("hidden");
    return false;
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

const STAGE_LABELS = {
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos",
  QUARTER_FINALS: "Cuartos",
  SEMI_FINALS: "Semifinal",
  THIRD_PLACE: "Tercer lugar",
  FINAL: "Final",
};

// Etiqueta de ronda solo para eliminación directa (en grupos no aporta nada).
function stageLabelFor(stage) {
  return stage && stage !== "GROUP_STAGE" ? STAGE_LABELS[stage] || "" : "";
}

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
  const stage = stageLabelFor(m.stage);

  const card = document.createElement("div");
  card.className = "match-card" + (isLive ? " is-live" : "");
  card.innerHTML = `
    <div class="match-header">
      <span class="match-time">${formatTime(m.utcDate)}${stage ? ` · ${stage}` : ""}</span>
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
      ${
        homeOwner && awayOwner
          ? `<button class="bet-btn bet-trigger"
              data-from="${awayOwner.name}" data-target="${homeOwner.name}"
              data-home-en="${m.homeTeam.name}" data-away-en="${m.awayTeam.name}"
              data-context="${matchLabel}">🎲 Apostar a ${homeOwner.name}</button>
            <button class="bet-btn bet-trigger"
              data-from="${homeOwner.name}" data-target="${awayOwner.name}"
              data-home-en="${m.homeTeam.name}" data-away-en="${m.awayTeam.name}"
              data-context="${matchLabel}">🎲 Apostar a ${awayOwner.name}</button>`
          : ""
      }
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

  // Mostramos los partidos de hoy, y SIEMPRE los que están en vivo aunque su
  // hora de inicio (UTC) caiga en otro día local (ej. arrancó 23:40 y ya es
  // pasada la medianoche): así un partido en curso nunca desaparece de la lista.
  const todays = matches
    .filter((m) => isToday(m.utcDate) || m.status === "IN_PLAY" || m.status === "PAUSED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (todays.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  todays.forEach((m) => list.appendChild(buildMatchCard(m)));
}

function applyMatchResultsToTeamStatus(matches) {
  // 1) Reunimos qué equipos ya están en el cuadro de eliminación (LAST_32 en
  //    adelante) y si la fase de grupos ya terminó por completo.
  const knockoutTeams = new Set();
  const groupTeams = new Set();
  let groupTotal = 0;
  let groupFinished = 0;

  matches.forEach((m) => {
    const isKnockout = m.stage && m.stage !== "GROUP_STAGE";
    if (isKnockout) {
      if (m.homeTeam?.name) knockoutTeams.add(m.homeTeam.name);
      if (m.awayTeam?.name) knockoutTeams.add(m.awayTeam.name);
    } else {
      groupTotal++;
      if (m.status === "FINISHED") groupFinished++;
      if (m.homeTeam?.name) groupTeams.add(m.homeTeam.name);
      if (m.awayTeam?.name) groupTeams.add(m.awayTeam.name);
    }
  });

  advancingTeams = knockoutTeams; // lo usa la tabla de grupos para marcar terceros

  // 2) Eliminados de la fase de grupos: cuando ya terminaron TODOS los partidos
  //    de grupos y el cuadro está armado, cualquier equipo de grupos que no
  //    aparezca en el cuadro quedó fuera (son los 16 que no avanzan en formato 48).
  const groupStageDone = groupTotal > 0 && groupFinished === groupTotal;
  if (groupStageDone && knockoutTeams.size > 0) {
    groupTeams.forEach((name) => {
      if (!knockoutTeams.has(name)) {
        teamStatus[name] = teamStatus[name] || {};
        teamStatus[name].eliminated = true;
      }
    });
  }

  // 3) Eliminados por perder en eliminación directa (usamos score.winner, que
  //    ya considera penales) y campeón al ganar la final.
  matches.forEach((m) => {
    if (m.status !== "FINISHED") return;
    const isKnockout = m.stage && m.stage !== "GROUP_STAGE";
    if (!isKnockout) return;

    const winner = m.score?.winner; // HOME_TEAM | AWAY_TEAM | DRAW
    const home = m.score?.fullTime?.home;
    const away = m.score?.fullTime?.away;

    let loserName = null;
    let winnerName = null;
    if (winner === "HOME_TEAM") {
      winnerName = m.homeTeam?.name;
      loserName = m.awayTeam?.name;
    } else if (winner === "AWAY_TEAM") {
      winnerName = m.awayTeam?.name;
      loserName = m.homeTeam?.name;
    } else if (home != null && away != null && home !== away) {
      winnerName = home > away ? m.homeTeam?.name : m.awayTeam?.name;
      loserName = home > away ? m.awayTeam?.name : m.homeTeam?.name;
    } else {
      return; // sin ganador claro todavía (ej. empate pendiente de penales)
    }

    if (loserName) {
      teamStatus[loserName] = teamStatus[loserName] || {};
      teamStatus[loserName].eliminated = true;
    }
    if (m.stage === "FINAL" && winnerName) {
      teamStatus[winnerName] = teamStatus[winnerName] || {};
      teamStatus[winnerName].winner = true;
    }
  });

  renderPeople();
}

/* ---------- Clasificación / eliminación matemática (fase de grupos) ----------
   Desempate oficial del Mundial 2026: PRIMERO el head-to-head (resultado entre
   los equipos empatados), antes que la diferencia de goles general. Para saber
   quién ya aseguró o ya no puede, probamos todos los resultados que faltan en
   cada grupo y revisamos en qué posiciones puede terminar cada equipo. */
function matchWinnerSide(m) {
  const w = m.score?.winner;
  if (w === "HOME_TEAM") return "home";
  if (w === "AWAY_TEAM") return "away";
  if (w === "DRAW") return "draw";
  const h = m.score?.fullTime?.home;
  const a = m.score?.fullTime?.away;
  if (h != null && a != null) return h > a ? "home" : a > h ? "away" : "draw";
  return null;
}

function enumerateOutcomes(n) {
  if (n === 0) return [[]];
  const out = [];
  for (const sub of enumerateOutcomes(n - 1)) {
    for (const o of ["home", "draw", "away"]) out.push([o, ...sub]);
  }
  return out;
}

// Ordena por puntos y, en empate, por el mini-torneo entre los empatados
// (puntos head-to-head). Devuelve "bloques": un bloque con más de un equipo
// es un empate que el head-to-head no resolvió (ahí ya dependería de la
// diferencia de goles, que no simulamos: lo dejamos como incertidumbre).
function rankByPointsAndH2H(teams, pts, results) {
  const byPts = {};
  teams.forEach((t) => { (byPts[pts[t]] = byPts[pts[t]] || []).push(t); });
  const blocks = [];
  Object.keys(byPts).map(Number).sort((a, b) => b - a).forEach((pv) => {
    const tied = byPts[pv];
    if (tied.length === 1) { blocks.push(tied); return; }
    const mini = {};
    tied.forEach((t) => (mini[t] = 0));
    results.forEach((m) => {
      if (tied.includes(m.home) && tied.includes(m.away)) {
        if (m.winner === "home") mini[m.home] += 3;
        else if (m.winner === "away") mini[m.away] += 3;
        else { mini[m.home] += 1; mini[m.away] += 1; }
      }
    });
    const byMini = {};
    tied.forEach((t) => { (byMini[mini[t]] = byMini[mini[t]] || []).push(t); });
    Object.keys(byMini).map(Number).sort((a, b) => b - a).forEach((mv) => blocks.push(byMini[mv]));
  });
  return blocks;
}

function analyzeGroupOutcomes(groupMatches) {
  const teams = [...new Set(groupMatches.flatMap((m) => [m.homeTeam?.name, m.awayTeam?.name]))].filter(Boolean);
  const played = [];
  const remaining = [];
  groupMatches.forEach((m) => {
    const w = matchWinnerSide(m);
    if (m.status === "FINISHED" && w) {
      played.push({ home: m.homeTeam.name, away: m.awayTeam.name, winner: w });
    } else if (m.homeTeam?.name && m.awayTeam?.name) {
      remaining.push({ home: m.homeTeam.name, away: m.awayTeam.name });
    }
  });

  const res = {};
  teams.forEach((t) => (res[t] = { top3: true, fourth: true }));

  enumerateOutcomes(remaining.length).forEach((combo) => {
    const all = played.concat(remaining.map((m, i) => ({ home: m.home, away: m.away, winner: combo[i] })));
    const pts = {};
    teams.forEach((t) => (pts[t] = 0));
    all.forEach((m) => {
      if (m.winner === "home") pts[m.home] += 3;
      else if (m.winner === "away") pts[m.away] += 3;
      else { pts[m.home] += 1; pts[m.away] += 1; }
    });
    let pos = 1;
    rankByPointsAndH2H(teams, pts, all).forEach((block) => {
      const best = pos;
      const worst = pos + block.length - 1;
      block.forEach((n) => {
        if (worst > 3) res[n].top3 = false;   // podría caer fuera del top-3
        if (best < 4) res[n].fourth = false;  // podría salvarse del 4º
      });
      pos += block.length;
    });
  });
  return res;
}

function computeGroupQualification(matches) {
  const groupMatches = matches.filter((m) => m.stage === "GROUP_STAGE" && m.group);
  if (groupMatches.length === 0) return;
  const groups = {};
  groupMatches.forEach((m) => { (groups[m.group] = groups[m.group] || []).push(m); });

  Object.values(groups).forEach((gm) => {
    const r = analyzeGroupOutcomes(gm);
    Object.keys(r).forEach((name) => {
      teamStatus[name] = teamStatus[name] || {};
      if (r[name].fourth) teamStatus[name].eliminated = true;   // 4º matemático: fuera
      else if (r[name].top3) teamStatus[name].advancing = true; // asegurado en zona de 16avos
    });
  });
}

/* ---------- Llaves (cuadro de eliminación) ---------- */
const BRACKET_ROUNDS = [
  ["LAST_32", "Dieciseisavos"],
  ["LAST_16", "Octavos"],
  ["QUARTER_FINALS", "Cuartos"],
  ["SEMI_FINALS", "Semifinal"],
  ["FINAL", "Final"],
];

function bracketWinnerSide(m) {
  // Devuelve "home" | "away" | null según quién ganó (considera penales).
  if (m.status !== "FINISHED") return null;
  const w = m.score?.winner;
  if (w === "HOME_TEAM") return "home";
  if (w === "AWAY_TEAM") return "away";
  const h = m.score?.fullTime?.home;
  const a = m.score?.fullTime?.away;
  if (h != null && a != null && h !== a) return h > a ? "home" : "away";
  return null;
}

function bracketTeamHtml(team, isWinner) {
  if (!team || !team.name) {
    return `<div class="bk-team bk-tbd"><span>Por definir</span></div>`;
  }
  return `<div class="bk-team ${isWinner ? "bk-win" : ""}">
    ${team.crest ? `<img class="bk-crest" src="${team.crest}" alt="" loading="lazy" />` : ""}
    <span class="bk-name">${esNameFor(team.name)}</span>
    ${ownerAvatarHtml(team.name)}
  </div>`;
}

function bracketMatchHtml(m) {
  const win = bracketWinnerSide(m);
  const h = m.score?.fullTime?.home;
  const a = m.score?.fullTime?.away;
  const hasScore = h != null && a != null;
  const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
  return `<div class="bk-match ${isLive ? "bk-live" : ""}">
    <div class="bk-row">
      ${bracketTeamHtml(m.homeTeam, win === "home")}
      <span class="bk-score">${hasScore ? h : ""}</span>
    </div>
    <div class="bk-row">
      ${bracketTeamHtml(m.awayTeam, win === "away")}
      <span class="bk-score">${hasScore ? a : ""}</span>
    </div>
  </div>`;
}

function renderBracket(matches) {
  const wrap = $("#bracket");
  const info = $("#bracket-info");
  if (!wrap) return;

  const cols = BRACKET_ROUNDS.map(([stage, label]) => {
    const ms = matches
      .filter((m) => m.stage === stage)
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
    if (ms.length === 0) return "";
    return `<div class="bk-col">
      <div class="bk-col-title">${label}</div>
      ${ms.map(bracketMatchHtml).join("")}
    </div>`;
  });

  // Partido por el tercer lugar, como columna extra al final.
  const third = matches
    .filter((m) => m.stage === "THIRD_PLACE")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  if (third.length) {
    cols.push(`<div class="bk-col">
      <div class="bk-col-title">Tercer lugar</div>
      ${third.map(bracketMatchHtml).join("")}
    </div>`);
  }

  wrap.innerHTML = cols.join("");

  // Aviso mientras el cuadro aún no tiene equipos definidos.
  const anyDefined = matches.some(
    (m) => m.stage && m.stage !== "GROUP_STAGE" && (m.homeTeam?.name || m.awayTeam?.name)
  );
  info.classList.toggle("hidden", anyDefined);
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
        <span>${formatDate(m.utcDate)}${stageLabelFor(m.stage) ? ` · ${stageLabelFor(m.stage)}` : ""}</span>
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
          ? `<button class="bet-btn bet-trigger"
              data-from="${person.name}" data-target="${rivalOwner.name}"
              data-home-en="${m.homeTeam.name}" data-away-en="${m.awayTeam.name}"
              data-context="${esNameFor(m.homeTeam.name)} vs ${esNameFor(m.awayTeam.name)} - ${formatTime(m.utcDate)}">🎲 Apostarle a ${rivalOwner.name} en este partido</button>`
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

function openBetModal({ fromName, targetName, homeEn, awayEn, context }) {
  const target = PEOPLE.find((p) => p.name === targetName);
  if (!target) return;

  currentBetTarget = target;
  currentBetFrom = PEOPLE.find((p) => p.name === fromName) || null;
  currentBetContext = context || "";
  currentBetHomeEn = homeEn || "";
  currentBetAwayEn = awayEn || "";

  $("#bet-modal-title").textContent = currentBetFrom
    ? `${currentBetFrom.name} 🆚 ${target.name}`
    : `Apostarle a ${target.name}`;
  $("#bet-modal-context").textContent = currentBetContext;
  $("#bet-amount").value = "";

  sendingBet = false;
  $("#bet-send").disabled = false;
  $("#bet-send").textContent = "Enviar apuesta por WhatsApp";

  $("#bet-modal").classList.remove("hidden");
  syncBodyScrollLock();
  $("#bet-amount").focus();
}

function closeBetModal() {
  $("#bet-modal").classList.add("hidden");
  syncBodyScrollLock();
}

let sendingBet = false;

async function sendBet() {
  if (!currentBetTarget || sendingBet) return;
  const amount = Number($("#bet-amount").value);

  if (!amount || amount <= 0) {
    alert("Pon una cantidad válida para la apuesta.");
    return;
  }

  sendingBet = true;
  $("#bet-send").disabled = true;
  $("#bet-send").textContent = "Enviando...";

  try {
    const res = await fetch("/api/bets/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetName: currentBetTarget.name,
        fromName: currentBetFrom ? currentBetFrom.name : "",
        homeTeamEn: currentBetHomeEn,
        awayTeamEn: currentBetAwayEn,
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

  sendingBet = false;
  $("#bet-send").disabled = false;
  $("#bet-send").textContent = "Enviar apuesta por WhatsApp";

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
    openBetModal({
      fromName: trigger.dataset.from,
      targetName: trigger.dataset.target,
      homeEn: trigger.dataset.homeEn,
      awayEn: trigger.dataset.awayEn,
      context: trigger.dataset.context,
    });
  });
}

function findMatchByTeams(homeEn, awayEn) {
  if (!homeEn || !awayEn) return null;
  return (
    allMatches.find((m) => m.homeTeam.name === homeEn && m.awayTeam.name === awayEn) || null
  );
}

function betResultHtml(bet) {
  const match = findMatchByTeams(bet.homeTeamEn, bet.awayTeamEn);
  if (!match) return "";

  // Partido aún por jugar: mostramos cuándo es.
  if (match.status === "SCHEDULED" || match.status === "TIMED") {
    return `<div class="bet-when">🕐 ${formatDate(match.utcDate)} · ${formatTime(match.utcDate)}</div>`;
  }

  // Partido en vivo: mostramos el marcador en curso.
  if (match.status === "IN_PLAY" || match.status === "PAUSED") {
    const h = match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? 0;
    const a = match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? 0;
    const label = match.status === "PAUSED" ? "Medio tiempo" : "EN VIVO";
    return `<div class="bet-result bet-result-live">🔴 ${label} ${h}-${a}</div>`;
  }

  if (match.status !== "FINISHED") return "";

  const home = match.score?.fullTime?.home;
  const away = match.score?.fullTime?.away;
  if (home == null || away == null) return "";

  if (home === away) {
    return `<div class="bet-result bet-result-draw">🤝 Empate ${home}-${away}</div>`;
  }

  const winnerTeamEn = home > away ? bet.homeTeamEn : bet.awayTeamEn;
  const winnerOwner = ownerFor(winnerTeamEn);
  return `<div class="bet-result bet-result-win">🏆 Ganó ${winnerOwner ? winnerOwner.name : esNameFor(winnerTeamEn)} (${home}-${away})</div>`;
}

function betMatchupHtml(bet) {
  if (!bet.homeTeamEn || !bet.awayTeamEn) {
    return `<div class="bet-card-context">${bet.context || "Apuesta general"}</div>`;
  }
  const homeFlag = flagFor(bet.homeTeamEn);
  const awayFlag = flagFor(bet.awayTeamEn);
  const homeOwner = ownerFor(bet.homeTeamEn);
  const awayOwner = ownerFor(bet.awayTeamEn);

  return `
    <div class="bet-matchup">
      <div class="bet-matchup-team">
        ${homeFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${homeFlag}.png" alt="" />` : ""}
        <span>${esNameFor(bet.homeTeamEn)}</span>
        <span class="bet-owner">(${homeOwner ? homeOwner.name : "?"})</span>
      </div>
      <span class="bet-vs">VS</span>
      <div class="bet-matchup-team">
        ${awayFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${awayFlag}.png" alt="" />` : ""}
        <span>${esNameFor(bet.awayTeamEn)}</span>
        <span class="bet-owner">(${awayOwner ? awayOwner.name : "?"})</span>
      </div>
    </div>
  `;
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
        <div class="bet-card-title">$${bet.amount} MXN — ${bet.fromName ? `${bet.fromName} 🆚 ${bet.targetName}` : `vs ${bet.targetName}`}</div>
        ${bet.fromName ? `<div class="bet-card-sender">Apuesta enviada por <strong>${bet.fromName}</strong></div>` : ""}
        ${betMatchupHtml(bet)}
        ${betResultHtml(bet)}
      </div>
      <div class="bet-card-meta">
        <span class="bet-status ${bet.status}">${bet.status === "aceptada" ? "Aceptada" : "Pendiente"}</span>
        ${bet.status === "pendiente" ? `<button class="bet-accept-btn" data-id="${bet.id}">Aceptar</button>` : ""}
        <button class="bet-delete-btn" data-id="${bet.id}" title="Eliminar">✕</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".bet-accept-btn").forEach((btn) => {
    btn.addEventListener("click", () => acceptBet(btn.dataset.id));
  });
  list.querySelectorAll(".bet-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteBet(btn.dataset.id));
  });
}

async function deleteBet(id) {
  if (!confirm("¿Eliminar esta apuesta?")) return;
  try {
    await fetch("/api/bets/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadBets();
  } catch (e) {
    alert("No se pudo eliminar la apuesta.");
  }
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
    const res = await fetch("/api/bets/list", { cache: "no-store" });
    const data = await res.json();

    if (data.error) {
      $("#bets-warning").classList.remove("hidden");
      return false;
    }
    $("#bets-warning").classList.add("hidden");
    lastBets = data.bets || [];
    renderBets(lastBets);
    return true;
  } catch (e) {
    $("#bets-warning").classList.remove("hidden");
    return false;
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

/* ---------- Motor de actualización ---------- */
// En vez de timers fijos, ajustamos qué tan seguido se consulta según si hay
// partidos en vivo ahora mismo: más agresivo cuando importa, más relajado
// cuando no pasa nada (ahorra llamadas y batería sin perder frescura real).
const POLL = {
  matchesLive: 7000,   // hay partido en vivo: refrescamos seguido
  matchesIdle: 45000,  // nada en vivo: con calma
  standings: 120000,   // la tabla cambia poco
  bets: 20000,         // apuestas
};

let matchesTimer = null;
let standingsTimer = null;
let betsTimer = null;
let refreshInFlight = false;

function setLastUpdated(ok) {
  const el = $("#last-updated");
  if (!el) return;
  const time = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.textContent = ok ? `Actualizado: ${time}` : `Sin conexión — último intento: ${time}`;
  el.style.color = ok ? "" : "var(--red)";
}

// El estado "Actualizado / Sin conexión" se basa en los partidos: es el dato
// en vivo que de verdad importa. La tabla y las apuestas tienen sus propios
// avisos y pueden venir legítimamente vacías sin que sea una falla de red.
async function refreshAll(manual) {
  if (refreshInFlight && !manual) return;
  refreshInFlight = true;

  if (manual) {
    const btn = $("#refresh-now");
    btn.classList.add("spinning");
    btn.textContent = "🔄 Actualizando...";
  }

  const [matchesOk] = await Promise.all([
    loadMatches(),
    loadStandings(),
    loadBets(),
  ]);
  setLastUpdated(matchesOk);

  if (manual) {
    const btn = $("#refresh-now");
    btn.classList.remove("spinning");
    btn.textContent = "🔄 Actualizar";
  }
  refreshInFlight = false;
}

function scheduleMatches() {
  clearTimeout(matchesTimer);
  const delay = liveMatchesCount > 0 ? POLL.matchesLive : POLL.matchesIdle;
  matchesTimer = setTimeout(async () => {
    const ok = await loadMatches();
    setLastUpdated(ok);
    scheduleMatches();
  }, delay);
}

function scheduleStandings() {
  clearTimeout(standingsTimer);
  standingsTimer = setTimeout(async () => {
    await loadStandings();
    scheduleStandings();
  }, POLL.standings);
}

function scheduleBets() {
  clearTimeout(betsTimer);
  betsTimer = setTimeout(async () => {
    await loadBets();
    scheduleBets();
  }, POLL.bets);
}

function startSchedules() {
  scheduleMatches();
  scheduleStandings();
  scheduleBets();
}

function pauseSchedules() {
  clearTimeout(matchesTimer);
  clearTimeout(standingsTimer);
  clearTimeout(betsTimer);
}

/* ---------- Init ---------- */
function detectStandalone() {
  // En iOS, una app agregada a la pantalla de inicio expone navigator.standalone.
  // En el resto de plataformas usamos la media query display-mode: standalone.
  const isStandalone =
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (isStandalone) document.documentElement.classList.add("standalone");
}

function init() {
  detectStandalone();
  initTabs();
  initModal();
  initBetModal();
  renderPeople();

  const lu = $("#last-updated");
  if (lu) lu.textContent = "Actualizando…";

  refreshAll(false).then(startSchedules);

  $("#refresh-now").addEventListener("click", () => refreshAll(true));

  // Al volver a primer plano forzamos un refresco inmediato (para no mostrar
  // datos viejos, ej. un partido que ya terminó pero seguía "EN VIVO") y
  // reiniciamos los temporizadores. Cuando la app pasa a segundo plano,
  // detenemos el polling: los navegadores ya lo estrangulan, así evitamos
  // llamadas inútiles y ahorramos batería.
  const onResume = () => {
    pauseSchedules();
    refreshAll(false).then(startSchedules);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onResume();
    else pauseSchedules();
  });

  // En apps agregadas a la pantalla de inicio en iOS (modo standalone),
  // "visibilitychange" no siempre se dispara. "pageshow" y "focus" sí
  // cubren ese caso al reabrir la app desde el ícono.
  window.addEventListener("pageshow", onResume);
  window.addEventListener("focus", onResume);
}

document.addEventListener("DOMContentLoaded", init);
