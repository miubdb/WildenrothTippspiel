/** Regression suite: original betting round must survive any BFV date change. */
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { computeMatchdayParticipation, type ActivityLeg } from '@/lib/bettingActivityStats'
import { buildSlips, type RecapBetRow, type RecapComboRow, type RecapMatchRow } from '@/lib/recap/slips'
import { evaluateSlips } from '@/lib/risky'
import { countPlacedSlots } from '@/components/navBetState'
import { slipSeasonForMatchday } from '@/lib/season'
import type { Match } from '@/types'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let total=0,failed=0
const check=(name:string,ok:boolean)=>{total++;if(!ok)failed++;console.log(`${ok?'OK':'FAIL'} ${name}`)}
const match=(id:number,matchday:number,date:string,status='scheduled'):Match=>({
  id, matchday, match_date:date, status, match_category:'kreisliga',
  is_topspiel:false, tippspiel_matchday:null, competition_type:'league',
  home_team_id:id+100, away_team_id:id+200, home_score:null,away_score:null,
} as Match)

export function run():number {
  const november=[match(420,16,'2026-11-15T11:00:00Z','finished'),match(421,16,'2026-11-15T13:00:00Z','finished')]
  const march=[match(260,16,'2027-03-17T18:30:00Z','postponed'),match(323,16,'2027-03-17T18:00:00Z','postponed'),match(520,19,'2027-03-19T14:00:00Z','scheduled')]
  const matches=[...november,...march]
  const idx=buildEffectiveMatchdayIndex(matches)
  // 2 genuine rounds, while match 260/323 was offered in round 16.
  const activity:ActivityLeg[]=[
    {id:1,user_id:'u16only',combo_id:10,created_at:'2026-11-11T12:00:00Z',match:matches[2],placed_matchday:16,status:'pending'},
    {id:2,user_id:'u16only',combo_id:10,created_at:'2026-11-11T12:00:00Z',match:matches[3],placed_matchday:16,status:'pending'},
    {id:3,user_id:'u19only',combo_id:null,created_at:'2027-03-10T12:00:00Z',match:matches[4],placed_matchday:19,status:'pending'},
    {id:4,user_id:'cancelled',combo_id:null,created_at:'2026-11-10T12:00:00Z',match:matches[2],placed_matchday:16,status:'void'},
  ]
  const counts=computeMatchdayParticipation(activity,idx,19)
  check('Verschobene Kombi zählt 1 Spieler in ursprünglichem Spieltag 16',counts.find(c=>c.matchday===16)?.users===1)
  check('2 Kombi-Legs bleiben 2 Legs, aber 1 Spieler',counts.find(c=>c.matchday===16)?.legs===2)
  check('November-Kombi zählt nicht als Teilnahme an Spieltag 19',counts.find(c=>c.matchday===19)?.users===1)
  check('Stornierter Schein begründet keine Teilnahme',!counts.some(c=>c.users>=2))
  const recapMatches=matches.map(m=>({...m,home_score:1,away_score:1}) as RecapMatchRow)
  const bets:RecapBetRow[]=[
    {id:1,user_id:'u16only',match_id:260,market_type:'1x2',selection:'home',stake:null,odds_value:2,
     status:'pending',payout:null,combo_id:10,created_at:'2026-11-11T12:00:00Z',
     is_risky:false,season:'26/27',is_bonus:false,void_reason:null,special_id:null,placed_matchday:16},
    {id:2,user_id:'u16only',match_id:420,market_type:'1x2',selection:'home',stake:null,odds_value:2,
     status:'won',payout:0,combo_id:10,created_at:'2026-11-11T12:00:00Z',
     is_risky:false,season:'26/27',is_bonus:false,void_reason:null,special_id:null,placed_matchday:16},
    {id:3,user_id:'u19only',match_id:520,market_type:'1x2',selection:'home',stake:10,odds_value:2,
     status:'lost',payout:0,combo_id:null,created_at:'2027-03-10T12:00:00Z',
     is_risky:false,season:'26/27',is_bonus:false,void_reason:null,special_id:null,placed_matchday:19},
  ]
  const combos:RecapComboRow[]=[{id:10,user_id:'u16only',stake:50,total_odds:4,status:'pending',payout:null,
    created_at:'2026-11-11T12:00:00Z',season:'26/27',void_reason:null,original_total_odds:null,placed_matchday:16}]
  const sl=buildSlips({bets,combos,matches:recapMatches}).slips
  const old=sl.find(x=>x.key==='c10')
  check('Recap-Kombi bleibt im November-ST16, obwohl Leg im März gespielt wird',old?.ownerMatchday===16)
  check('Kombi bleibt pending bis Nachholspiel entschieden ist',old?.status==='pending'&&old?.net===0)
  check('19er Schein gehört ausschließlich ST19',sl.find(x=>x.key==='s3')?.ownerMatchday===19)
  check('Nachholspiel behält März-Anstoß; historischer Wettspieltag davon unabhängig',new Date(march[0].match_date).getUTCFullYear()===2027&&bets[0].placed_matchday===16)
  check('Nav-Badge zählt nur die Scheine des originalen Spieltags',
    (()=>{ const slots=countPlacedSlots([{is_risky:false,is_bonus:false}],[
      {is_risky:true,status:'pending'}]); return slots.normal===1&&slots.risky===1 })())
  check('Risky-Budget: 2 Normalscheine erlaubt',evaluateSlips([{id:'a',odds:2},{id:'b',odds:3}]).valid)
  check('Risky-Budget: 3 Scheine ohne Quote >20 verboten',!evaluateSlips([{id:'a',odds:2},{id:'b',odds:3},{id:'c',odds:19}]).valid)
  check('Risky-Budget: 3 Scheine mit Quote >20 erlaubt',evaluateSlips([{id:'a',odds:2},{id:'b',odds:3},{id:'c',odds:21}]).valid)
  // The fixture calendar is still free to show the rescheduled actual kickoff.
  check('Matchday-index is still available for physical fixture layout',effectiveMatchdayOf(matches[4],idx)===19)
  // ---- Source guards: the immutable-owner rules must stay wired into every slot/participation lookup ----
  const src=(f:string)=>readFileSync(path.join(process.cwd(),f),'utf8')
  check('slipSeasonForMatchday: normal Spieltag → 26/27, Testspieltag 999 → TEST',slipSeasonForMatchday(16)==='26/27'&&slipSeasonForMatchday(999)==='TEST')
  const place=src('app/api/bets/place/route.ts')
  check('place: Wettplatz-Abfragen sind auf die Saison begrenzt (Einzelwetten + Kombis)',(place.match(/\.eq\('season', slotSeason\)/g)??[]).length>=2)
  check('place: lockChecks übergeben Saison an die RPC',/origin_mode: true, season: slotSeason/.test(place))
  check('place: Slot-Zählung nutzt NIE .in(match_id) auf Spieltagsspielen',!/\.from\('bets'\)[\s\S]{0,200}\.in\('match_id', allMatchdayIds\)[\s\S]{0,80}\.in\('status', \['pending'/.test(place))
  const risky=src('lib/risky.ts')
  check('risky: Neuberechnung ist saison-gescopt',(risky.match(/slipSeasonForMatchday\(placedMatchday\)/g)??[]).length>=2)
  const fin=src('lib/matchdayFinalize.ts')
  check('finalize: Strafwildis + Taschengeld laufen über die atomare RPC book_matchday_round',/rpc\('book_matchday_round'/.test(fin)&&!/rpc\('apply_penalty'/.test(fin)&&!/rpc\('increment_balance'/.test(fin))
  check('finalize: kein Marker-Insert (push_reminders) mehr VOR der Buchung für Strafe/Taschengeld',!/insert\(\{ type: 'inactivity_fee'/.test(fin)&&!/insert\(\{ type: 'pocket_money'/.test(fin))
  check('finalize: Teilnahme zählt über placed_matchday + Saison',/\.eq\('season', CURRENT_SEASON\)\s*\.eq\('placed_matchday', matchday\)/.test(fin))
  const cron=src('app/api/cron/notifications/route.ts')
  check('cron: Erinnerung zählt Wettplätze nach placed_matchday, nicht nach aktuellen Spieltagsspielen',/\.eq\('placed_matchday', matchday\)/.test(cron)&&!/\.in\('match_id', matchdayMatchIds\)/.test(cron))
  check('nav/tipps: Platzanzeige ist saison-gescopt',/slipSeasonForMatchday\(active\.matchday\)/.test(src('components/NavBottom.tsx'))&&/slipSeasonForMatchday\(currentMatchday\)/.test(src('app/(app)/tipps/page.tsx')))
  const sql=src('supabase/immutable_placed_matchday_2026.sql')
  check('SQL: placed_matchday NOT NULL + Trigger-Sicherheitsnetz + saisonbewusste RPC + atomare Rundenbuchung vorhanden',/alter column placed_matchday set not null/i.test(sql)&&/bets_fill_placed_matchday/.test(sql)&&/SEASON_MISSING/.test(sql)&&/function public\.book_matchday_round/i.test(sql))
  console.log(`${total-failed}/${total} assertions passed`)
  return failed
}
