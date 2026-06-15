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

async function main() {
  console.log('Fetching World Cup matches...');
  const matchesData = await fetchJSON(`${API_BASE}/competitions/${COMPETITION}/matches`);
  const standingsData = await fetchJSON(`${API_BASE}/competitions/${COMPETITION}/standings`);
  const scorersData = await fetchJSON(`${API_BASE}/competitions/${COMPETITION}/scorers?limit=20`);

  // Process fixtures
  const fixtures = matchesData.matches.map(m => ({
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
    events: (m.goals || []).map(g => ({
      type: 'goal',
      player: g.scorer?.name || 'Unknown',
      team: g.team?.id === m.homeTeam.id ? 'h' : 'a',
      min: g.minute ? `${g.minute}'` : '',
      ...(g.assist?.name && { assist: g.assist.name })
    }))
  }));

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
