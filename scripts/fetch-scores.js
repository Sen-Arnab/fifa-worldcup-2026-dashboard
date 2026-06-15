const fs = require('fs');

const API_BASE = 'https://api.football-data.org/v4';
const COMPETITION = 2000; // FIFA World Cup
const TOKEN = process.env.FOOTBALL_DATA_API_KEY;

const headers = { 'X-Auth-Token': TOKEN };

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Map API team names to our dashboard names
const TEAM_MAP = {
  "Korea Republic": "South Korea",
  "Côte d'Ivoire": "Ivory Coast",
  "Türkiye": "Türkiye",
  "Bosnia-Herzegovina": "Bosnia and Herzegovina",
  "DR Congo": "DR Congo",
  "United States": "USA",
  "Czech Republic": "Czechia",
  "Curaçao": "Curaçao",
};

function mapTeam(name) { return TEAM_MAP[name] || name; }

function mapStatus(status) {
  if (status === 'FINISHED') return 'done';
  if (status === 'IN_PLAY' || status === 'PAUSED') return 'live';
  return 'soon';
}

// Rate-limit helper (free tier: 10 req/min)
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchMatchDetail(id) {
  await delay(6500); // stay under 10 req/min
  return fetchJSON(`${API_BASE}/matches/${id}`);
}

async function main() {
  console.log('Fetching World Cup matches...');
  const matchesData = await fetchJSON(`${API_BASE}/competitions/${COMPETITION}/matches`);
  const standingsData = await fetchJSON(`${API_BASE}/competitions/${COMPETITION}/standings`);
  await delay(6500);
  const scorersData = await fetchJSON(`${API_BASE}/competitions/${COMPETITION}/scorers?limit=20`);

  // Fetch detailed data for finished/live matches (has lineups & bookings)
  const finishedIds = matchesData.matches
    .filter(m => m.status === 'FINISHED' || m.status === 'IN_PLAY' || m.status === 'PAUSED')
    .map(m => m.id);

  console.log(`Fetching details for ${finishedIds.length} played matches...`);
  const matchDetails = {};
  for (const id of finishedIds) {
    try {
      matchDetails[id] = await fetchMatchDetail(id);
    } catch (e) {
      console.warn(`Failed to fetch match ${id}: ${e.message}`);
    }
  }

  // Process fixtures
  const fixtures = matchesData.matches.map(m => {
    const detail = matchDetails[m.id];
    const events = [];

    // Goals
    const goals = detail?.goals || m.goals || [];
    for (const g of goals) {
      events.push({
        type: 'goal',
        player: g.scorer?.name || 'Unknown',
        team: g.team?.id === m.homeTeam.id ? 'h' : 'a',
        min: g.minute ? (g.injuryTime ? `${g.minute}+${g.injuryTime}'` : `${g.minute}'`) : '',
        ...(g.assist?.name && { assist: g.assist.name })
      });
    }

    // Bookings (cards)
    const bookings = detail?.bookings || [];
    for (const b of bookings) {
      events.push({
        type: b.card === 'RED' ? 'rc' : 'yc',
        player: b.player?.name || 'Unknown',
        team: b.team?.id === m.homeTeam.id ? 'h' : 'a',
        min: b.minute ? `${b.minute}'` : ''
      });
    }

    // Lineups
    let lineups = null;
    if (detail?.homeTeam?.lineup?.length) {
      lineups = {
        home: {
          formation: detail.homeTeam.formation || '',
          lineup: detail.homeTeam.lineup.map(p => ({ name: p.name, pos: p.position, num: p.shirtNumber })),
          bench: (detail.homeTeam.bench || []).map(p => ({ name: p.name, pos: p.position, num: p.shirtNumber }))
        },
        away: {
          formation: detail.awayTeam.formation || '',
          lineup: detail.awayTeam.lineup.map(p => ({ name: p.name, pos: p.position, num: p.shirtNumber })),
          bench: (detail.awayTeam.bench || []).map(p => ({ name: p.name, pos: p.position, num: p.shirtNumber }))
        }
      };
    }

    return {
      id: m.id,
      d: m.utcDate.slice(0, 10),
      h: mapTeam(m.homeTeam.name),
      a: mapTeam(m.awayTeam.name),
      g: m.group ? m.group.replace('GROUP_', '') : '',
      v: m.venue || '',
      t: m.utcDate.slice(11, 16),
      s: m.score.fullTime.home !== null
        ? `${m.score.fullTime.home} - ${m.score.fullTime.away}`
        : null,
      st: mapStatus(m.status),
      events,
      ...(lineups && { lineups })
    };
  });

  // Process standings
  const standings = {};
  for (const group of standingsData.standings) {
    if (group.group) {
      const key = group.group.replace('GROUP_', '');
      standings[key] = group.table.map(t => ({
        t: mapTeam(t.team.name),
        pts: t.points,
        gp: t.playedGames,
        w: t.won,
        l: t.lost,
        d: t.draw,
        gf: t.goalsFor,
        ga: t.goalsAgainst
      }));
    }
  }

  // Process top scorers
  const topScorers = scorersData.scorers.map(s => ({
    name: s.player.name,
    team: mapTeam(s.team.name),
    goals: s.numberOfGoals,
    assists: s.assists || 0
  }));

  const data = {
    updatedAt: new Date().toISOString(),
    fixtures,
    standings,
    topScorers,
    totalGoals: fixtures.reduce((sum, f) => {
      if (f.s) {
        const [h, a] = f.s.split(' - ').map(Number);
        return sum + h + a;
      }
      return sum;
    }, 0),
    matchesPlayed: fixtures.filter(f => f.st === 'done').length
  };

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log(`Done. ${data.matchesPlayed} matches played, ${data.totalGoals} goals.`);
}

main().catch(e => { console.error(e); process.exit(1); });
