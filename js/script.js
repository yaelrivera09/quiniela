// Estado global: nombre en inglés del equipo -> info de status
// status: { eliminated: bool, winner: bool, group: string }
let teamStatus = {};
let liveMatchesCount = 0;
let allMatches = [];
let lastBets = [];
let lastStandings = null; // última tabla de grupos recibida, para re-pintarla
let advancingTeams = new Set(); // equipos que ya están en el cuadro de eliminación
let qualifyingThirds = new Set(); // terceros que HOY clasificarían (top-8 provisional)
let currentBetTarget = null;
let currentBetFrom = null;
let currentBetContext = "";
let currentBetHomeEn = "";
let currentBetAwayEn = "";

const SITE_URL = "https://quiniela-drab-ten.vercel.app";

// Debe coincidir con el ?v= de index.html. Sirve para detectar si el navegador
// (o el acceso directo de iOS) está corriendo una versión vieja en caché.
const APP_VERSION = "20260618l";

// Auto-actualización: pide el index.html fresco (sin caché), lee qué versión
// debería estar corriendo y, si la que tenemos cargada es vieja, recarga a una
// URL con parámetro nuevo para forzar que el navegador baje la versión actual.
// Un guard en sessionStorage evita recargas en bucle.
async function checkForUpdate() {
  try {
    const res = await fetch("/?_=" + Date.now(), { cache: "no-store" });
    const html = await res.text();
    const m = html.match(/script\.js\?v=([0-9a-z]+)/);
    const latest = m && m[1];
    if (latest && latest !== APP_VERSION && sessionStorage.getItem("qreload") !== latest) {
      sessionStorage.setItem("qreload", latest);
      location.replace(location.pathname + "?u=" + latest);
    }
  } catch (e) {
    /* sin conexión: seguimos con lo que haya */
  }
}

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

  renderLeaderboard();
}

/* ---------- Tabla de posiciones (porra) ---------- */
const POINTS_BY_ROUND = { r32: 2, r16: 4, qf: 7, sf: 11, final: 16, champ: 25 };

// Puntos por la ronda MÁS LEJANA que alcanzó un equipo. Cuenta tanto aparecer
// en una ronda como GANAR un partido de eliminación (avanza a la siguiente),
// porque la API a veces tarda en colocar al equipo en la siguiente ronda.
const STAGE_PTS = {
  LAST_32: POINTS_BY_ROUND.r32,
  LAST_16: POINTS_BY_ROUND.r16,
  QUARTER_FINALS: POINTS_BY_ROUND.qf,
  SEMI_FINALS: POINTS_BY_ROUND.sf,
  FINAL: POINTS_BY_ROUND.final,
};
const NEXT_PTS = {
  LAST_32: POINTS_BY_ROUND.r16,
  LAST_16: POINTS_BY_ROUND.qf,
  QUARTER_FINALS: POINTS_BY_ROUND.sf,
  SEMI_FINALS: POINTS_BY_ROUND.final,
  FINAL: POINTS_BY_ROUND.champ,
};

function teamRoundPoints(teamEn) {
  const st = teamStatus[teamEn] || {};
  if (st.winner) return POINTS_BY_ROUND.champ;

  let best = st.advancing || qualifyingThirds.has(teamEn) ? POINTS_BY_ROUND.r32 : 0;

  allMatches.forEach((m) => {
    if (!m.stage || m.stage === "GROUP_STAGE") return;
    const inMatch = m.homeTeam?.name === teamEn || m.awayTeam?.name === teamEn;
    if (inMatch) best = Math.max(best, STAGE_PTS[m.stage] || 0);
    if (m.status === "FINISHED") {
      const w = knockoutWinnerTeam(m);
      if (w && w.name === teamEn) best = Math.max(best, NEXT_PTS[m.stage] || 0);
    }
  });
  return best;
}

function renderLeaderboard() {
  const host = $("#leaderboard");
  if (!host) return;

  const rows = PEOPLE.map((p) => {
    let score = 0;
    let alive = 0;
    p.teams.forEach((t) => {
      score += teamRoundPoints(t.en);
      if (!(teamStatus[t.en] && teamStatus[t.en].eliminated)) alive++;
    });
    return { person: p, score, alive };
  });
  rows.sort((a, b) => b.score - a.score || b.alive - a.alive || a.person.name.localeCompare(b.person.name));

  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1);

  host.innerHTML = `
    <div class="lb-card">
      <h3 class="lb-title">🏆 Tabla de posiciones</h3>
      <p class="lb-note">Cada equipo suma por su ronda más lejana: 16avos 2 · Octavos 4 · Cuartos 7 · Semis 11 · Final 16 · Campeón 25.</p>
      <div class="lb-list">
        ${rows
          .map(
            (r, i) => `
          <div class="lb-row ${i === 0 && r.score > 0 ? "lb-first" : ""}">
            <span class="lb-pos">${medal(i)}</span>
            <img class="lb-photo" src="images/${r.person.photo}" alt=""
                 onerror="this.outerHTML='<span class=\\'lb-photo-fallback\\'>${initials(r.person.name)}</span>'" />
            <span class="lb-name">${r.person.name}</span>
            <span class="lb-alive">${r.alive}/4 vivos</span>
            <span class="lb-score">${r.score}<small>pts</small></span>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
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

// Marca como eliminado a un 3er lugar de grupo CERRADO que ya no puede entrar
// al top-8 de mejores terceros (ej. Uruguay): se cuenta cuántos terceros le
// ganan con seguridad (cerrados que ya lo superan + grupos abiertos cuyo 3o
// tendrá más puntos pase lo que pase). Si son 8 o más, queda fuera.
function markEliminatedThirds(standings) {
  const groups = standings.filter((s) => s.type === "TOTAL" && s.group);
  if (groups.length === 0 || allMatches.length === 0) return;

  const letterOf = (g) => g.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "").trim();
  const thirdOf = (g) => {
    const t = [...g.table].sort((a, b) => a.position - b.position)[2];
    return t ? { team: t.team.name, pts: t.points, dg: t.goalDifference, gf: t.goalsFor } : null;
  };
  const better = (x, y) => x.pts > y.pts || (x.pts === y.pts && (x.dg > y.dg || (x.dg === y.dg && x.gf > y.gf)));

  const closed = {};
  const remaining = {};
  groups.forEach((g) => {
    const L = letterOf(g);
    const ms = allMatches.filter((m) => m.stage === "GROUP_STAGE" && m.group === "GROUP_" + L);
    remaining[L] = ms.filter((m) => m.status !== "FINISHED").map((m) => ({ h: m.homeTeam?.name, a: m.awayTeam?.name })).filter((x) => x.h && x.a);
    closed[L] = ms.length > 0 && ms.every((m) => m.status === "FINISHED");
  });

  // Puntos MÍNIMOS posibles del 3er lugar de un grupo abierto.
  const minThirdPts = (g) => {
    const rem = remaining[letterOf(g)];
    const base = {};
    g.table.forEach((r) => (base[r.team.name] = { pts: r.points, gf: r.goalsFor, ga: r.goalsAgainst }));
    let min = Infinity;
    (function go(i, state) {
      if (i === rem.length) {
        const arr = Object.values(state)
          .map((s) => ({ pts: s.pts, dg: s.gf - s.ga, gf: s.gf }))
          .sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
        if (arr[2] && arr[2].pts < min) min = arr[2].pts;
        return;
      }
      const { h, a } = rem[i];
      for (const r of ["home", "draw", "away"]) {
        const s = { ...state, [h]: { ...state[h] }, [a]: { ...state[a] } };
        if (r === "home") { s[h].pts += 3; s[h].gf += 1; s[a].ga += 1; }
        else if (r === "away") { s[a].pts += 3; s[a].gf += 1; s[h].ga += 1; }
        else { s[h].pts += 1; s[a].pts += 1; }
        go(i + 1, s);
      }
    })(0, base);
    return min === Infinity ? 0 : min;
  };

  const closedThirds = groups.filter((g) => closed[letterOf(g)]).map((g) => ({ L: letterOf(g), ...thirdOf(g) })).filter((x) => x.team);
  const openGroups = groups.filter((g) => !closed[letterOf(g)]);
  const openMin = openGroups.map((g) => minThirdPts(g));

  closedThirds.forEach((X) => {
    let above = 0;
    closedThirds.forEach((Y) => { if (Y.L !== X.L && better(Y, X)) above++; });
    openMin.forEach((mp) => { if (mp > X.pts) above++; });
    if (above >= 8) {
      teamStatus[X.team] = teamStatus[X.team] || {};
      teamStatus[X.team].eliminated = true;
    }
  });
}

function renderGroups(standings) {
  const grid = $("#groups-grid");
  grid.innerHTML = "";

  markEliminatedThirds(standings);

  // football-data.org devuelve standings tipo TOTAL agrupados por "group" (GROUP_A, etc.)
  const groupStandings = standings.filter((s) => s.type === "TOTAL" && s.group);
  groupStandings.sort((a, b) => a.group.localeCompare(b.group));

  groupStandings.forEach((group) => {
    const letter = group.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "").trim();
    const groupLetter = `Grupo ${letter}`;
    const card = document.createElement("div");
    card.className = "group-card group-card-click";
    card.addEventListener("click", () => openGroupModal(letter));

    const rows = group.table
      .map((row, idx) => {
        const flag = flagFor(row.team.name);
        const st = teamStatus[row.team.name] || {};
        const eliminated = !!st.eliminated;
        // Solo se resalta en verde a quien YA aseguró su pase matemáticamente
        // (top-2 o ya en el cuadro). Los que hoy están en zona pero todavía se
        // pueden mover de posición NO se marcan.
        const secured = !eliminated && !!st.advancing;
        const rowCls = eliminated ? "eliminated-row" : secured ? "qualified" : "";
        const tag = eliminated
          ? `<span class="grp-tag grp-tag-out">Eliminado</span>`
          : secured
          ? `<span class="grp-tag grp-tag-in">16avos</span>`
          : "";
        return `<tr class="${rowCls}">
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
      <h3>${groupLetter}<span class="group-card-hint">ver partidos ›</span></h3>
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

  renderBestThirds(standings);
}

/* ---------- Mejores terceros ---------- */
// Busca el rival de 16avos de un equipo en el cuadro oficial (la API lo asigna
// conforme se cierran los grupos). Devuelve el equipo rival o null.
function findR32Opponent(teamName) {
  for (const m of allMatches) {
    if (m.stage !== "LAST_32") continue;
    if (m.homeTeam?.name === teamName && m.awayTeam?.name) return m.awayTeam;
    if (m.awayTeam?.name === teamName && m.homeTeam?.name) return m.homeTeam;
  }
  return null;
}

function teamBadgeImg(team) {
  if (!team || !team.name) return "";
  const flag = flagFor(team.name);
  if (flag) return `<img class="flag-mini" src="https://flagcdn.com/w40/${flag}.png" alt="" />`;
  if (team.crest) return `<img class="bk-crest" src="${team.crest}" alt="" loading="lazy" />`;
  return "";
}

// Estructura OFICIAL del Round of 32 2026 (validada contra los cruces que la
// API ya confirmó): cada ganador de grupo enfrenta al 3er lugar de uno de estos
// grupos. A qué tercero exacto le toca cada ganador lo define la tabla privada
// de 495 combinaciones de la FIFA; con la estructura solo podemos acotar el
// CONJUNTO de posibles rivales (que se reduce conforme cierran los grupos).
const R32_THIRD_SLOTS = {
  E: ["A", "B", "C", "D", "F"],
  I: ["C", "D", "F", "G", "H"],
  A: ["C", "E", "F", "H", "I"],
  L: ["E", "H", "I", "J", "K"],
  D: ["B", "E", "F", "I", "J"],
  G: ["A", "E", "H", "I", "J"],
  B: ["E", "F", "G", "I", "J"],
  K: ["D", "E", "I", "J", "L"],
};

// ¿Existe un emparejamiento completo (cada tercero a un slot permitido)?
function thirdsHavePerfectMatching(qualGroups, forced) {
  const slots = Object.keys(R32_THIRD_SLOTS);
  let found = false;
  (function bt(i, used) {
    if (found) return;
    if (i === qualGroups.length) { found = true; return; }
    const g = qualGroups[i];
    if (forced[g]) {
      const s = forced[g];
      if (!used.has(s) && R32_THIRD_SLOTS[s] && R32_THIRD_SLOTS[s].includes(g)) {
        used.add(s); bt(i + 1, used); used.delete(s);
      }
      return;
    }
    for (const s of slots) {
      if (used.has(s)) continue;
      if (R32_THIRD_SLOTS[s].includes(g)) {
        used.add(s); bt(i + 1, used); used.delete(s);
        if (found) return;
      }
    }
  })(0, new Set());
  return found;
}

// Para cada grupo-tercero clasificado, el conjunto de grupos-ganador que podría
// enfrentar. `fixed` son asignaciones ya confirmadas por la API (las respeta).
function projectThirdOpponents(qualGroups, fixed) {
  const res = {};
  qualGroups.forEach((g) => {
    const opts = [];
    for (const s of Object.keys(R32_THIRD_SLOTS)) {
      if (!R32_THIRD_SLOTS[s].includes(g)) continue;
      if (fixed[g] && fixed[g] !== s) continue;
      if (thirdsHavePerfectMatching(qualGroups, { ...fixed, [g]: s })) opts.push(s);
    }
    res[g] = opts.sort();
  });
  return res;
}

function renderBestThirds(standings) {
  const host = $("#thirds-card");
  if (!host) return;

  const groups = (standings || []).filter((s) => s.type === "TOTAL" && s.group);
  if (groups.length === 0) {
    host.innerHTML = "";
    return;
  }

  const thirds = [];
  groups.forEach((g) => {
    const sorted = [...g.table].sort((a, b) => a.position - b.position);
    const t = sorted[2]; // 3er lugar
    if (!t) return;
    thirds.push({
      group: g.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "").trim(),
      name: t.team.name,
      pts: t.points,
      gd: t.goalDifference,
      gf: t.goalsFor,
      pj: t.playedGames,
    });
  });

  // Criterio FIFA para terceros: puntos, luego diferencia de goles, luego goles.
  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  qualifyingThirds = new Set(thirds.slice(0, 8).map((t) => t.name));

  // Ganador actual de cada grupo (para mostrar al rival como equipo, no letra).
  const winnerByGroup = {};
  groups.forEach((g) => {
    const letter = g.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "").trim();
    const sorted = [...g.table].sort((a, b) => a.position - b.position);
    if (sorted[0]) winnerByGroup[letter] = sorted[0].team;
  });
  const winnerGroupOf = (teamName) =>
    Object.keys(winnerByGroup).find((k) => winnerByGroup[k] && winnerByGroup[k].name === teamName);

  // Los 8 grupos cuyos terceros clasifican (provisional) y lo que la API ya fijó.
  const top8Groups = thirds.slice(0, 8).map((t) => t.group);
  const fixed = {};
  thirds.slice(0, 8).forEach((t) => {
    const opp = findR32Opponent(t.name);
    const wg = opp && opp.name ? winnerGroupOf(opp.name) : null;
    if (wg) fixed[t.group] = wg;
  });
  const projection = projectThirdOpponents(top8Groups, fixed);

  const rivalCell = (t) => {
    // 1) Si la API ya fijó el cruce, lo mostramos como confirmado.
    const locked = findR32Opponent(t.name);
    if (locked && locked.name) {
      return `<span class="rival-tag rival-ok">✓ va vs</span>${teamBadgeImg(locked)}<span>${esNameFor(locked.name)}</span>`;
    }
    // 2) Si no, mostramos los posibles rivales (ganadores) según la estructura.
    const slots = projection[t.group] || [];
    const teams = slots.map((s) => winnerByGroup[s]).filter(Boolean);
    if (teams.length === 0) return `<span class="thirds-tbd">Por definir</span>`;
    if (teams.length === 1) {
      return `${teamBadgeImg(teams[0])}<span>${esNameFor(teams[0].name)}</span><span class="rival-tag rival-proj" title="Único posible según la estructura">proyectado</span>`;
    }
    const flags = teams
      .map((w) => `<span class="rival-opt" title="${esNameFor(w.name)}">${teamBadgeImg(w)}</span>`)
      .join("");
    return `<span class="rival-range">${flags}</span><span class="rival-count">${teams.length} posibles</span>`;
  };

  const items = thirds
    .map((t, i) => {
      const q = i < 8; // los 8 mejores clasifican
      const elim = teamStatus[t.name] && teamStatus[t.name].eliminated;
      const dgStr = t.gd > 0 ? "+" + t.gd : "" + t.gd;
      const cls = elim ? "is-elim" : q ? "is-in" : "is-out";
      return `<div class="third-item ${cls}${i === 7 ? " is-cut" : ""}">
        <div class="third-head">
          <span class="third-pos">${i + 1}</span>
          ${teamBadgeImg({ name: t.name })}
          <span class="third-team">${esNameFor(t.name)}</span>
          <span class="third-grp">${t.group}</span>
          ${elim ? `<span class="third-elim-tag">Eliminado</span>` : ownerAvatarHtml(t.name)}
          <span class="third-pts"><strong>${t.pts}</strong> pts · ${dgStr} DG</span>
        </div>
        ${q ? `<div class="third-rival"><span class="third-rival-label">16avos</span>${rivalCell(t)}</div>` : ""}
      </div>`;
    })
    .join("");

  host.innerHTML = `
    <div class="group-card thirds-wrap">
      <h3 class="thirds-title">Mejores terceros <span>· clasifican 8</span></h3>
      <p class="thirds-note">Orden: puntos → dif. de goles → goles. <strong>Rival de 16avos</strong>: ✓ = ya confirmado por el cuadro oficial; si no, son los <strong>posibles rivales</strong> según la estructura oficial, que se van reduciendo en vivo conforme cierran los grupos.</p>
      <div class="thirds-list">${items}</div>
    </div>`;
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
    stabilizeBracket(allMatches); // conserva equipos de llaves aunque la API los pierda
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
  } else {
    empty.classList.add("hidden");
    todays.forEach((m) => list.appendChild(buildMatchCard(m)));
  }

  renderFeed();
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

  // Equipos que YA aparecen en el cuadro de eliminación: aseguraron su pase
  // (esto sí captura correctamente a los mejores terceros, porque la FIFA solo
  // los coloca en el cuadro una vez resueltos todos los grupos).
  knockoutTeams.forEach((name) => {
    teamStatus[name] = teamStatus[name] || {};
    teamStatus[name].advancing = true;
  });

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
  teams.forEach((t) => (res[t] = { top2: true, fourth: true }));

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
        if (worst > 2) res[n].top2 = false;   // podría caer fuera del top-2 (no asegurado)
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
      // Solo aseguran 16avos quienes ya garantizan top-2 (clasifican directo).
      // El 3er lugar NO se marca: depende de ser uno de los 8 mejores terceros,
      // que se define con resultados de otros grupos aún por jugarse.
      if (r[name].fourth) teamStatus[name].eliminated = true;
      else if (r[name].top2) teamStatus[name].advancing = true;
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

// La fuente de datos (football-data.org) a veces "pierde" temporalmente los
// equipos ya asignados a las llaves: los devuelve en null y luego otra vez con
// nombre, lo que hacía parpadear el cuadro. Recordamos el último equipo conocido
// de cada cruce (en localStorage) y lo conservamos si la API lo manda vacío.
function stabilizeBracket(matches) {
  let mem = {};
  try {
    mem = JSON.parse(localStorage.getItem("bracketMem") || "{}");
  } catch (e) {
    mem = {};
  }
  let changed = false;
  matches.forEach((m) => {
    if (!m.stage || m.stage === "GROUP_STAGE") return;
    const prev = mem[m.id];
    if (prev) {
      if (!m.homeTeam?.name && prev.home) m.homeTeam = prev.home;
      if (!m.awayTeam?.name && prev.away) m.awayTeam = prev.away;
    }
    if (m.homeTeam?.name || m.awayTeam?.name) {
      const entry = {
        home: m.homeTeam?.name ? m.homeTeam : prev?.home || null,
        away: m.awayTeam?.name ? m.awayTeam : prev?.away || null,
      };
      if (JSON.stringify(mem[m.id]) !== JSON.stringify(entry)) {
        mem[m.id] = entry;
        changed = true;
      }
    }
  });
  if (changed) {
    try {
      localStorage.setItem("bracketMem", JSON.stringify(mem));
    } catch (e) {
      /* almacenamiento lleno o no disponible: seguimos sin persistir */
    }
  }
}

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

// Cruces de 16avos que NO involucran a un tercero: el rival queda totalmente
// determinado por las posiciones de grupo (no necesitan la tabla de 495).
const R32_OPP = {
  "2A": "2B", "2B": "2A", "1F": "2C", "2C": "1F", "1C": "2F", "2F": "1C",
  "2E": "2I", "2I": "2E", "2K": "2L", "2L": "2K", "1H": "2J", "2J": "1H",
  "1J": "2H", "2H": "1J", "2D": "2G", "2G": "2D",
};

// Mapea equipos a su casilla (1X/2X) según la tabla actual, y marca grupos cerrados.
function buildR32SlotMaps(standings, matches) {
  const teamToSlot = {};
  const slotToTeam = {};
  const closed = {};
  (standings || [])
    .filter((s) => s.type === "TOTAL" && s.group)
    .forEach((g) => {
      const L = g.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "").trim();
      const ms = matches.filter((m) => m.stage === "GROUP_STAGE" && m.group === "GROUP_" + L);
      closed[L] = ms.length > 0 && ms.every((m) => m.status === "FINISHED");
      const sorted = [...g.table].sort((a, b) => a.position - b.position);
      if (sorted[0]) { teamToSlot[sorted[0].team.name] = "1" + L; slotToTeam["1" + L] = sorted[0].team; }
      if (sorted[1]) { teamToSlot[sorted[1].team.name] = "2" + L; slotToTeam["2" + L] = sorted[1].team; }
    });
  return { teamToSlot, slotToTeam, closed };
}

// Dado un equipo ya colocado, devuelve su rival si es un cruce determinístico
// (winner-vs-subcampeón) y el grupo del rival ya está cerrado.
function r32ProjectedOpponent(knownName, maps) {
  const slot = maps.teamToSlot[knownName];
  if (!slot) return null;
  const opp = R32_OPP[slot];
  if (!opp) return null; // enfrenta a un tercero -> no determinístico aquí
  if (!maps.closed[opp[1]]) return null; // grupo del rival aún abierto
  return maps.slotToTeam[opp] || null;
}

function bracketTeamHtml(team, isWinner, projected) {
  if (!team || !team.name) {
    return `<div class="bk-team bk-tbd"><span>Por definir</span></div>`;
  }
  return `<div class="bk-team ${isWinner ? "bk-win" : ""} ${projected ? "bk-proj" : ""}">
    ${team.crest ? `<img class="bk-crest" src="${team.crest}" alt="" loading="lazy" />` : ""}
    <span class="bk-name">${esNameFor(team.name)}</span>
    ${projected ? `<span class="bk-proj-tag" title="Proyectado por las posiciones de grupo">proy.</span>` : ownerAvatarHtml(team.name)}
  </div>`;
}

function bracketMatchHtml(m, maps) {
  const win = bracketWinnerSide(m);
  const h = m.score?.fullTime?.home;
  const a = m.score?.fullTime?.away;
  const hasScore = h != null && a != null;
  const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
  const dateLabel = m.utcDate ? `${formatDate(m.utcDate)} · ${formatTime(m.utcDate)}` : "";

  // Proyectamos el lado faltante en cruces determinísticos.
  let home = m.homeTeam, away = m.awayTeam, homeProj = false, awayProj = false;
  if (maps && m.stage === "LAST_32") {
    if ((!home || !home.name) && away && away.name) {
      const p = r32ProjectedOpponent(away.name, maps);
      if (p) { home = p; homeProj = true; }
    } else if ((!away || !away.name) && home && home.name) {
      const p = r32ProjectedOpponent(home.name, maps);
      if (p) { away = p; awayProj = true; }
    }
  }

  return `<div class="bk-match ${isLive ? "bk-live" : ""}">
    ${dateLabel ? `<div class="bk-date">${dateLabel}</div>` : ""}
    <div class="bk-row">
      ${bracketTeamHtml(home, win === "home", homeProj)}
      <span class="bk-score">${hasScore ? h : ""}</span>
    </div>
    <div class="bk-row">
      ${bracketTeamHtml(away, win === "away", awayProj)}
      <span class="bk-score">${hasScore ? a : ""}</span>
    </div>
  </div>`;
}

// Estructura oficial de 16avos en orden (Match 73-88). "3" = ese lado es un
// tercero (el otro lado es el ganador del grupo indicado en el slot home).
const R32_STRUCT = [
  ["2A", "2B"], ["1E", "3"], ["1F", "2C"], ["1C", "2F"], ["1I", "3"], ["2E", "2I"],
  ["1A", "3"], ["1L", "3"], ["1D", "3"], ["1G", "3"], ["2K", "2L"], ["1H", "2J"],
  ["1B", "3"], ["1J", "2H"], ["1K", "3"], ["2D", "2G"],
];

// Contexto de terceros: ranking, ganador/tercero por grupo y, por cada grupo
// ganador, qué terceros podría enfrentar (inverso de la proyección).
function thirdsContext(standings, matches) {
  const groups = (standings || []).filter((s) => s.type === "TOTAL" && s.group);
  if (groups.length === 0) return null;
  const letterOf = (g) => g.group.replace(/^GROUP_/, "").replace(/^Group\s*/i, "").trim();
  const winnerByGroup = {};
  const thirdByGroup = {};
  const thirds = [];
  groups.forEach((g) => {
    const L = letterOf(g);
    const s = [...g.table].sort((a, b) => a.position - b.position);
    if (s[0]) winnerByGroup[L] = s[0].team;
    if (s[2]) {
      thirdByGroup[L] = s[2].team;
      thirds.push({ group: L, name: s[2].team.name, pts: s[2].points, dg: s[2].goalDifference, gf: s[2].goalsFor });
    }
  });
  thirds.sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
  const top8 = thirds.slice(0, 8).map((t) => t.group);

  const winnerGroupOf = (name) => Object.keys(winnerByGroup).find((L) => winnerByGroup[L] && winnerByGroup[L].name === name);
  const fixed = {};
  top8.forEach((g) => {
    const tn = thirdByGroup[g] && thirdByGroup[g].name;
    const opp = tn ? findR32Opponent(tn) : null;
    const wg = opp && opp.name ? winnerGroupOf(opp.name) : null;
    if (wg) fixed[g] = wg;
  });
  const projection = projectThirdOpponents(top8, fixed);
  const possibleThirds = {};
  top8.forEach((g) => (projection[g] || []).forEach((wl) => { (possibleThirds[wl] = possibleThirds[wl] || []).push(g); }));

  return { thirds, top8, winnerByGroup, thirdByGroup, possibleThirds };
}

// Arma los 16 cruces de 16avos desde la estructura + posiciones actuales,
// enlazando con el partido real de la API (para fecha/marcador) por equipo.
function buildProjectedR32(standings, matches) {
  if (!standings) return null;
  const maps = buildR32SlotMaps(standings, matches);
  const tc = thirdsContext(standings, matches);
  const apiByTeam = {};
  matches.filter((m) => m.stage === "LAST_32").forEach((m) => {
    if (m.homeTeam?.name) apiByTeam[m.homeTeam.name] = m;
    if (m.awayTeam?.name) apiByTeam[m.awayTeam.name] = m;
  });
  // "proyectado" = lo deducimos nosotros porque la API aún no lo colocó.
  const resolveWR = (slot) => {
    const team = maps.slotToTeam[slot];
    if (!team) return { team: null };
    return { team, projected: !apiByTeam[team.name] };
  };
  return R32_STRUCT.map(([hs, as]) => {
    const home = resolveWR(hs);
    let away;
    if (as === "3") {
      const wg = hs[1];
      const opts = (tc && tc.possibleThirds[wg]) || [];
      if (opts.length === 1 && tc.thirdByGroup[opts[0]]) {
        const team = tc.thirdByGroup[opts[0]];
        away = { team, projected: !apiByTeam[team.name] };
      } else if (opts.length > 1) {
        away = { team: null, ambiguous: opts.length };
      } else {
        away = { team: null };
      }
    } else {
      away = resolveWR(as);
    }
    const apiMatch = (home.team && apiByTeam[home.team.name]) || (away.team && apiByTeam[away.team.name]) || null;
    return { home, away, apiMatch };
  });
}

function projTeamHtml(side, isWinner) {
  if (side.team) return bracketTeamHtml(side.team, isWinner, side.projected);
  if (side.ambiguous) return `<div class="bk-team bk-tbd"><span>${side.ambiguous} posibles 3º</span></div>`;
  return `<div class="bk-team bk-tbd"><span>Por definir</span></div>`;
}

function projMatchHtml(d) {
  const m = d.apiMatch;
  const isLive = m && (m.status === "IN_PLAY" || m.status === "PAUSED");
  const dateLabel = m && m.utcDate ? `${formatDate(m.utcDate)} · ${formatTime(m.utcDate)}` : "";
  const h = m?.score?.fullTime?.home;
  const a = m?.score?.fullTime?.away;
  const hasScore = h != null && a != null;
  const win = m ? bracketWinnerSide(m) : null;
  const winnerName = win === "home" ? m?.homeTeam?.name : win === "away" ? m?.awayTeam?.name : null;
  const homeWin = !!(winnerName && d.home.team && winnerName === d.home.team.name);
  const awayWin = !!(winnerName && d.away.team && winnerName === d.away.team.name);
  let hScore = "", aScore = "";
  if (hasScore && m) {
    const homeIsApiHome = d.home.team && m.homeTeam?.name === d.home.team.name;
    hScore = homeIsApiHome ? h : a;
    aScore = homeIsApiHome ? a : h;
  }
  return `<div class="bk-match ${isLive ? "bk-live" : ""}">
    ${dateLabel ? `<div class="bk-date">${dateLabel}</div>` : ""}
    <div class="bk-row">${projTeamHtml(d.home, homeWin)}<span class="bk-score">${hasScore ? hScore : ""}</span></div>
    <div class="bk-row">${projTeamHtml(d.away, awayWin)}<span class="bk-score">${hasScore ? aScore : ""}</span></div>
  </div>`;
}

// Orden del cuadro (top→bottom): los 16avos en el orden del árbol oficial, para
// que cada par consecutivo alimente un octavo. Índices sobre R32_STRUCT (M73=0…M88=15).
const R32_BRACKET_ORDER = [1, 4, 0, 2, 10, 11, 8, 9, 3, 5, 6, 7, 13, 15, 12, 14];

function treePlaceholderHtml() {
  return `<div class="bk-match bk-pending">
    <div class="bk-row"><div class="bk-team bk-tbd"><span>Por definir</span></div></div>
    <div class="bk-row"><div class="bk-team bk-tbd"><span>Por definir</span></div></div>
  </div>`;
}

let bracketView = (() => {
  try { return localStorage.getItem("bracketView") || "tree"; } catch (e) { return "tree"; }
})();

// Ganador de un partido de eliminación directa (considera penales).
function knockoutWinnerTeam(m) {
  if (!m || m.status !== "FINISHED") return null;
  const w = m.score?.winner;
  if (w === "HOME_TEAM") return m.homeTeam;
  if (w === "AWAY_TEAM") return m.awayTeam;
  const h = m.score?.fullTime?.home, a = m.score?.fullTime?.away;
  if (h != null && a != null && h !== a) return h > a ? m.homeTeam : m.awayTeam;
  return null;
}

function findKnockoutMatchByTeams(aName, bName) {
  if (!aName || !bName) return null;
  return (
    allMatches.find(
      (m) =>
        m.stage && m.stage !== "GROUP_STAGE" &&
        ((m.homeTeam?.name === aName && m.awayTeam?.name === bName) ||
          (m.homeTeam?.name === bName && m.awayTeam?.name === aName))
    ) || null
  );
}

// Arma TODAS las rondas con propagación de ganadores: cada ronda toma a los
// ganadores de la anterior. Devuelve [R32(16), Octavos(8), Cuartos(4), Semis(2), Final(1)].
function buildFullBracket(proj) {
  const r32 = R32_BRACKET_ORDER.map((i) => {
    const d = proj[i];
    return {
      a: d.home.team || null,
      b: d.away.team || null,
      projA: !!d.home.projected,
      projB: !!d.away.projected,
      ambigA: d.home.ambiguous || 0,
      ambigB: d.away.ambiguous || 0,
      apiMatch: d.apiMatch,
      winner: knockoutWinnerTeam(d.apiMatch),
    };
  });
  const rounds = [r32];
  let prev = r32;
  while (prev.length > 1) {
    const next = [];
    for (let k = 0; k < prev.length; k += 2) {
      const a = prev[k].winner || null;
      const b = prev[k + 1].winner || null;
      const apiMatch = a && b ? findKnockoutMatchByTeams(a.name, b.name) : null;
      next.push({ a, b, apiMatch, winner: knockoutWinnerTeam(apiMatch) });
    }
    rounds.push(next);
    prev = next;
  }
  return rounds;
}

function bracketSideHtml(team, isWinner, projected, ambiguous, isLoser) {
  if (team && team.name) {
    return `<div class="bk-team ${isWinner ? "bk-win" : ""} ${projected ? "bk-proj" : ""} ${isLoser ? "bk-loser" : ""}">
      ${teamBadgeImg(team)}
      <span class="bk-name">${esNameFor(team.name)}</span>
      ${projected ? `<span class="bk-proj-tag">proy.</span>` : ownerAvatarHtml(team.name)}
    </div>`;
  }
  if (ambiguous) return `<div class="bk-team bk-tbd"><span>${ambiguous} posibles 3º</span></div>`;
  return `<div class="bk-team bk-tbd"><span>Por definir</span></div>`;
}

function bracketBoxHtml(match) {
  const m = match.apiMatch;
  const isLive = m && (m.status === "IN_PLAY" || m.status === "PAUSED");
  const dateLabel = m && m.utcDate ? `${formatDate(m.utcDate)} · ${formatTime(m.utcDate)}` : "";
  const h = m?.score?.fullTime?.home, a = m?.score?.fullTime?.away;
  const hasScore = h != null && a != null;
  let aScore = "", bScore = "";
  if (hasScore && m) {
    const aIsHome = match.a && m.homeTeam?.name === match.a.name;
    aScore = aIsHome ? h : a;
    bScore = aIsHome ? a : h;
  }
  const winName = match.winner && match.winner.name;
  const aWin = !!(winName && match.a && match.a.name === winName);
  const bWin = !!(winName && match.b && match.b.name === winName);
  const aLose = !!(winName && match.a && match.a.name !== winName);
  const bLose = !!(winName && match.b && match.b.name !== winName);
  return `<div class="bk-match ${isLive ? "bk-live" : ""} ${match.a || match.b ? "" : "bk-pending"}">
    ${dateLabel ? `<div class="bk-date">${dateLabel}</div>` : ""}
    <div class="bk-row">${bracketSideHtml(match.a, aWin, match.projA, match.ambigA, aLose)}<span class="bk-score">${hasScore ? aScore : ""}</span></div>
    <div class="bk-row">${bracketSideHtml(match.b, bWin, match.projB, match.ambigB, bLose)}<span class="bk-score">${hasScore ? bScore : ""}</span></div>
  </div>`;
}

const BRACKET_TITLES = ["16avos de final", "Octavos de final", "Cuartos de final", "Semifinales", "Final"];

function renderBracket(matches) {
  const wrap = $("#bracket");
  const info = $("#bracket-info");
  if (!wrap) return;

  $$(".bk-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === bracketView));
  wrap.classList.toggle("bracket-radial", bracketView === "radial");

  const proj = buildProjectedR32(lastStandings, matches);
  if (!proj) {
    wrap.innerHTML = "";
    info.classList.remove("hidden");
    return;
  }

  const rounds = buildFullBracket(proj);

  if (bracketView === "cards") {
    renderBracketCards(rounds);
  } else if (bracketView === "radial") {
    renderBracketRadial(rounds);
  } else {
    renderBracketTree(rounds);
  }

  const ko = matches.filter((m) => m.stage && m.stage !== "GROUP_STAGE");
  const allDefined = ko.length > 0 && ko.every((m) => m.homeTeam?.name && m.awayTeam?.name);
  info.classList.toggle("hidden", allDefined);
}

// Vista árbol: columnas conectadas por líneas (bracket clásico).
function renderBracketTree(rounds) {
  const wrap = $("#bracket");
  wrap.innerHTML = `
    <div class="bk-tree">
      ${rounds
        .map(
          (round, idx) => `
        <div class="bk-round">
          <div class="bk-round-title">${BRACKET_TITLES[idx]}</div>
          <div class="bk-round-body">
            ${round.map((m) => `<div class="bk-cell">${bracketBoxHtml(m)}</div>`).join("")}
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

// Vista tarjetas: una columna por ronda con scroll (más cómoda en celular).
function renderBracketCards(rounds) {
  const wrap = $("#bracket");
  const cols = rounds.map((round, idx) => {
    let ms = round;
    if (idx === 0) {
      ms = [...round].sort((a, b) => {
        const da = a.apiMatch ? new Date(a.apiMatch.utcDate) : Infinity;
        const db = b.apiMatch ? new Date(b.apiMatch.utcDate) : Infinity;
        return da - db;
      });
    }
    return `<div class="bk-col"><div class="bk-col-title">${BRACKET_TITLES[idx]}</div>${ms.map(bracketBoxHtml).join("")}</div>`;
  });
  wrap.innerHTML = cols.join("");
}

// Vista radial: bracket circular con las banderas alrededor y el trofeo al centro.
function radialPolar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) };
}

function radialBadgeHtml(team, p, cls) {
  if (!team || !team.name) {
    return `<div class="radial-badge rad-tbd ${cls}" style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%"><span class="rad-q">?</span></div>`;
  }
  const flag = flagFor(team.name);
  const owner = ownerFor(team.name);
  const inner = flag ? `<img class="rad-flag" src="https://flagcdn.com/w80/${flag}.png" alt="" />` : `<span class="rad-q">?</span>`;
  const ownerImg = owner
    ? `<img class="rad-owner" src="images/${owner.photo}" alt="" onerror="this.style.display='none'" />`
    : "";
  return `<div class="radial-badge ${cls}" style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%" title="${esNameFor(team.name)}${owner ? " · " + owner.name : ""}">${inner}${ownerImg}</div>`;
}

function renderBracketRadial(rounds) {
  const wrap = $("#bracket");

  // 32 "lados" (cada partido aporta 2 equipos) en orden del cuadro.
  const leaves = [];
  rounds[0].forEach((m) => { leaves.push({ team: m.a, winner: m.winner }); leaves.push({ team: m.b, winner: m.winner }); });

  const N = leaves.length; // 32
  const radii = [45, 37, 28.5, 20, 11.5, 0]; // hojas, R32, R16, cuartos, semis, final

  const levels = [Array.from({ length: N }, (_, i) => -90 + i * (360 / N))];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next = [];
    for (let k = 0; k < cur.length; k += 2) next.push((cur[k] + cur[k + 1]) / 2);
    levels.push(next);
  }
  const pos = levels.map((angs, lvl) => angs.map((a) => radialPolar(radii[lvl], a)));
  pos[pos.length - 1] = [{ x: 50, y: 50 }];

  let lines = "";
  for (let lvl = 0; lvl < pos.length - 1; lvl++) {
    pos[lvl].forEach((p, idx) => {
      const parent = pos[lvl + 1][Math.floor(idx / 2)];
      lines += `<line x1="${p.x.toFixed(2)}" y1="${p.y.toFixed(2)}" x2="${parent.x.toFixed(2)}" y2="${parent.y.toFixed(2)}" />`;
    });
  }

  // Banderas de las hojas (32). El equipo que perdió su partido se atenúa.
  const leafBadges = leaves
    .map((leaf, i) => {
      const isLoser = leaf.winner && leaf.team && leaf.winner.name !== leaf.team.name;
      const isWinner = leaf.winner && leaf.team && leaf.winner.name === leaf.team.name;
      return radialBadgeHtml(leaf.team, pos[0][i], `rad-leaf ${isLoser ? "rad-lost" : ""} ${isWinner ? "rad-won" : ""}`);
    })
    .join("");

  // Nodos internos: si el partido de esa posición ya tiene ganador, mostramos su
  // bandera (el equipo avanzó hacia el centro); si no, un círculo vacío.
  let nodeBadges = "";
  let emptyNodes = "";
  for (let lvl = 1; lvl < pos.length - 1; lvl++) {
    const roundMatches = rounds[lvl - 1]; // rounds[0]=R32 -> nivel 1, etc.
    pos[lvl].forEach((p, k) => {
      const w = roundMatches[k] && roundMatches[k].winner;
      if (w) nodeBadges += radialBadgeHtml(w, p, "rad-node-badge");
      else emptyNodes += `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="1.1" />`;
    });
  }

  // Centro: campeón si la final ya tiene ganador, si no el trofeo.
  const champ = rounds[rounds.length - 1][0] && rounds[rounds.length - 1][0].winner;
  const centerHtml = champ
    ? radialBadgeHtml(champ, { x: 50, y: 50 }, "rad-champ")
    : `<div class="radial-center">🏆</div>`;

  wrap.innerHTML = `
    <div class="radial-wrap">
      <div class="radial">
        <svg class="radial-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <g class="rad-lines">${lines}</g>
          <g class="rad-nodes">${emptyNodes}</g>
        </svg>
        <div class="radial-glow"></div>
        ${centerHtml}
        ${nodeBadges}
        ${leafBadges}
      </div>
    </div>`;
}

function initBracketToggle() {
  $$(".bk-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      bracketView = btn.dataset.view;
      try { localStorage.setItem("bracketView", bracketView); } catch (e) {}
      if (allMatches.length) renderBracket(allMatches);
    });
  });
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
      closeGroupModal();
    }
  });
}

/* ---------- Modal de grupo (partidos del grupo) ---------- */
function groupMatchRowHtml(m) {
  const homeFlag = flagFor(m.homeTeam.name);
  const awayFlag = flagFor(m.awayTeam.name);
  const home = m.score?.fullTime?.home ?? m.score?.halfTime?.home;
  const away = m.score?.fullTime?.away ?? m.score?.halfTime?.away;
  const hasScore = home != null && away != null;
  const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
  const win = bracketWinnerSide(m); // home | away | null (sólo finalizados)
  return `<div class="modal-match">
    <div class="modal-match-header">
      <span>${formatDate(m.utcDate)} · ${formatTime(m.utcDate)}</span>
      <span class="match-status ${statusClass(m.status)}">${isLive ? "EN VIVO" : STATUS_LABELS[m.status] || m.status}</span>
    </div>
    <div class="match-row">
      <div class="match-team ${win === "home" ? "mt-win" : ""}">
        ${homeFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${homeFlag}.png" alt="" />` : ""}
        <span>${esNameFor(m.homeTeam.name)}</span>
        ${ownerAvatarHtml(m.homeTeam.name)}
      </div>
      <span class="match-row-score">${hasScore ? home : "-"}</span>
    </div>
    <div class="match-row">
      <div class="match-team ${win === "away" ? "mt-win" : ""}">
        ${awayFlag ? `<img class="flag-mini" src="https://flagcdn.com/w40/${awayFlag}.png" alt="" />` : ""}
        <span>${esNameFor(m.awayTeam.name)}</span>
        ${ownerAvatarHtml(m.awayTeam.name)}
      </div>
      <span class="match-row-score">${hasScore ? away : "-"}</span>
    </div>
  </div>`;
}

function openGroupModal(letter) {
  const ms = allMatches
    .filter((m) => m.stage === "GROUP_STAGE" && m.group === "GROUP_" + letter)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const played = ms.filter((m) => m.status === "FINISHED");
  const upcoming = ms.filter((m) => m.status !== "FINISHED");

  $("#group-modal-content").innerHTML = `
    <h2>Grupo ${letter}</h2>
    <div class="modal-section-title">Jugados</div>
    ${played.length ? played.map(groupMatchRowHtml).join("") : '<div class="modal-empty">Aún no hay partidos jugados.</div>'}
    <div class="modal-section-title">Por jugar</div>
    ${upcoming.length ? upcoming.map(groupMatchRowHtml).join("") : '<div class="modal-empty">No quedan partidos por jugar.</div>'}
  `;
  $("#group-modal").classList.remove("hidden");
  syncBodyScrollLock();
}

function closeGroupModal() {
  $("#group-modal").classList.add("hidden");
  syncBodyScrollLock();
}

function initGroupModal() {
  $("#group-modal-close").addEventListener("click", closeGroupModal);
  $("#group-modal").addEventListener("click", (e) => {
    if (e.target.id === "group-modal") closeGroupModal();
  });
}

/* ---------- Apuestas ---------- */
function syncBodyScrollLock() {
  const anyOpen =
    !$("#person-modal").classList.contains("hidden") ||
    !$("#bet-modal").classList.contains("hidden") ||
    !$("#group-modal").classList.contains("hidden");
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

  renderBetsScoreboard(bets);
  renderFeed();

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
        <span class="bet-status ${bet.status}">${
          bet.status === "aceptada" ? "Aceptada" : bet.status === "rechazada" ? "Rechazada" : "Pendiente"
        }</span>
        ${
          bet.status === "pendiente"
            ? `<button class="bet-accept-btn" data-id="${bet.id}">Aceptar</button>
               <button class="bet-reject-btn" data-id="${bet.id}">Rechazar</button>`
            : ""
        }
        <button class="bet-delete-btn" data-id="${bet.id}" title="Eliminar">✕</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".bet-accept-btn").forEach((btn) => {
    btn.addEventListener("click", () => acceptBet(btn.dataset.id));
  });
  list.querySelectorAll(".bet-reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectBet(btn.dataset.id));
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

async function rejectBet(id) {
  if (!confirm("¿Rechazar esta apuesta?")) return;
  try {
    const res = await fetch("/api/bets/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    loadBets();
  } catch (e) {
    alert("No se pudo rechazar la apuesta. Intenta de nuevo.");
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

/* ---------- Marcador de apuestas ---------- */
function renderBetsScoreboard(bets) {
  const host = $("#bets-scoreboard");
  if (!host) return;
  bets = bets || lastBets || [];

  const tally = {};
  const get = (n) => (tally[n] = tally[n] || { won: 0, lost: 0, wonAmt: 0, lostAmt: 0, pending: 0 });

  bets.forEach((b) => {
    if (b.status === "rechazada") return;
    const players = [b.fromName, b.targetName].filter(Boolean);
    const match = findMatchByTeams(b.homeTeamEn, b.awayTeamEn);
    const finished = match && match.status === "FINISHED";
    const home = match?.score?.fullTime?.home;
    const away = match?.score?.fullTime?.away;

    if (b.status !== "aceptada" || !finished || home == null || away == null || home === away) {
      players.forEach((n) => get(n).pending++);
      return;
    }
    const winnerTeam = home > away ? b.homeTeamEn : b.awayTeamEn;
    const owner = ownerFor(winnerTeam);
    const wname = owner ? owner.name : null;
    if (!wname || !players.includes(wname)) {
      players.forEach((n) => get(n).pending++);
      return;
    }
    const loser = players.find((n) => n !== wname);
    get(wname).won++; get(wname).wonAmt += Number(b.amount) || 0;
    if (loser) { get(loser).lost++; get(loser).lostAmt += Number(b.amount) || 0; }
  });

  const rows = Object.keys(tally).map((n) => ({ name: n, ...tally[n], net: tally[n].wonAmt - tally[n].lostAmt }));
  if (rows.length === 0) { host.innerHTML = ""; return; }
  rows.sort((a, b) => b.net - a.net || b.won - a.won);

  host.innerHTML = `
    <div class="lb-card sb-card">
      <h3 class="lb-title">💸 Marcador de apuestas</h3>
      <div class="sb-list">
        ${rows
          .map(
            (r) => `
          <div class="sb-row">
            <span class="sb-name">${r.name}</span>
            <span class="sb-record"><span class="sb-w">${r.won}G</span> · <span class="sb-l">${r.lost}P</span>${r.pending ? ` · <span class="sb-p">${r.pending} pend.</span>` : ""}</span>
            <span class="sb-net ${r.net > 0 ? "net-pos" : r.net < 0 ? "net-neg" : ""}">${r.net > 0 ? "+" : ""}$${r.net}</span>
          </div>`
          )
          .join("")}
      </div>
      <p class="lb-note">Saldo de apuestas aceptadas ya jugadas. G = ganadas, P = perdidas.</p>
    </div>`;
}

/* ---------- Novedades / actividad ---------- */
function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function renderFeed() {
  const host = $("#feed");
  if (!host) return;
  const items = [];

  (allMatches || [])
    .filter((m) => m.status === "FINISHED" && m.score?.fullTime?.home != null)
    .sort((a, b) => new Date(b.lastUpdated || b.utcDate) - new Date(a.lastUpdated || a.utcDate))
    .slice(0, 12)
    .forEach((m) => {
      items.push({
        when: new Date(m.lastUpdated || m.utcDate),
        icon: "⚽",
        text: `${esNameFor(m.homeTeam.name)} ${m.score.fullTime.home}–${m.score.fullTime.away} ${esNameFor(m.awayTeam.name)}`,
        sub: stageLabelFor(m.stage) || "Fase de grupos",
      });
    });

  (lastBets || []).slice(0, 8).forEach((b) => {
    items.push({
      when: new Date(b.createdAt),
      icon: "🎲",
      text: `${b.fromName || "Alguien"} retó a ${b.targetName} · $${b.amount}`,
      sub: b.context || "Apuesta",
    });
  });

  items.sort((a, b) => b.when - a.when);
  host.innerHTML =
    items
      .slice(0, 25)
      .map(
        (it) => `
      <div class="feed-item">
        <span class="feed-icon">${it.icon}</span>
        <div class="feed-body">
          <div class="feed-text">${it.text}</div>
          <div class="feed-sub">${it.sub} · ${timeAgo(it.when)}</div>
        </div>
      </div>`
      )
      .join("") || `<div class="matches-empty">Sin novedades por ahora.</div>`;
}

/* ---------- Goleadores ---------- */
let lastScorers = [];

async function loadScorers() {
  try {
    const res = await fetch("/api/scorers", { cache: "no-store" });
    const data = await res.json();
    if (data.error || !data.scorers) {
      $("#scorers-warning").classList.remove("hidden");
      return false;
    }
    $("#scorers-warning").classList.add("hidden");
    lastScorers = data.scorers;
    renderScorers(lastScorers);
    return true;
  } catch (e) {
    $("#scorers-warning").classList.remove("hidden");
    return false;
  }
}

function renderScorers(scorers) {
  const host = $("#scorers-list");
  if (!host) return;
  if (!scorers || scorers.length === 0) {
    host.innerHTML = `<div class="matches-empty">Aún no hay goles registrados.</div>`;
    return;
  }

  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1);

  const rows = scorers
    .map((s, i) => {
      const teamEn = s.team?.name;
      const flag = teamEn ? flagFor(teamEn) : null;
      const owner = teamEn ? ownerFor(teamEn) : null;
      const teamEs = teamEn ? esNameFor(teamEn) : "";
      return `<div class="scorer-row ${i === 0 ? "scorer-first" : ""}">
        <span class="scorer-rank">${medal(i)}</span>
        ${flag ? `<img class="scorer-flag" src="https://flagcdn.com/w40/${flag}.png" alt="" />`
               : s.team?.crest ? `<img class="scorer-crest" src="${s.team.crest}" alt="" loading="lazy" />` : ""}
        <div class="scorer-info">
          <div class="scorer-name">${s.player?.name || "?"}</div>
          <div class="scorer-team">${teamEs}${owner ? ` · <strong>${owner.name}</strong>` : ""}</div>
        </div>
        <span class="scorer-goals">${s.goals}<small>⚽</small></span>
      </div>`;
    })
    .join("");

  host.innerHTML = `
    <div class="lb-card">
      <h3 class="lb-title">⚽ Tabla de goleo</h3>
      <p class="lb-note">Máximos goleadores del Mundial. El nombre en negrita es el dueño de ese equipo en la quiniela.</p>
      <div class="scorer-rows">${rows}</div>
    </div>`;
}

/* ---------- Tema claro/oscuro ---------- */
function initTheme() {
  const btn = $("#theme-toggle");
  if (!btn) return;
  const sync = () => (btn.textContent = document.documentElement.classList.contains("dark") ? "☀️" : "🌙");
  sync();
  btn.addEventListener("click", () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) {}
    sync();
  });
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
  scorers: 90000,      // goleadores
};

let matchesTimer = null;
let standingsTimer = null;
let betsTimer = null;
let scorersTimer = null;
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
    loadScorers(),
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

function scheduleScorers() {
  clearTimeout(scorersTimer);
  scorersTimer = setTimeout(async () => {
    await loadScorers();
    scheduleScorers();
  }, POLL.scorers);
}

function startSchedules() {
  scheduleMatches();
  scheduleStandings();
  scheduleBets();
  scheduleScorers();
}

function pauseSchedules() {
  clearTimeout(matchesTimer);
  clearTimeout(standingsTimer);
  clearTimeout(betsTimer);
  clearTimeout(scorersTimer);
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
  checkForUpdate(); // si hay versión nueva, recarga sola a la última
  detectStandalone();
  initTheme();
  initTabs();
  initModal();
  initGroupModal();
  initBetModal();
  initBracketToggle();
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
