import {useState} from 'react';
import {Moon,Sun,SunMoon} from 'lucide-react';

// Light paper, soft charcoal, or whatever the system says. The choice is a convenience kept in this browser only.
export type Theme='system'|'light'|'dark';
const KEY='job-hunt-theme';
const saved=():Theme=>{try{const v=localStorage.getItem(KEY);return v==='light'||v==='dark'?v:'system';}catch{return 'system';}};
export function applyTheme(theme:Theme=saved()){if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;}
export default function ThemeSwitch(){
  const [theme,setTheme]=useState<Theme>(saved),next:Theme=theme==='system'?'light':theme==='light'?'dark':'system',label=theme==='system'?'System':theme==='light'?'Light':'Dark';
  const change=()=>{try{if(next==='system')localStorage.removeItem(KEY);else localStorage.setItem(KEY,next);}catch{}applyTheme(next);setTheme(next);};
  return <button type="button" className="theme-switch" onClick={change} aria-label={'Colours: '+label+'. Switch to '+next+'.'} title={'Colours: '+label}>{theme==='system'?<SunMoon size={16}/>:theme==='light'?<Sun size={16}/>:<Moon size={16}/>}<span>{label}</span></button>;
}
