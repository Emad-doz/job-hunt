import {useState} from 'react';
import {Moon,Sun,SunMoon} from 'lucide-react';

// The classic dark blue look by default; light paper or the system's own choice on request. The choice is a convenience kept in this browser only.
export type Theme='classic'|'light'|'system';
const KEY='job-hunt-theme';
const saved=():Theme=>{try{const v=localStorage.getItem(KEY);return v==='light'||v==='system'?v:'classic';}catch{return 'classic';}};
export function applyTheme(theme:Theme=saved()){if(theme==='classic')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;}
export default function ThemeSwitch(){
  const [theme,setTheme]=useState<Theme>(saved),next:Theme=theme==='classic'?'light':theme==='light'?'system':'classic',label=theme==='classic'?'Classic':theme==='light'?'Light':'System';
  const change=()=>{try{if(next==='classic')localStorage.removeItem(KEY);else localStorage.setItem(KEY,next);}catch{}applyTheme(next);setTheme(next);};
  return <button type="button" className="theme-switch" onClick={change} aria-label={'Colours: '+label+'. Switch to '+next+'.'} title={'Colours: '+label}>{theme==='classic'?<Moon size={16}/>:theme==='light'?<Sun size={16}/>:<SunMoon size={16}/>}<span>{label}</span></button>;
}
