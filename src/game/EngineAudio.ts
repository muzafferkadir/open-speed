/** RPM-driven engine loops sourced from the Midtown Madness Impala pack. */
export class EngineAudio {
 private context?: AudioContext; private idle?: AudioBufferSourceNode; private high?: AudioBufferSourceNode;
 private idleGain?: GainNode; private highGain?: GainNode; private master?: GainNode;
 enabled=false; private level=1;
 async toggle():Promise<boolean>{if(!this.context) await this.createGraph(); if(!this.context)return false; await this.context.resume(); this.enabled=!this.enabled; if(!this.enabled)this.setGains(0,0); return this.enabled;}
 setVolume(level:number){this.level=Math.min(1,Math.max(0,level));}
 update(rpm:number,audible:boolean){if(!this.context||!this.idle||!this.high||!this.idleGain||!this.highGain)return; const t=this.context.currentTime,n=Math.min(1,Math.max(0,(rpm-900)/5200)); this.idleGain.gain.setTargetAtTime(audible?(1-n)*.34*this.level:0,t,.06); this.highGain.gain.setTargetAtTime(audible?(.08+n*.30)*this.level:0,t,.06); this.idle.playbackRate.setTargetAtTime(.82+n*.30,t,.08); this.high.playbackRate.setTargetAtTime(.72+n*.45,t,.08);}
 private async createGraph(){this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=.7;this.master.connect(this.context.destination);const [ib,hb]=await Promise.all([this.load('/audio/sport-car/idle.wav'),this.load('/audio/sport-car/high.wav')]);this.idleGain=this.context.createGain();this.highGain=this.context.createGain();this.idleGain.connect(this.master);this.highGain.connect(this.master);this.idle=this.context.createBufferSource();this.idle.buffer=ib;this.idle.loop=true;this.idle.connect(this.idleGain);this.idle.start();this.high=this.context.createBufferSource();this.high.buffer=hb;this.high.loop=true;this.high.connect(this.highGain);this.high.start();}
 /** Short UI tone (countdown); silent when engine audio is off. */
 beep(freq:number,seconds:number){if(!this.context||!this.master||!this.enabled)return;const t=this.context.currentTime,osc=this.context.createOscillator(),g=this.context.createGain();osc.type='square';osc.frequency.value=freq;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18*this.level,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);osc.connect(g);g.connect(this.master);osc.start(t);osc.stop(t+seconds+.02);}
 private async load(url:string){const r=await fetch(url);if(!r.ok)throw Error(`Engine audio failed: ${r.status}`);return this.context!.decodeAudioData(await r.arrayBuffer());}
 private setGains(idle:number,high:number){if(!this.context||!this.idleGain||!this.highGain)return;this.idleGain.gain.setTargetAtTime(idle,this.context.currentTime,.08);this.highGain.gain.setTargetAtTime(high,this.context.currentTime,.08);}
}
