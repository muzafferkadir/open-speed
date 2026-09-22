import { $ } from '../core/dom.js';
import type { Race } from '../game/Race.js';

export const formatTime = (t: number) =>
 `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export function raceStatus(race?: Race): string {
 if (!race) return '';
 if (race.playerFinished) return `FINISH · P${race.position()}`;
 return `P${race.position()}/${race.count} · LAP ${race.playerLap}/${race.laps}`;
}

export class Results {
 private shown = false;

 show(race: Race) {
  const rows = race.standings();
  if (!this.shown) {
   this.shown = true;
   const you = rows.find(r => r.you)!;
   $('results').hidden = false;
   $('results-title').textContent = you.position === 1 ? 'You won!' : `Finished P${you.position}`;
   $('results').classList.toggle('won', you.position === 1);
  }
  $('results-list').replaceChildren(...rows.map(r => {
   const li = document.createElement('li');
   li.classList.toggle('you', r.you);
   const swatch = document.createElement('i');
   swatch.style.background = r.tint;
   li.append(
    element('b', `P${r.position}`),
    swatch,
    element('span', r.name),
    element('small', r.finished ? formatTime(r.finished) : `Lap ${Math.min(race.laps, r.laps + 1)}`),
   );
   return li;
  }));
 }

 hide() {
  this.shown = false;
  $('results').hidden = true;
 }
}

function element(tag: string, text: string) {
 const node = document.createElement(tag);
 node.textContent = text;
 return node;
}
